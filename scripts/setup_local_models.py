#!/usr/bin/env python3
"""Acquire the exact free local models in models.lock.json; no inference is run.

Use --llm --expressive for the complete demo. --verify-only performs no download.
Existing mismatched files are reported, not silently replaced.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1 << 20), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def verify(path: Path, expected: str):
    if not path.is_file():
        raise RuntimeError("Missing model file: " + str(path))
    if digest(path) != expected:
        raise RuntimeError("Model hash mismatch; existing file preserved: " + str(path))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--llm", action="store_true")
    parser.add_argument("--expressive", action="store_true")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    lock = json.loads((ROOT / "lab_backend/models.lock.json").read_text())
    directory = ROOT / ".local-models"
    directory.mkdir(exist_ok=True)
    records = []
    for key, patterns in [("speech_recognition", ["config.json", "model.bin", "tokenizer.json", "vocabulary.*", "preprocessor_config.json"])] + (
        [("language", ["*.json", "*.safetensors", "*.jinja", "*.model", "*.txt", "README.md"])] if args.llm else []):
        item = lock[key]
        target = directory / item["directory"]
        if not args.verify_only:
            from huggingface_hub import snapshot_download
            snapshot_download(repo_id=item["repository"], revision=item["revision"], local_dir=target,
                              allow_patterns=patterns)
        if not (target / "config.json").is_file():
            raise RuntimeError("Model configuration is missing: " + str(target))
        if key == "language":
            verify(target / "chat_template.jinja", item["chat_template_sha256"])
            if not list(target.glob("*.safetensors")):
                raise RuntimeError("Language-model weights are missing")
        elif not (target / "model.bin").is_file():
            raise RuntimeError("Speech-recognition weights are missing")
        records.append({"component": key, "repository": item["repository"], "revision": item["revision"]})
    item = lock["fast_voice"]
    for name, expected in item["files"].items():
        target = directory / name
        if not target.is_file() and not args.verify_only:
            from huggingface_hub import hf_hub_download
            source = hf_hub_download(item["repository"], filename=item["directory"] + "/" + name,
                                     revision=item["revision"])
            shutil.copyfile(source, target)
        verify(target, expected)
        records.append({"file": name, "bytes": target.stat().st_size, "sha256": expected})
    if args.expressive:
        item = lock["expressive_voice"]
        target_dir = directory / item["directory"]
        target_dir.mkdir(exist_ok=True)
        for name, expected in item["files"].items():
            target = target_dir / name
            if not target.is_file() and not args.verify_only:
                url = f"https://github.com/{item['repository']}/releases/download/{item['release']}/{name}"
                temporary = target.with_suffix(target.suffix + ".download")
                with urlopen(url, timeout=180) as response, temporary.open("wb") as output:
                    shutil.copyfileobj(response, output)
                verify(temporary, expected)
                temporary.replace(target)
            verify(target, expected)
            records.append({"file": item["directory"] + "/" + name, "bytes": target.stat().st_size,
                            "sha256": expected, "release": item["release"]})
    output = ROOT / "evidence/runtime"
    output.mkdir(parents=True, exist_ok=True)
    (output / "installed-model-verification.json").write_text(json.dumps(records, indent=2))
    print(json.dumps({"status": "verified", "components": records}, indent=2))


if __name__ == "__main__":
    main()
