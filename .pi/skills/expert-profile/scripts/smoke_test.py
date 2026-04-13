#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from extract_profile import extract_profile  # noqa: E402


TEST_CASES = [
    {
        "label": "zayed-university",
        "url": "https://www.zu.ac.ae/main/en/colleges/colleges/__college_of_technological_innovation/faculty_and_staff/_auh/_computing-and-applied-technology/_profiles/monther_aldwairi",
        "checks": [
            lambda result: "Monther" in (result["structured_fields"]["name"] or ""),
            lambda result: "971" in (result["structured_fields"]["phone"] or ""),
            lambda result: bool(result["structured_fields"]["profile_links"].get("orcid")),
            lambda result: "research" in result["llm_payload"],
        ],
    },
    {
        "label": "usst-mentor",
        "url": "https://jiankang.usst.edu.cn/2021/0611/c13509a248959/page.htm",
        "checks": [
            lambda result: "杨建涛" in (result["structured_fields"]["name"] or ""),
            lambda result: "usst.edu.cn" in (result["structured_fields"]["email"] or ""),
            lambda result: "021" in (result["structured_fields"]["phone"] or ""),
            lambda result: "康复" in result["clean_text"],
        ],
    },
]


def main() -> int:
    failures: list[str] = []
    for case in TEST_CASES:
        result = extract_profile(case["url"])
        for index, check in enumerate(case["checks"], start=1):
            if not check(result):
                failures.append(f"{case['label']} failed check {index}")
        print(
            f"[ok] {case['label']}: name={result['structured_fields']['name']!r}, "
            f"email={result['structured_fields']['email']!r}, phone={result['structured_fields']['phone']!r}"
        )

    if failures:
        print("[fail] smoke test failures detected:")
        for failure in failures:
            print(f" - {failure}")
        return 1

    print("[ok] all smoke tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
