#!/usr/bin/env python3
"""Package reviewed runtime inputs; exclude credentials, models and source caches."""
import argparse
import hashlib
from pathlib import Path
import re
import shutil
import tarfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    files = sorted((root/'lab_backend').glob('*.py'))
    files += [root/'lab_backend/project_briefs.json', root/'THIRD_PARTY_NOTICES.md']
    files += sorted((root/'rehearsal/dist').rglob('*'))
    files = [path for path in files if path.is_file()]
    asset = root/'rehearsal/dist/assets/einstein.glb'
    if asset not in files or asset.stat().st_size < 1024:
        raise SystemExit('Build the frontend with the private character before packaging.')
    if any(path.is_symlink() for path in files):
        raise SystemExit('Deployment files must not be symlinks.')
    args.output.mkdir(parents=True, exist_ok=True)
    archive = args.output/'einstein-app.tar.gz'
    with tarfile.open(archive, 'w:gz', compresslevel=5) as bundle:
        for path in files:
            bundle.add(path, arcname=str(path.relative_to(root)), recursive=False)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (args.output/'bundle.sha256').write_text(digest+'  einstein-app.tar.gz\n')
    for name in ['app.py','packages.txt','README.md']:
        shutil.copy2(root/'deploy/huggingface'/name, args.output/name)
    # HF appends SDK requirements to one pip command, which cannot use hash mode.
    # Keep the canonical hash lock; send the exact pins from it to that builder.
    lock = (root/'deploy/huggingface/requirements.lock').read_text()
    pins = [line.removesuffix(' \\') for line in lock.splitlines()
            if re.match(r'^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\[[^]]+\])?==', line)]
    if not pins:
        raise SystemExit('No exact deployment dependency pins were found.')
    (args.output/'requirements.txt').write_text('\n'.join(pins) + '\n')
    print(f'Packaged {len(files)} runtime files, {archive.stat().st_size} bytes; no configuration, credentials or source cache.')


if __name__ == '__main__': main()
