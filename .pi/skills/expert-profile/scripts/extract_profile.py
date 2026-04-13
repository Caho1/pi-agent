#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from typing import Iterable
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup, NavigableString, Tag

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
}
CURL_FINAL_URL_MARKER = b"\n__CODEX_FINAL_URL__:"

REMOVE_TAGS = {
    "script",
    "style",
    "noscript",
    "svg",
    "canvas",
    "iframe",
    "nav",
    "footer",
    "header",
    "aside",
    "form",
    "button",
    "input",
    "select",
    "option",
    "textarea",
}
MAIN_TAGS = {"main", "article", "section", "div", "td", "body"}
HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
BLOCK_TAGS = HEADING_TAGS | {"p", "li", "tr"}

POSITIVE_HINTS = (
    "article",
    "content",
    "profile",
    "faculty",
    "staff",
    "teacher",
    "mentor",
    "expert",
    "bio",
    "biography",
    "summary",
    "entry",
    "detail",
    "page-content",
    "wp_articlecontent",
    "main",
    "research",
    "education",
)
NEGATIVE_HINTS = (
    "nav",
    "menu",
    "breadcrumb",
    "footer",
    "header",
    "share",
    "social",
    "search",
    "sidebar",
    "banner",
    "related",
    "recommend",
    "quick",
    "carousel",
    "slider",
    "toolbar",
    "pagination",
    "topbar",
    "bottom",
    "copyright",
)
STRONG_CANDIDATE_HINTS = (
    "wp_articlecontent",
    "page-content",
    "facutly-detail",
    "faculty-detail",
    "entry",
    "article",
    "profile",
    "teacher",
    "mentor",
)
SECTION_KEYWORDS = {
    "bio": ("个人简介", "简介", "bio", "biography", "summary"),
    "education": ("教育背景", "教育经历", "学习与工作经历", "学历", "qualification", "education"),
    "work": ("工作经历", "employment", "career", "experience"),
    "research": ("研究方向", "研究兴趣", "research interests", "research and professional activities", "research"),
    "achievements": ("科研工作与成绩", "科研成果", "代表性论文", "publications", "selected publications", "成果"),
    "service": ("社会学术团体兼职", "学术兼职", "professional activities", "service"),
    "teaching": ("教学", "teaching areas", "courses"),
}
SECTION_CONTAINER_HINTS = {
    "summary_bio": ("Bio", "bio"),
    "biography": ("Biography", "bio"),
    "qualification": ("Education", "education"),
    "education": ("Education", "education"),
    "teaching_area": ("Teaching Areas", "teaching"),
    "research_prof_act": ("Research and Professional Activities", "research"),
    "research": ("Research", "research"),
}
FIELD_ALIASES = {
    "name": ("姓名", "name"),
    "title": ("职称", "title", "position", "designation", "rank"),
    "department": ("院系", "department", "学科专业", "program", "discipline"),
    "institution": ("单位", "机构", "institution", "organization"),
    "office": ("办公室", "office", "room"),
    "email": ("邮箱", "email", "e-mail"),
    "phone": ("电话", "phone", "tel", "telephone"),
}
PROFILE_LINK_PATTERNS = {
    "google_scholar": ("scholar.google.",),
    "orcid": ("orcid.org",),
    "scopus": ("scopus.com",),
    "dblp": ("dblp.org",),
    "researchgate": ("researchgate.net",),
    "linkedin": ("linkedin.com",),
}
EMAIL_RE = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.IGNORECASE)
PHONE_RE = re.compile(r"(?<!\w)(?:\+\d{1,3}[\s().-]*)?(?:\d[\s().-]*){6,17}\d")


def collapse_ws(text: str | None) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def tag_attr_blob(tag: Tag) -> str:
    if getattr(tag, "attrs", None) is None:
        return ""
    classes = tag.get("class", [])
    if isinstance(classes, str):
        classes = [classes]
    parts = [
        tag.get("id", ""),
        " ".join(classes),
        tag.get("role", ""),
        tag.get("itemprop", ""),
    ]
    return " ".join(part for part in parts if part).lower()


def text_of(node: Tag | NavigableString | None, separator: str = " ") -> str:
    if node is None:
        return ""
    if isinstance(node, NavigableString):
        return collapse_ws(str(node))
    if getattr(node, "attrs", None) is None:
        return ""
    return collapse_ws(node.get_text(separator, strip=True))


def iter_tags(root: Tag) -> Iterable[Tag]:
    yield root
    for tag in root.find_all(True):
        yield tag


def count_descendants(tag: Tag, names: set[str]) -> int:
    return sum(1 for child in tag.find_all(True) if child.name in names)


def clone_tag(tag: Tag) -> Tag:
    soup = BeautifulSoup(str(tag), "lxml")
    if soup.body and len(soup.body.contents) == 1 and isinstance(soup.body.contents[0], Tag):
        return soup.body.contents[0]
    if soup.body:
        return soup.body
    return soup


def remove_noise(root: Tag) -> None:
    for element in list(root.find_all(REMOVE_TAGS)):
        element.decompose()

    for element in list(root.find_all(True)):
        blob = tag_attr_blob(element)
        if not blob:
            continue
        if any(hint in blob for hint in NEGATIVE_HINTS) and not any(hint in blob for hint in POSITIVE_HINTS):
            text = text_of(element)
            link_text = sum(len(text_of(link)) for link in element.find_all("a"))
            link_ratio = link_text / max(len(text), 1)
            if link_ratio > 0.35 or len(text) < 300:
                element.decompose()


def candidate_tags(soup: BeautifulSoup) -> list[Tag]:
    seen: set[int] = set()
    tags: list[Tag] = []

    selectors = [
        ".wp_articlecontent",
        ".page-content",
        ".facutly-detail",
        ".faculty-detail",
        ".entry",
        ".article",
        "main",
        "article",
        "[id*=content]",
        "[class*=content]",
        "[class*=profile]",
        "[class*=faculty]",
        "[class*=article]",
        "[class*=detail]",
    ]
    for selector in selectors:
        for tag in soup.select(selector):
            if id(tag) not in seen:
                seen.add(id(tag))
                tags.append(tag)

    for tag in soup.find_all(list(MAIN_TAGS)):
        if id(tag) not in seen:
            seen.add(id(tag))
            tags.append(tag)

    body = soup.body
    if body and id(body) not in seen:
        tags.append(body)
    return tags


def score_candidate(tag: Tag) -> float:
    if tag.name not in MAIN_TAGS:
        return -1e9

    text = text_of(tag)
    text_len = len(text)
    if text_len < 80:
        return -1e9

    blob = tag_attr_blob(tag)
    positive_hits = sum(1 for hint in POSITIVE_HINTS if hint in blob)
    negative_hits = sum(1 for hint in NEGATIVE_HINTS if hint in blob)
    strong_hits = sum(1 for hint in STRONG_CANDIDATE_HINTS if hint in blob)
    block_count = count_descendants(tag, BLOCK_TAGS)
    heading_count = count_descendants(tag, HEADING_TAGS)
    table_rows = count_descendants(tag, {"tr"})
    images = count_descendants(tag, {"img"})
    links = tag.find_all("a")
    link_text_len = sum(len(text_of(link)) for link in links)
    link_ratio = link_text_len / max(text_len, 1)
    depth = len(list(tag.parents))

    score = 0.0
    if tag.name in {"main", "article"}:
        score += 180
    if tag.name == "body":
        score -= 600
    score += strong_hits * 220
    score += positive_hits * 110
    score -= negative_hits * 180
    score += min(text_len, 8000) / 18
    score += block_count * 18
    score += heading_count * 36
    score += table_rows * 12
    score += images * 12
    score -= link_ratio * 260
    score += min(depth, 10) * 8
    return score


def pick_main_content(soup: BeautifulSoup) -> Tag:
    best_tag = soup.body or soup
    best_score = -1e9
    for tag in candidate_tags(soup):
        score = score_candidate(tag)
        if score > best_score:
            best_tag = tag
            best_score = score
    return best_tag


def classify_heading(text: str) -> tuple[str, str] | None:
    lowered = text.lower()
    for category, keywords in SECTION_KEYWORDS.items():
        if any(keyword.lower() in lowered for keyword in keywords):
            return text, category
    return None


def hinted_section(tag: Tag) -> tuple[str, str] | None:
    blob = tag_attr_blob(tag)
    for hint, result in SECTION_CONTAINER_HINTS.items():
        if hint in blob:
            return result
    return None


def normalize_blocks(root: Tag, base_url: str) -> list[dict[str, object]]:
    blocks: list[dict[str, object]] = []
    seen: set[int] = set()

    def walk(node: Tag) -> None:
        for child in node.children:
            if isinstance(child, NavigableString):
                continue
            if not isinstance(child, Tag):
                continue
            if id(child) in seen:
                continue

            section_hint = hinted_section(child)
            if section_hint:
                heading, category = section_hint
                text = text_of(child, "\n")
                if len(text) >= 30:
                    blocks.append({"type": "section", "heading": heading, "category": category, "text": text})
                    seen.add(id(child))
                    continue

            if child.name in HEADING_TAGS:
                text = text_of(child)
                if text:
                    blocks.append({"type": "heading", "level": child.name, "text": text})
                    seen.add(id(child))
                continue

            if child.name == "p":
                text = text_of(child, "\n")
                if text:
                    blocks.append({"type": "paragraph", "text": text})
                seen.add(id(child))
                continue

            if child.name in {"ul", "ol"}:
                items = [text_of(li, "\n") for li in child.find_all("li", recursive=False)]
                items = [item for item in items if item]
                if items:
                    blocks.append({"type": "list", "items": items})
                seen.add(id(child))
                continue

            if child.name == "table":
                rows: list[list[str]] = []
                for row in child.find_all("tr"):
                    cells = [text_of(cell, "\n") for cell in row.find_all(["td", "th"], recursive=False)]
                    cells = [cell for cell in cells if cell]
                    if cells:
                        rows.append(cells)
                if rows:
                    blocks.append({"type": "table", "rows": rows})
                seen.add(id(child))
                continue

            if child.name == "img":
                src = child.get("src", "").strip()
                if src:
                    blocks.append(
                        {
                            "type": "image",
                            "url": urljoin(base_url, src),
                            "alt": collapse_ws(child.get("alt", "")),
                        }
                    )
                seen.add(id(child))
                continue

            walk(child)

    walk(root)

    deduped: list[dict[str, object]] = []
    markers: set[str] = set()
    for block in blocks:
        marker = json.dumps(block, ensure_ascii=False, sort_keys=True)
        if marker in markers:
            continue
        markers.add(marker)
        deduped.append(block)
    return deduped


def normalize_label(text: str) -> str:
    normalized = collapse_ws(text).lower().strip(":：- ")
    normalized = re.sub(r"^(?:[一二三四五六七八九十]+|[0-9]+)[、.．]\s*", "", normalized)
    return normalized


def add_pair(pairs: dict[str, dict[str, object]], label: str, value: str, href: str | None = None) -> None:
    key = normalize_label(label)
    value = collapse_ws(value)
    if not key or not value:
        return
    if key not in pairs:
        pairs[key] = {"label": collapse_ws(label), "value": value}
        if href:
            pairs[key]["href"] = href


def extract_kv_pairs(root: Tag, blocks: list[dict[str, object]], base_url: str) -> dict[str, dict[str, object]]:
    pairs: dict[str, dict[str, object]] = {}

    for block in blocks:
        if block["type"] == "table":
            for row in block["rows"]:
                if len(row) >= 2 and len(collapse_ws(str(row[0]))) <= 40:
                    add_pair(pairs, str(row[0]), str(row[1]))
        elif block["type"] == "paragraph":
            text = str(block["text"])
            match = re.match(r"^([^:：]{1,30})[:：]\s*(.+)$", text)
            if match:
                add_pair(pairs, match.group(1), match.group(2))

    for label in root.find_all("label"):
        label_text = text_of(label)
        if not label_text:
            continue
        values: list[str] = []
        href: str | None = None
        for sibling in label.next_siblings:
            if isinstance(sibling, Tag) and sibling.name == "label":
                break
            if isinstance(sibling, Tag):
                if sibling.name in {"br"}:
                    continue
                sibling_text = text_of(sibling, "\n")
                if sibling.name == "a" and sibling.get("href"):
                    href = urljoin(base_url, sibling.get("href", ""))
                if sibling_text and sibling_text.lower() not in {"contact me"}:
                    values.append(sibling_text)
                elif sibling_text and sibling.name == "a":
                    values.append(sibling_text)
                if sibling.name == "div" and "clear" in tag_attr_blob(sibling):
                    continue
            elif isinstance(sibling, NavigableString):
                sibling_text = collapse_ws(str(sibling))
                if sibling_text:
                    values.append(sibling_text)
        if values or href:
            add_pair(pairs, label_text, " ".join(values) if values else (href or ""), href=href)

    return pairs


def extract_links(root: Tag, base_url: str) -> list[dict[str, str]]:
    seen: set[tuple[str, str]] = set()
    links: list[dict[str, str]] = []
    for link in root.find_all("a"):
        href = link.get("href", "").strip()
        if not href:
            continue
        url = urljoin(base_url, href)
        text = text_of(link) or href
        marker = (url, text)
        if marker in seen:
            continue
        seen.add(marker)
        links.append({"text": text, "url": url})
    return links


def extract_profile_links(links: list[dict[str, str]]) -> tuple[dict[str, str], str | None]:
    profile_links: dict[str, str] = {}
    contact_page = None
    for item in links:
        url = item["url"]
        lowered_url = url.lower()
        lowered_text = item["text"].lower()
        matched = False
        for key, patterns in PROFILE_LINK_PATTERNS.items():
            if any(pattern in lowered_url for pattern in patterns):
                profile_links.setdefault(key, url)
                matched = True
                break
        if matched:
            continue
        if "contact" in lowered_url or "contact" in lowered_text:
            contact_page = contact_page or url
    return profile_links, contact_page


def looks_like_phone(candidate: str) -> bool:
    digits = re.sub(r"\D", "", candidate)
    if len(digits) < 7 or len(digits) > 15:
        return False
    if len(set(digits)) == 1:
        return False
    return True


def find_alias_value(pairs: dict[str, dict[str, object]], field_name: str) -> tuple[str | None, str | None, str | None]:
    for alias in FIELD_ALIASES[field_name]:
        alias_key = normalize_label(alias)
        if alias_key in pairs:
            pair = pairs[alias_key]
            return str(pair.get("value") or ""), str(pair.get("label") or alias), str(pair.get("href") or "") or None
    return None, None, None


def strip_name_prefix(text: str) -> str:
    return collapse_ws(re.sub(r"^(prof(?:essor)?|dr)\.?\s+", "", text, flags=re.IGNORECASE))


def candidate_name_from_title(text: str | None) -> str | None:
    if not text:
        return None
    stripped = collapse_ws(text)
    for separator in (" - ", " | ", " – ", " — ", ", "):
        if separator in stripped:
            candidate = stripped.split(separator, 1)[0].strip()
            if candidate:
                stripped = candidate
                break
    return strip_name_prefix(stripped)


def pick_name(page_title: str | None, blocks: list[dict[str, object]], kv_pairs: dict[str, dict[str, object]]) -> tuple[str | None, str | None]:
    value, label, _ = find_alias_value(kv_pairs, "name")
    if value:
        return value, f"kv:{label}"

    for block in blocks:
        if block["type"] == "heading" and str(block["level"]) == "h1":
            candidate = candidate_name_from_title(str(block["text"]))
            if candidate:
                return candidate, "h1"

    candidate = candidate_name_from_title(page_title)
    if candidate:
        return candidate, "title"
    return None, None


def pick_title(page_title: str | None, blocks: list[dict[str, object]], kv_pairs: dict[str, dict[str, object]], name: str | None) -> tuple[str | None, str | None]:
    value, label, _ = find_alias_value(kv_pairs, "title")
    if value:
        return value, f"kv:{label}"

    for block in blocks:
        if block["type"] == "heading" and str(block["level"]) in {"h2", "h3", "h4"}:
            text = str(block["text"])
            if name and name in text:
                continue
            if len(text) >= 6:
                return text, str(block["level"])

    if page_title and name:
        cleaned = page_title.replace(name, "").strip(" |-–—,")
        cleaned = re.sub(r"^(prof(?:essor)?|dr)\.?\s*", "", cleaned, flags=re.IGNORECASE).strip()
        if cleaned:
            return cleaned, "title"
    return None, None


def pick_simple_field(field_name: str, kv_pairs: dict[str, dict[str, object]]) -> tuple[str | None, str | None]:
    value, label, _ = find_alias_value(kv_pairs, field_name)
    if value:
        return value, f"kv:{label}"
    return None, None


def pick_email(clean_text: str, links: list[dict[str, str]], kv_pairs: dict[str, dict[str, object]]) -> tuple[str | None, str | None, str | None]:
    value, label, href = find_alias_value(kv_pairs, "email")
    if value:
        match = EMAIL_RE.search(value)
        if match:
            return match.group(0), f"kv:{label}", href
        if href:
            return None, f"kv:{label}", href

    for item in links:
        href = item["url"]
        if href.lower().startswith("mailto:"):
            return href.split(":", 1)[1], "link:mailto", None

    match = EMAIL_RE.search(clean_text)
    if match:
        return match.group(0), "regex:text", None
    return None, None, None


def pick_phone(clean_text: str, kv_pairs: dict[str, dict[str, object]]) -> tuple[str | None, str | None]:
    value, label, _ = find_alias_value(kv_pairs, "phone")
    if value:
        for match in PHONE_RE.findall(value):
            if looks_like_phone(match):
                return collapse_ws(match), f"kv:{label}"

    for pair in kv_pairs.values():
        label_text = str(pair.get("label") or "")
        value_text = str(pair.get("value") or "")
        if not any(keyword in f"{label_text} {value_text}".lower() for keyword in ("电话", "phone", "tel", "contact")):
            continue
        for match in PHONE_RE.findall(value_text):
            if looks_like_phone(match):
                return collapse_ws(match), f"kv:{label_text}"

    for match in PHONE_RE.findall(clean_text):
        if looks_like_phone(match):
            return collapse_ws(match), "regex:text"
    return None, None


def fetch_html(url: str, timeout: int) -> tuple[str, str]:
    try:
        response = requests.get(url, headers=HEADERS, timeout=timeout)
        response.raise_for_status()
        if response.apparent_encoding:
            response.encoding = response.apparent_encoding
        return response.text, response.url
    except requests.RequestException:
        command = [
            "curl",
            "-L",
            "--retry",
            "2",
            "--retry-delay",
            "1",
            "--max-time",
            str(max(timeout, 45)),
            "-A",
            USER_AGENT,
            "-w",
            "\n__CODEX_FINAL_URL__:%{url_effective}",
            url,
        ]
        completed = subprocess.run(command, capture_output=True, check=True)
        payload = completed.stdout
        if CURL_FINAL_URL_MARKER in payload:
            html_bytes, final_url_bytes = payload.rsplit(CURL_FINAL_URL_MARKER, 1)
            final_url = final_url_bytes.decode("utf-8", errors="replace").strip()
        else:
            html_bytes = payload
            final_url = url
        return html_bytes.decode("utf-8", errors="replace"), final_url


def extract_meta(soup: BeautifulSoup) -> dict[str, str]:
    meta: dict[str, str] = {}
    for tag in soup.find_all("meta"):
        key = tag.get("name") or tag.get("property")
        value = tag.get("content")
        if key and value:
            meta[key.lower()] = collapse_ws(value)
    return meta


def extract_institution(meta: dict[str, str], host: str) -> tuple[str | None, str | None]:
    for key in ("og:site_name", "application-name"):
        if meta.get(key):
            return meta[key], f"meta:{key}"
    return host, "host"


def image_candidates(root: Tag, base_url: str) -> list[str]:
    images: list[tuple[int, str]] = []
    seen: set[str] = set()
    search_roots = [root]
    if isinstance(root.parent, Tag):
        search_roots.append(root.parent)
    if isinstance(getattr(root.parent, "parent", None), Tag):
        search_roots.append(root.parent.parent)

    for search_root in search_roots:
        for img in search_root.find_all("img"):
            src = img.get("src", "").strip()
            if not src:
                continue
            url = urljoin(base_url, src)
            if url in seen:
                continue
            seen.add(url)

            blob = f"{url} {collapse_ws(img.get('alt', ''))} {tag_attr_blob(img)}".lower()
            score = 0
            if any(token in blob for token in ("logo", "icon", "qr", "wechat")):
                score -= 200
            if any(token in blob for token in ("faculty", "profile", "staff", "teacher")):
                score += 80
            width = img.get("width")
            height = img.get("height")
            try:
                if width and int(width) >= 80:
                    score += 20
                if height and int(height) >= 100:
                    score += 20
            except ValueError:
                pass
            images.append((score, url))

    images.sort(key=lambda item: item[0], reverse=True)
    return [url for _, url in images if _ > -150]


def category_from_heading(text: str) -> str:
    match = classify_heading(text)
    if match:
        return match[1]
    return "misc"


def split_inline_heading(text: str) -> tuple[str | None, str]:
    cleaned = collapse_ws(text)
    ordinal_match = re.match(r"^((?:[一二三四五六七八九十]+|[0-9]+)[、.．]\s*[^\s]{2,20})(?:\s+|[:：])?(.*)$", cleaned)
    if ordinal_match:
        return ordinal_match.group(1), ordinal_match.group(2).strip()

    label_match = re.match(r"^([^:：]{2,24})[:：]\s*(.+)$", cleaned)
    if label_match and classify_heading(label_match.group(1)):
        return label_match.group(1), label_match.group(2)
    return None, cleaned


def build_sections(blocks: list[dict[str, object]]) -> list[dict[str, str]]:
    sections: list[dict[str, str]] = []
    current_heading = "Main Content"
    current_category = "misc"
    current_parts: list[str] = []

    def flush() -> None:
        nonlocal current_parts
        text = collapse_ws("\n".join(current_parts))
        if text:
            sections.append({"heading": current_heading, "category": current_category, "text": text})
        current_parts = []

    for block in blocks:
        block_type = block["type"]

        if block_type == "section":
            flush()
            current_heading = str(block["heading"])
            current_category = str(block["category"])
            current_parts = [str(block["text"])]
            continue

        if block_type == "heading":
            flush()
            current_heading = str(block["text"])
            current_category = category_from_heading(current_heading)
            continue

        if block_type == "paragraph":
            heading, rest = split_inline_heading(str(block["text"]))
            if heading:
                flush()
                current_heading = heading
                current_category = category_from_heading(heading)
                if rest:
                    current_parts.append(rest)
            else:
                current_parts.append(str(block["text"]))
            continue

        if block_type == "list":
            items = [collapse_ws(item) for item in block["items"] if collapse_ws(item)]
            if items:
                current_parts.append("\n".join(f"- {item}" for item in items))
            continue

        if block_type == "table":
            for row in block["rows"]:
                row_text = collapse_ws(" | ".join(str(cell) for cell in row if collapse_ws(str(cell))))
                if not row_text:
                    continue
                heading, rest = split_inline_heading(row_text)
                if heading:
                    flush()
                    current_heading = heading
                    current_category = category_from_heading(heading)
                    if rest:
                        current_parts.append(rest)
                else:
                    current_parts.append(row_text)

    flush()
    return [section for section in sections if section["text"]]


def is_noisy_section(section: dict[str, str]) -> bool:
    text = section["text"].lower()
    if section["category"] != "misc":
        return False
    if any(token in text for token in ("email", "@", "电话", "phone", "办公室", "office")):
        return False
    noise_hits = sum(
        token in text
        for token in (
            "other languages",
            "about us",
            "current students",
            "news and events",
            "contact us",
            "academic programs",
            "faculty and staff",
            "copyright",
        )
    )
    if noise_hits >= 2:
        return True
    if text.count(" - ") >= 5 and len(text) < 500:
        return True
    return False


def filter_sections(sections: list[dict[str, str]]) -> list[dict[str, str]]:
    filtered = [section for section in sections if not is_noisy_section(section)]
    return filtered or sections


def merge_sections_for_llm(sections: list[dict[str, str]], clean_text: str) -> dict[str, str]:
    buckets = {
        "bio": [],
        "education": [],
        "work": [],
        "research": [],
        "achievements": [],
        "service": [],
        "teaching": [],
        "other": [],
    }
    for section in sections:
        category = section["category"] if section["category"] in buckets else "other"
        buckets[category].append(f"{section['heading']}\n{section['text']}")

    payload = {key: collapse_ws("\n\n".join(values)) for key, values in buckets.items() if values}
    if not payload and clean_text:
        payload["other"] = clean_text
    return payload


def build_clean_text(sections: list[dict[str, str]], blocks: list[dict[str, object]], limit: int) -> str:
    if sections:
        text = "\n\n".join(f"{section['heading']}\n{section['text']}" for section in sections)
    else:
        parts: list[str] = []
        for block in blocks:
            if block["type"] == "paragraph":
                parts.append(str(block["text"]))
            elif block["type"] == "list":
                parts.extend(str(item) for item in block["items"])
            elif block["type"] == "table":
                parts.extend(" | ".join(str(cell) for cell in row) for row in block["rows"])
        text = "\n".join(parts)
    return collapse_ws(text)[:limit]


def extract_profile(url: str, timeout: int = 20, clean_text_limit: int = 12000) -> dict[str, object]:
    html, final_url = fetch_html(url, timeout)

    soup = BeautifulSoup(html, "lxml")
    page_title = collapse_ws(soup.title.get_text(" ", strip=True)) if soup.title else None
    meta = extract_meta(soup)
    host = urlparse(final_url).netloc

    main_tag = pick_main_content(soup)
    main_clone = clone_tag(main_tag)
    remove_noise(main_clone)

    blocks = normalize_blocks(main_clone, final_url)
    sections = filter_sections(build_sections(blocks))
    clean_text = build_clean_text(sections, blocks, clean_text_limit)
    kv_pairs = extract_kv_pairs(main_clone, blocks, final_url)
    links = extract_links(main_clone, final_url)
    profile_links, contact_page = extract_profile_links(links)
    images = image_candidates(main_tag, final_url)

    name, name_source = pick_name(page_title, blocks, kv_pairs)
    title, title_source = pick_title(page_title, blocks, kv_pairs, name)
    department, department_source = pick_simple_field("department", kv_pairs)
    office, office_source = pick_simple_field("office", kv_pairs)
    email, email_source, contact_from_email = pick_email(clean_text, links, kv_pairs)
    phone, phone_source = pick_phone(clean_text, kv_pairs)
    institution, institution_source = extract_institution(meta, host)

    if not contact_page and contact_from_email:
        contact_page = contact_from_email

    structured_fields = {
        "name": name,
        "title": title,
        "department": department,
        "institution": institution,
        "email": email,
        "phone": phone,
        "office": office,
        "contact_page": contact_page,
        "image_url": images[0] if images else None,
        "profile_links": profile_links,
    }
    field_provenance = {
        "name": name_source,
        "title": title_source,
        "department": department_source,
        "institution": institution_source,
        "email": email_source,
        "phone": phone_source,
        "office": office_source,
        "contact_page": "link:contact" if contact_page else None,
        "image_url": "profile-image" if images else None,
    }

    return {
        "url": url,
        "final_url": final_url,
        "host": host,
        "page_title": page_title,
        "structured_fields": structured_fields,
        "field_provenance": field_provenance,
        "sections": sections,
        "clean_text": clean_text,
        "llm_payload": merge_sections_for_llm(sections, clean_text),
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract structured data from expert profile pages.")
    parser.add_argument("urls", nargs="+", help="One or more profile URLs.")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output.")
    parser.add_argument("--timeout", type=int, default=20, help="HTTP timeout in seconds.")
    parser.add_argument(
        "--max-clean-text-chars",
        type=int,
        default=12000,
        help="Truncate clean_text to this many characters.",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    results = [extract_profile(url, timeout=args.timeout, clean_text_limit=args.max_clean_text_chars) for url in args.urls]
    output = results[0] if len(results) == 1 else results
    json.dump(output, sys.stdout, ensure_ascii=False, indent=2 if args.pretty else None)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
