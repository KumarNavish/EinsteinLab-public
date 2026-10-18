"""Reviewed source notes as an explicit fast path for named-project questions.

This is not live generation. Every note is tied to the exact source-text hash and
is disabled after the page changes. Unrecognized or detailed questions continue
through the conversational model rather than silently receiving a canned answer.
"""
from __future__ import annotations
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from .atlas import blocks
from .knowledge import tokens


class ResearchNotes:
    def __init__(self, root: Path, pages: list[dict]):
        raw = json.loads((root / "lab_backend/project_briefs.json").read_text())
        self.disclosure = raw["disclosure"]
        self.notes = {}
        for page in pages:
            slug = parse_qs(urlparse(page["url"]).query).get("research-proj-posts", [None])[0]
            note = raw["projects"].get(slug)
            if note is None:
                continue
            actual = hashlib.sha256(page["text"].encode()).hexdigest()
            if actual != note["source_sha256"]:
                continue
            self.notes[page["url"]] = {"page": page, "note": note, "passages": blocks(page)}

    def answer(self, question: str, sources: list[dict], history: list[dict]) -> dict | None:
        if not sources:
            return None
        # Do not replace requests for specific facts, numbers, methods or judgement
        # with a general overview. The usual evidence-gated path handles those.
        if re.search(r"\b(who|lead|director|salary|budget|unpublished|confidential|sample|participants|p.value|equation|architecture|dataset|hyperparameter|opinion|recommend|rank|best|compare|connect|versus|status|when|date)\b", question, re.I):
            return None
        key = sources[0]["url"]
        item = self.notes.get(key)
        if item is None:
            return None
        title_terms = set(tokens(item["page"]["title"])) - {"ai", "for", "and", "in"}
        question_terms = set(tokens(question))
        explicit_topic = len(title_terms & question_terms) >= min(2, len(title_terms)) and bool(title_terms)
        followup = bool(history and re.search(r"\b(that|this|it|its|simpler|more simply)\b", question, re.I))
        if not explicit_topic and not followup:
            return None
        finding = bool(re.search(r"\b(results?|finding|found|discover\w*|learn\w*|report\w*|outcome\w*|prove\w*|demonstrat\w*|limitations?)\b", question, re.I))
        note = item["note"]
        answer = note["finding" if finding else "mechanism"]
        wanted = {section.casefold() for section in note["sections"]}
        passages = [p for p in item["passages"] if p["section"].casefold() in wanted and len(p["excerpt"]) > 50]
        if finding:
            results = [p for p in passages if p["section"].casefold() in ("results", "outcomes", "expected results", "expected outcomes")]
            passages = results or passages
        if not passages:
            return None
        return {"answer": answer, "sources": passages[:3], "mode": "reviewed-research-note",
                "answer_origin": "authored-source-summary", "disclosure": self.disclosure,
                "source_snapshot_sha256": note["source_sha256"],
                "grounding_limit": "Human-readable reviewed summary tied to a source snapshot, not a live generated explanation or independently replicated scientific result."}
