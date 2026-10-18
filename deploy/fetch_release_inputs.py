#!/usr/bin/env python3
"""Retrieve two hash-pinned private release inputs; never create a release/token."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

REPOSITORY = 'KumarNavish/EinsteinLab'
TARGETS = {'einstein.glb': ('rehearsal/public/assets/einstein.glb', 80_000_000),
           'lab.json': ('lab_backend/data/lab.json', 2_000_000)}


class InputError(ValueError):
    pass


def read_pins(path, *, published=True):
    if path.stat().st_size > 32_768:
        raise InputError('Release-input manifest is too large.')
    pins = json.loads(path.read_text())
    if pins.get('schema') != 1 or pins.get('repository') != REPOSITORY:
        raise InputError('Release inputs must belong to the fixed private application repository.')
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}', pins.get('release_tag', '')):
        raise InputError('Invalid release tag.')
    assets = pins.get('assets', [])
    if not isinstance(assets, list) or len(assets) != 2 or not all(isinstance(a, dict) for a in assets) or {a.get('name') for a in assets} != set(TARGETS):
        raise InputError('Expected exactly the approved GLB and public lab snapshot.')
    for asset in assets:
        target, maximum = TARGETS[asset['name']]
        if asset.get('path') != target or type(asset.get('bytes')) is not int or not 1 <= asset['bytes'] <= maximum:
            raise InputError('A release input has an unexpected destination or size.')
        if not re.fullmatch(r'[a-f0-9]{64}', asset.get('sha256', '')):
            raise InputError('A release input is missing its exact SHA256.')
    if published and (pins.get('state') != 'published-and-verified' or type(pins.get('release_id')) is not int or pins['release_id'] <= 0 or any(type(a.get('asset_id')) is not int or a['asset_id'] <= 0 for a in assets)):
        raise InputError('Publish and verify the private release inputs, then commit their numeric IDs and published-and-verified state.')
    return pins


def verify(data, asset):
    if len(data) != asset['bytes'] or hashlib.sha256(data).hexdigest() != asset['sha256']:
        raise InputError('Release input differs from its pinned size or SHA256.')


def destination(root, asset):
    path = root / asset['path']
    for part in (path, *path.parents):
        if part == root:
            break
        if part.is_symlink():
            raise InputError('Release input destination must not contain symlinks.')
    if not path.resolve().is_relative_to(root.resolve()):
        raise InputError('Release input destination escaped its checkout.')
    return path


def fetch(root, pins, *, run=subprocess.run):
    if not os.environ.get('GH_TOKEN'):
        raise InputError('A read-only repository GH_TOKEN is required; no token is created.')
    def gh(*arguments):
        try:
            return run(['gh', *arguments], check=True, capture_output=True, text=True, timeout=120).stdout
        except (subprocess.SubprocessError, OSError):
            raise InputError('GitHub release retrieval failed; credentials and network details are not recorded.') from None
    targets = [(asset, destination(root, asset)) for asset in pins['assets']]
    for asset, path in targets:
        if path.exists():
            verify(path.read_bytes(), asset)
    release = json.loads(gh('api', '--method', 'GET', f'repos/{REPOSITORY}/releases/{pins["release_id"]}'))
    if release.get('id') != pins['release_id'] or release.get('tag_name') != pins['release_tag'] or release.get('draft') is not False:
        raise InputError('The private release identity or publication state differs from its pin.')
    published = {a['id']: a for a in release.get('assets', [])}
    for asset, _path in targets:
        record = published.get(asset['asset_id'], {})
        if record.get('name') != asset['name'] or record.get('size') != asset['bytes'] or record.get('state') != 'uploaded' or record.get('digest') != 'sha256:' + asset['sha256']:
            raise InputError('GitHub release metadata differs from the committed input pins.')
    if any(not path.exists() for _asset, path in targets):
        with tempfile.TemporaryDirectory(prefix='einstein-release-inputs-') as temporary:
            folder = Path(temporary)
            gh('release', 'download', pins['release_tag'], '--repo', REPOSITORY,
               '--pattern', 'einstein.glb', '--pattern', 'lab.json', '--dir', str(folder))
            if {path.name for path in folder.iterdir()} != set(TARGETS):
                raise InputError('GitHub download contains unexpected or missing release inputs.')
            for asset, _path in targets:
                source = folder / asset['name']
                if source.is_symlink() or not source.is_file() or source.stat().st_size != asset['bytes']:
                    raise InputError('GitHub download has an unexpected file type or size.')
                verify(source.read_bytes(), asset)
            for asset, path in targets:
                if path.exists():
                    continue
                path.parent.mkdir(parents=True, exist_ok=True)
                destination(root, asset)
                with path.open('xb') as stream:
                    stream.write((folder / asset['name']).read_bytes())
    return [{'path': a['path'], 'bytes': a['bytes'], 'sha256': a['sha256']} for a, _path in targets]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify-only', action='store_true', help='Check existing local bytes without network or credentials.')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    try:
        pins = read_pins(root / 'deploy/release-inputs.json', published=not args.verify_only)
        if args.verify_only:
            for asset in pins['assets']:
                verify(destination(root, asset).read_bytes(), asset)
            result = {'status': 'local-input-bytes-verified', 'network': False}
        else:
            result = {'status': 'release-inputs-verified', 'inputs': fetch(root, pins)}
    except InputError as error:
        raise SystemExit('Release inputs refused: ' + str(error)) from None
    except (OSError, ValueError, KeyError, TypeError):
        # URLs may contain temporary credentials; never print a raw network exception.
        raise SystemExit('Release inputs refused. Check committed pins, publication state, read-only access and local input bytes; no credential is recorded.') from None
    print(json.dumps(result))


if __name__ == '__main__':
    main()
