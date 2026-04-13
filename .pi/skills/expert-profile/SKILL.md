---
name: expert-profile
description: Extract structured fields and clean long-text sections from faculty pages, expert homepages, mentor profiles, and similar biography pages with inconsistent HTML. Use when Codex needs to scrape expert profile URLs, remove noisy webpage structure, capture stable fields with rules, or prepare cleaned section text for later LLM summarization.
---

# Expert Profile

Use this skill for expert or faculty profile pages where HTML structure varies across sites.

## Workflow

1. Run the extractor first:

```bash
uv pip install --python .venv/bin/python requests beautifulsoup4 lxml pyyaml
./.venv/bin/python .pi/skills/expert-profile/scripts/extract_profile.py "<url>" --pretty
```

2. Trust rule-extracted short facts before using the model. The script is the source of truth for:
   - `name`
   - `title`
   - `email`
   - `phone`
   - `office`
   - `profile_links`
   - `image_url`

3. Use `sections` and `llm_payload` for long-form understanding. These are cleaned from the main content region after removing navigation, footer, share widgets, and other noisy structure.

4. If a field is missing, say it is missing. Do not infer contact details or affiliations from weak hints.

## Commands

Single page:

```bash
./.venv/bin/python .pi/skills/expert-profile/scripts/extract_profile.py "<url>" --pretty
```

Multiple pages:

```bash
./.venv/bin/python .pi/skills/expert-profile/scripts/extract_profile.py "<url-1>" "<url-2>" --pretty
```

Smoke test with the bundled real URLs:

```bash
./.venv/bin/python .pi/skills/expert-profile/scripts/smoke_test.py
```

## Output Contract

The extractor returns JSON with:

- `structured_fields`: rule-based short facts
- `field_provenance`: where each short fact came from
- `sections`: cleaned long-text sections grouped by heading or container hint
- `llm_payload`: merged long-text buckets for summarization
- `clean_text`: fallback cleaned text when section boundaries are weak

Read [references/output-schema.md](references/output-schema.md) only when you need the full field list or section category meanings.

## LLM Hand-off Rules

- Use `structured_fields` directly in the final answer when those fields exist.
- Use `llm_payload.bio`, `llm_payload.education`, `llm_payload.work`, `llm_payload.research`, `llm_payload.achievements`, `llm_payload.service`, and `llm_payload.teaching` for long-text summarization.
- Keep raw wording for names, titles, and institutions when available. Do not normalize away meaningful distinctions.
- If `sections` look noisy or sparse, fall back to `clean_text` instead of the original HTML.

## Failure Handling

- If fetch fails, report the HTTP or network error and stop.
- If the page loads but the extractor finds weak structure, return the cleaned text and say the page may need a site-specific adapter later.
- If the page appears JS-heavy and the cleaned text is nearly empty, say this standard-HTML pipeline may need a browser fallback such as Playwright.
