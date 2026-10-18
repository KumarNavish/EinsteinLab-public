import io
import json
import wave
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from lab_backend.grounding import generation_problem
from lab_backend.speech import mouth_shape, phoneme_cues, sentence_segments, concatenate_wav
from lab_backend import app as module
from lab_backend.knowledge import Knowledge
from .test_knowledge import SNAP

SOURCE = {"id": "source-1", "excerpt": "Expected Results\n\nWe anticipate that tailored scenes may improve relaxation. Project Status Ongoing"}

def answer(text):
    return {"answer": text, "evidence": [{"id": "source-1", "quote": "We anticipate that tailored scenes may improve relaxation."}]}


def test_expected_outcome_is_not_a_finding():
    assert generation_problem(answer("The system improves relaxation."), [SOURCE]) == "anticipated_outcome_stated_as_finding"


def test_hypothesis_wording_is_retained():
    assert generation_problem(answer("The project is testing whether tailored scenes improve relaxation."), [SOURCE]) is None


def test_unsupported_number_is_rejected():
    assert generation_problem(answer("The system may improve relaxation by 42 percent."), [SOURCE]) == "number_not_in_cited_evidence"


@pytest.mark.parametrize("phoneme,expected", [("p", "A"), ("m", "A"), ("f", "G"), ("l", "H"), ("u", "F"), ("ɔ", "E"), ("ɑ", "D"), ("ə", "C"), ("s", "B"), (" ", "X")])
def test_phoneme_mapping(phoneme, expected):
    assert mouth_shape(phoneme) == expected


def test_cues_are_bounded_monotonic_and_ignore_stress_markers():
    timings = [SimpleNamespace(phoneme=p, start=a, end=b) for p, a, b in [("p", -.1, .1), ("ˈ", .1, .15), ("ɑ", .15, .4), ("ɑ", .4, .5), (" ", .5, 3)]]
    cues = phoneme_cues(timings, .8)
    assert [c["value"] for c in cues] == ["A", "D", "X"]
    assert cues[0]["start"] == 0 and cues[-1]["end"] == .8
    assert all(a["end"] <= b["start"] for a, b in zip(cues, cues[1:]))


def test_sentence_split_does_not_separate_doctor_title():
    parts = sentence_segments("Dr. Joseph Ollier leads this project. It is ongoing.")
    assert parts == ["Dr. Joseph Ollier leads this project.", "It is ongoing."]


def wav_bytes(rate=24000):
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(bytes(2400))
    return output.getvalue()


def test_wav_concatenation_preserves_samples():
    output = concatenate_wav([wav_bytes(), wav_bytes()])
    with wave.open(io.BytesIO(output), "rb") as wav:
        assert wav.getnframes() == 2400 and wav.getframerate() == 24000


def test_wav_mixed_formats_are_rejected():
    with pytest.raises(ValueError):
        concatenate_wav([wav_bytes(), wav_bytes(22050)])


def test_stream_has_answer_audio_then_completion(monkeypatch):
    monkeypatch.setattr(module, "knowledge", Knowledge(SNAP))
    wave_data = wav_bytes()
    def speech(text, voice_mode, emit=None, cancelled=None):
        import base64
        emit({"event": "audio", "index": 0, "text": text,
              "audio_base64": base64.b64encode(wave_data).decode(), "mouthCues": []})
        return wave_data, [], "fixture", "audio-amplitude"
    monkeypatch.setattr(module.runtime, "synthesize_reply", speech)
    c = TestClient(module.app)
    payload = {"session_id": "streaming-test", "request_id": "streaming-request", "question": "cognitive load", "evidence_only": True}
    response = c.post("/api/turn/stream", json=payload)
    events = [json.loads(line) for line in response.text.splitlines()]
    names = [event["event"] for event in events]
    assert names.index("answer") < names.index("audio") < names.index("done")
    assert all(event.get("request_id") == payload["request_id"] for event in events)
    assert events[-1]["timings"]["server_first_audio_ms"] is not None


def test_missing_evidence_does_not_prove_outcome_never_occurred():
    assert generation_problem(answer("Improved relaxation outcomes have not been demonstrated."), [SOURCE]) == "unqualified_absence_of_evidence"


def test_negative_claim_scoped_to_available_source_is_allowed():
    assert generation_problem(answer("Improved relaxation outcomes have not been demonstrated in the provided project description."), [SOURCE]) is None
