import copy
import hashlib
import json
from pathlib import Path
import pytest
from lab_backend.atlas import blocks
from lab_backend.directory_facts import directory_answer
from lab_backend.narrator import source_fallback
from lab_backend.research_notes import ResearchNotes


def page(text, title="About Us", url="https://mobililab.ethz.ch/?page_id=19"):
    return {"title": title, "url": url, "text": text, "fetched_at": "2026-10-14", "text_sha256": hashlib.sha256(text.encode()).hexdigest()}


def test_directory_role_is_read_from_its_actual_preceding_name():
    p = page("Our Team\n\nDr. Correct Person\n\nScientific Director contact@example.test\n\nDr. Other Person\n\nTechnology Lead")
    result = directory_answer("Who is the scientific director?", [p])
    assert result["mode"] == "source-fact"
    assert "Dr. Correct Person" in result["answer"] and "Other Person" not in result["answer"]
    source = result["sources"][0]
    assert p["text"][source["start"]:source["end"]] == source["excerpt"]
    assert "snapshot" in result["answer"]


def test_directory_ambiguity_does_not_choose_arbitrarily():
    p = page("Dr. One Person\n\nScientific Director\n\nDr. Another Person\n\nScientific Director")
    result = directory_answer("Who is the scientific director?", [p])
    assert result["mode"] == "abstention"


def test_directory_does_not_answer_historical_question_as_present_role():
    p = page("Dr. Correct Person\n\nScientific Director")
    assert directory_answer("Who was the former scientific director?", [p]) is None


def test_vacancy_is_not_proof_of_current_director():
    result = source_fallback("Who is the director?", [{"title": "Open position: Scientific Director", "excerpt": "A vacancy announcement", "url": "https://example.test"}])
    assert result["mode"] == "abstention"


def test_exact_source_offsets_survive_long_paragraph_chunking():
    text = "Challenge\n\n" + ("This is a sufficiently long sentence about research methods and outcomes. " * 40) + "\n\nProject Status\n\nOngoing"
    p = page(text, "Example Project")
    result = blocks(p)
    assert result
    for source in result:
        assert text[source["start"]:source["end"]] == source["excerpt"]


def test_expected_outcomes_keep_epistemic_label():
    p = page("Approach\n\nWe built a prototype system.\n\nExpected Results\n\nWe expect improved relaxation, which has not been established here.", "Example Project")
    result = blocks(p)
    expected = [source for source in result if "We expect" in source["excerpt"]]
    assert expected and all(source["epistemic"] == "anticipated" for source in expected)


def make_notes(tmp_path):
    source = page("Approach\n\nUsers describe a virtual scene and the system generates it.\n\nExpected Results\n\nThe project expects that personalization may improve relaxation, rather than claiming it has already done so.", "GenAI in VR", "https://mobililab.ethz.ch/?research-proj-posts=genai-in-vr")
    (tmp_path / "lab_backend").mkdir()
    note = {"source_sha256": source["text_sha256"], "mechanism": "Users describe a virtual scene. The system creates it.", "finding": "Improved relaxation is an expected outcome, not an established finding in this description.", "sections": ["Approach", "Expected Results"]}
    (tmp_path / "lab_backend/project_briefs.json").write_text(json.dumps({"disclosure": "Reviewed authored notes, not live generation.", "projects": {"genai-in-vr": note}}))
    return source, ResearchNotes(tmp_path, [source])


def test_research_notes_disclose_authorship(tmp_path):
    source, notes = make_notes(tmp_path)
    result = notes.answer("What does GenAI in VR investigate?", blocks(source), [])
    assert result["mode"] == "reviewed-research-note"
    assert result["answer_origin"] == "authored-source-summary"
    assert "not live generation" in result["disclosure"]


def test_changed_source_invalidates_reviewed_note(tmp_path):
    source, notes = make_notes(tmp_path)
    source["text"] += " Changed findings."
    updated = ResearchNotes(tmp_path, [source])
    assert not updated.notes


def test_details_and_unknown_topics_do_not_receive_generic_prepared_answer(tmp_path):
    source, notes = make_notes(tmp_path)
    assert notes.answer("What is the sample size for GenAI in VR?", blocks(source), []) is None
    assert notes.answer("What does the molecular biology experiment do?", blocks(source), []) is None


def test_result_question_does_not_promote_expected_benefit_to_finding(tmp_path):
    source, notes = make_notes(tmp_path)
    result = notes.answer("What are the results of GenAI in VR?", blocks(source), [])
    assert "expected outcome" in result["answer"]
    assert all(source["epistemic"] == "anticipated" for source in result["sources"])
