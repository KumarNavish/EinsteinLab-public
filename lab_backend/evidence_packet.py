"""Compact citation protocol for the generator; retrieval and source order stay unchanged.

The model selects passage tags instead of retyping hashes and long quotations.
Tags resolve to exact input substrings. This validates provenance, not entailment.
"""
from __future__ import annotations
import re


def make_packet(sources: list[dict]) -> tuple[list[dict], dict]:
    documents = []
    tags = {}
    for number, source in enumerate(sources, 1):
        excerpt = source["excerpt"]
        paragraphs = [match for match in re.finditer(r"[^\n]+(?:\n(?!\n)[^\n]+)*", excerpt)]
        passages = []
        prefix = None
        for paragraph in paragraphs:
            start, end = paragraph.span()
            if prefix is not None:
                start = prefix
            text = excerpt[start:end]
            if len(text.strip()) < 25:
                prefix = start
                continue
            prefix = None
            tag = f"D{number}P{len(passages) + 1}"
            passages.append({"tag": tag, "text": text})
            tags[tag] = {"id": source["id"], "quote": text}
        if prefix is not None and passages:
            # Preserve a short trailing researcher name/status with its preceding context.
            tag = passages[-1]["tag"]
            previous = tags[tag]["quote"]
            start = excerpt.rfind(previous, 0, prefix)
            if start >= 0:
                text = excerpt[start:]
                passages[-1]["text"] = text
                tags[tag]["quote"] = text
        if not passages and len(excerpt) >= 25:
            tag = f"D{number}P1"
            passages.append({"tag": tag, "text": excerpt})
            tags[tag] = {"id": source["id"], "quote": excerpt}
        documents.append({"title": source["title"], "passages": passages})
    return documents, tags


def resolve_packet(obj: dict, tags: dict) -> dict:
    if not isinstance(obj, dict) or not isinstance(obj.get("answer"), str):
        raise ValueError("Missing answer")
    selected = obj.get("evidence")
    if not isinstance(selected, list) or not 1 <= len(selected) <= 3:
        raise ValueError("Expected one to three passage tags")
    if any(not isinstance(tag, str) or tag not in tags for tag in selected):
        raise ValueError("Unknown evidence passage tag")
    return {"answer": obj["answer"], "evidence": [dict(tags[tag]) for tag in dict.fromkeys(selected)]}
