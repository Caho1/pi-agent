---
name: demo-journal-agent
description: Recommend journals and submission strategy for paper abstracts, topics, or research directions. Use when the user asks for journal recommendations, scope matching, open-access constraints, APC limits, or review speed tradeoffs.
---

# Demo Journal Agent

Use this skill when the user wants help choosing a journal or planning a submission strategy.

## Workflow

1. Extract the paper topic, domain, and any hard constraints.
2. Call `search_journals` before making recommendations.
3. Base every recommendation on tool output. Do not invent impact factors, acceptance rates, or indexing details.
4. Return the best 2-3 options unless the user asks for a longer list.

## Constraint Handling

- If the user cares about `Q1`, pass `quartile: "Q1"`.
- If the user requires open access, pass `openAccessOnly: true`.
- If the user gives an APC cap, pass `maxApcUsd`.
- If the user wants faster review, pass `maxTurnaroundDays`.

## Response Format

Use this structure:

1. `Best fit`
2. `Why it fits`
3. `Risks or tradeoffs`
4. `Suggested next step`

If the abstract is missing and the user only gives a vague topic, ask for one short follow-up question before calling the tool.
