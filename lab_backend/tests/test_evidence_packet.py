import pytest
from lab_backend.evidence_packet import make_packet, resolve_packet
from lab_backend.knowledge import validate_generated

SOURCES = [{"id": "original-source", "title": "Project", "excerpt": "Challenge\n\nPeople need clearer explanations under cognitive load.\n\nApproach\n\nWe examine chatbot role cues in a roadside assistance experiment.\n\nLead Researcher\n\nDr. Joseph Ollier"}]


def test_every_tag_is_an_exact_original_substring():
    documents, tags = make_packet(SOURCES)
    assert documents[0]["title"] == SOURCES[0]["title"] and tags
    assert all(value["quote"] in SOURCES[0]["excerpt"] for value in tags.values())
    assert any("Dr. Joseph Ollier" in value["quote"] for value in tags.values())


def test_selected_tag_resolves_to_source_and_quote():
    _, tags = make_packet(SOURCES)
    tag = next(iter(tags))
    obj = resolve_packet({"answer": "The project studies how people process explanations.", "evidence": [tag]}, tags)
    assert validate_generated(obj, SOURCES)
    assert obj["evidence"][0]["id"] == "original-source"


def test_unknown_or_nonstring_tags_are_rejected():
    _, tags = make_packet(SOURCES)
    for evidence in [["fabricated"], [1], [], "D1P1"]:
        with pytest.raises(ValueError):
            resolve_packet({"answer": "A sentence.", "evidence": evidence}, tags)


def test_source_order_is_not_changed():
    second = {**SOURCES[0], "id": "second", "title": "Second"}
    documents, tags = make_packet([SOURCES[0], second])
    assert [d["title"] for d in documents] == ["Project", "Second"]
    assert tags["D2P1"]["id"] == "second"
