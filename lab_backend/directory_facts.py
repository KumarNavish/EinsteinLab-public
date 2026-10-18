"""Directly reported directory facts with exact source spans, not inferred roles.

This does not classify a news item as a current role or invent a person. It reads
a named role from the directory snapshot and states that snapshot's scope.
"""
from __future__ import annotations
import hashlib
import re


def directory_answer(question: str, pages: list[dict]) -> dict | None:
    match = re.search(r"\b(scientific director|lab director)\b", question, re.I)
    if not match or re.search(r"\b(former|past|previous|history|vacancy|job)\b", question, re.I):
        return None
    role = match.group(1).lower()
    pages = [page for page in pages if page.get("title") == "About Us"]
    if len(pages) != 1:
        return None
    page = pages[0]
    text = page["text"]
    paragraphs = list(re.finditer(r"\S(?:.*?\S)?(?=\n\s*\n|\Z)", text, re.S))
    matches = []
    for index, paragraph in enumerate(paragraphs):
        value = paragraph.group(0)
        if not re.match(re.escape(role) + r"\b", value, re.I) or index == 0:
            continue
        previous = paragraphs[index - 1]
        name = previous.group(0).strip()
        if len(name) > 90 or not 2 <= len(name.split()) <= 8 or "former" in name.lower():
            continue
        start, end = previous.start(), paragraph.end()
        excerpt = text[start:end]
        if "former" in excerpt.lower():
            continue
        matches.append((name, start, end, excerpt))
    if len(matches) != 1:
        return {"answer": "I cannot identify that role unambiguously in the public directory snapshot.",
                "sources": [], "mode": "abstention"}
    name, start, end, excerpt = matches[0]
    source = {"id": hashlib.sha256((page["url"] + "\n" + excerpt).encode()).hexdigest()[:16],
              "url": page["url"], "title": page["title"], "excerpt": excerpt,
              "section": "Our Team", "epistemic": "documented",
              "start": start, "end": end, "fetched_at": page.get("fetched_at"),
              "text_sha256": page.get("text_sha256")}
    return {"answer": f"The public directory snapshot lists {name} as the {role}.",
            "sources": [source], "mode": "source-fact", "fact_kind": "directory-role"}
