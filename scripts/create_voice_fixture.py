#!/usr/bin/env python3
"""Create an explicitly synthetic question for the isolated browser microphone test.

This never reads a microphone. Existing fixtures are checked and left unchanged.
"""
from __future__ import annotations
import io
import json
from pathlib import Path
import sys
import wave

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from lab_backend.runtime import LocalRuntime

TEXT = "What does the lab investigate about delegating decisions to agentic AI?"


def main():
    directory = ROOT / "evidence/runtime/c2"
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / "handsfree-question-fixture.wav"
    metadata = directory / "handsfree-fixture.json"
    if target.exists() or metadata.exists():
        if not target.is_file() or not metadata.is_file():
            raise SystemExit("Incomplete existing fixture; preserve it and reconcile before regenerating.")
        info = json.loads(metadata.read_text())
        if info.get("text") != TEXT or info.get("final_silence_s") != 120:
            raise SystemExit("Existing fixture differs from the recorded test; it was not overwritten.")
        with wave.open(str(target), "rb") as wav:
            if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getnframes() / wav.getframerate() < 122:
                raise SystemExit("Existing fixture format does not match this test.")
        print("Existing synthetic fixture verified:", target)
        return
    audio = LocalRuntime(ROOT).synthesize(TEXT)
    if not audio:
        raise SystemExit("Install the locked Piper voice before preparing the fixture.")
    with wave.open(io.BytesIO(audio), "rb") as wav:
        params = wav.getparams()
        frames = wav.readframes(wav.getnframes())
    initial, final = 2, 120
    temporary = target.with_suffix(".next.wav")
    with wave.open(str(temporary), "wb") as wav:
        wav.setparams(params)
        bytes_per_second = params.framerate * params.nchannels * params.sampwidth
        wav.writeframes(bytes(bytes_per_second * initial) + frames + bytes(bytes_per_second * final))
    temporary.replace(target)
    metadata.write_text(json.dumps({"text": TEXT, "initial_silence_s": initial,
        "final_silence_s": final, "speech_seconds": len(frames) / bytes_per_second,
        "source": "Locally synthesized Piper speech, not a human recording. Used only in an isolated Chrome fake microphone."}, indent=2))
    print("Synthetic microphone fixture created:", target)


if __name__ == "__main__":
    main()
