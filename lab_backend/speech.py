"""Local expressive speech with model-duration lip cues and an explicit fast voice.

Kokoro supplies phoneme durations; the IPA-to-mouth mapping is approximate. These
are not measurements of headset audiovisual synchronization.
"""
from __future__ import annotations
import io
import re
import wave
from pathlib import Path


def mouth_shape(phoneme: str) -> str:
    if phoneme in "pbm":
        return "A"
    if phoneme in "fv":
        return "G"
    if phoneme in "lɫ":
        return "H"
    if phoneme in "uʊwʉy":
        return "F"
    if phoneme in "oɔɒ":
        return "E"
    if phoneme in "aɑæʌɐ":
        return "D"
    if phoneme in "eɛəɜɞ":
        return "C"
    if phoneme.isspace() or phoneme in ".,;:!?—-":
        return "X"
    return "B"


def phoneme_cues(timings, duration: float) -> list[dict]:
    cues = []
    for timing in timings:
        if timing.phoneme in "ˈˌːˑ":
            continue
        start = max(0.0, min(float(timing.start), duration))
        end = max(start, min(float(timing.end), duration))
        if end <= start:
            continue
        if cues:
            start = max(start, cues[-1]["end"])
        if end <= start:
            continue
        value = mouth_shape(timing.phoneme)
        if cues and cues[-1]["value"] == value and start - cues[-1]["end"] < .04:
            cues[-1]["end"] = round(end, 5)
        else:
            cues.append({"start": round(start, 5), "end": round(end, 5), "value": value})
    return cues


def sentence_segments(text: str) -> list[str]:
    parts = re.split(r"(?<!Dr\.)(?<!Mr\.)(?<!Ms\.)(?<=[.!?])\s+(?=[A-Z])", text.strip())
    segments = []
    for part in parts:
        if not part:
            continue
        if len(part) <= 250:
            segments.append(part)
            continue
        words = part.split()
        current = []
        for word in words:
            if len(" ".join(current + [word])) > 230 and current:
                segments.append(" ".join(current))
                current = []
            current.append(word)
        if current:
            segments.append(" ".join(current))
    return segments or [text]


def concatenate_wav(parts: list[bytes]) -> bytes:
    if not parts:
        return b""
    frames = []
    format_ = None
    for part in parts:
        with wave.open(io.BytesIO(part), "rb") as wav:
            current = (wav.getnchannels(), wav.getsampwidth(), wav.getframerate())
            if format_ is not None and format_ != current:
                raise ValueError("Speech segments have inconsistent audio formats")
            format_ = current
            frames.append(wav.readframes(wav.getnframes()))
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(format_[0])
        wav.setsampwidth(format_[1])
        wav.setframerate(format_[2])
        wav.writeframes(b"".join(frames))
    return output.getvalue()


class ExpressiveSpeech:
    def __init__(self, root: Path):
        self.directory = root / ".local-models/kokoro"
        self.model = None
        self.model_path = self.directory / "kokoro-v1.0.int8.onnx"
        if not self.model_path.is_file():
            self.model_path = self.directory / "kokoro-v1.0.onnx"
        self.voice_name = "bm_george"

    @property
    def available(self) -> bool:
        return self.model_path.is_file() and (self.directory / "voices-v1.0.bin").is_file()

    def load(self):
        if self.model is None:
            import onnxruntime as ort
            from kokoro_onnx import Kokoro
            options = ort.SessionOptions()
            options.intra_op_num_threads = 3
            options.inter_op_num_threads = 1
            session = ort.InferenceSession(str(self.model_path),
                                           sess_options=options, providers=["CPUExecutionProvider"])
            self.model = Kokoro.from_session(session, str(self.directory / "voices-v1.0.bin"))
        return self.model

    def synthesize(self, text: str) -> tuple[bytes, list[dict], str]:
        import numpy as np
        model = self.load()
        samples, rate, timings = model.create_timed(text, voice=self.voice_name, speed=.96,
                                                    lang="en-gb", sentence_pause=.18, clause_pause=.07)
        samples = np.asarray(samples, dtype=np.float32)
        if not samples.size or not np.isfinite(samples).all():
            raise ValueError("Voice synthesis returned invalid samples")
        duration = samples.size / rate
        output = io.BytesIO()
        with wave.open(output, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(rate)
            wav.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
        cues = phoneme_cues(timings, duration)
        kind = "model-duration-phonemes" if cues else "audio-amplitude"
        return output.getvalue(), cues, kind
