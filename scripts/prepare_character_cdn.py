#!/usr/bin/env python3
"""Split the pinned original GLB for the existing free Einstein static CDN.

No network, credentials, texture conversion or model changes. The browser checks
every chunk and the assembled original before parsing it.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ORIGIN = 'https://einstein-mobiliar-lab.netlify.app'
CHUNK_BYTES = 4 * 1024 * 1024


def prepare(root=ROOT):
    pins = json.loads((root / 'deploy/release-inputs.json').read_text())
    asset = next(a for a in pins['assets'] if a['name'] == 'einstein.glb')
    data = (root / asset['path']).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if len(data) != asset['bytes'] or digest != asset['sha256']:
        raise ValueError('Character differs from its approved release pin.')
    prefix = f'/character/{digest}/'
    folder = root / 'feedback-site' / prefix.lstrip('/')
    folder.mkdir(parents=True, exist_ok=True)
    chunks = []
    for number, offset in enumerate(range(0, len(data), CHUNK_BYTES)):
        chunk = data[offset:offset + CHUNK_BYTES]
        checksum = hashlib.sha256(chunk).hexdigest()
        name = f'{number:03d}-{checksum}.bin'
        (folder / name).write_bytes(chunk)
        chunks.append({'name': name, 'bytes': len(chunk), 'sha256': checksum})
    if {p.name for p in folder.iterdir()} != {c['name'] for c in chunks}:
        raise ValueError('Unexpected file in the immutable character directory.')
    manifest = {'origin': ORIGIN, 'pathPrefix': prefix, 'bytes': len(data),
                'sha256': digest, 'chunks': chunks}
    target = root / 'rehearsal/src/character-transfer.json'
    target.write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest


if __name__ == '__main__':
    manifest = prepare()
    print(json.dumps({'original_bytes': manifest['bytes'], 'sha256': manifest['sha256'],
                      'chunks': len(manifest['chunks']), 'maximum_chunk_bytes': CHUNK_BYTES,
                      'network_requests': 0, 'model_bytes_changed': False}))
