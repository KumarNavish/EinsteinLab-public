"""Additional assertion checks for generated answers, not a semantic proof.

These checks do not change retrieval or its ordering. They catch unsupported
numbers and a concrete observed failure: anticipated outcomes spoken as findings.
"""
from __future__ import annotations
import re
from .knowledge import validate_generated


def generation_problem(answer: dict, sources: list[dict]) -> str | None:
    if not validate_generated(answer, sources):
        return "invalid_source_or_quote"
    used = {item["id"] for item in answer["evidence"]}
    evidence = "\n".join(s["excerpt"] for s in sources if s["id"] in used)
    spoken = answer["answer"]
    numbers = set(re.findall(r"\b\d+(?:\.\d+)?%?", spoken))
    known = set(re.findall(r"\b\d+(?:\.\d+)?%?", evidence))
    if not numbers <= known:
        return "number_not_in_cited_evidence"
    absence_claim = re.search(r"(?:have|has|were|was|are|is) (?:not|never) (?:been )?(?:demonstrated|proven|proved|established)|no (?:study|studies|evidence|results) (?:has|have|exists|exist)", spoken, re.I)
    scope = re.search(r"\b(public|provided|retrieved|snapshot|website|page|source|description|report)\b", spoken, re.I)
    if absence_claim and not scope:
        return "unqualified_absence_of_evidence"
    anticipated = bool(re.search(r"Expected (?:Results|Outcomes)|We hypothesize|We anticipate", evidence, re.I))
    if anticipated:
        for sentence in re.split(r"(?<=[.!?])\s+", spoken):
            outcome = re.search(r"\b(improv\w*|enhanc\w*|reduc\w*|outperform\w*|increas\w*|proven|proved|confirmed|demonstrated|established|preferable)\b", sentence, re.I)
            qualification = re.search(r"\b(aims?|expects?|hypothesi[sz]\w*|anticipat\w*|may|might|could|whether|potential|proposed|not|testing|test|goal|intended)\b", sentence, re.I)
            if outcome and not qualification:
                return "anticipated_outcome_stated_as_finding"
    return None
