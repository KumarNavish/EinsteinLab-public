#!/usr/bin/env python3
"""Stage an allowlisted, source-verified FastAPI app. No deploy or key access."""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import struct
import tomllib
from urllib.parse import urlsplit

TEMPLATES = ('main.py', 'pyproject.toml', 'uv.lock', '.python-version', '.fastapicloudignore')
FORBIDDEN_PARTS = {'.git', '.work', '.venv', '__pycache__', '.cache', '.pytest_cache', '.mypy_cache', '.ruff_cache', 'node_modules', 'models', 'checkpoints'}
FORBIDDEN_BACKENDS = {'app', 'audio', 'evidence_packet', 'grounding', 'narrator', 'presence_service', 'release_host', 'runtime', 'speech'}
SECRET = re.compile(rb'AIza[A-Za-z0-9_-]{30,}|AQ\.[A-Za-z0-9_-]{35,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=]{40}')
PUBLIC_CATALOG = Path('deploy/native/usr/lib/x86_64-linux-gnu/avahi/service-types.db')
PUBLIC_CATALOG_SHA256 = 'e7127eef5e5dbef519a8ad51bed5e84b21675b42240eb2a072220731843f3b15'
PUBLIC_PEM_BINARY = Path('deploy/native/usr/lib/x86_64-linux-gnu/libgnutls.so.30.34.3')
PUBLIC_PEM_BINARY_SHA256 = '779b25d20249988bea2c1aa6bbeb218f5ae7ea8a9d30ce4f54ea37372965cc4b'


class BundleError(ValueError):
    pass


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def safe_name(path, *, native=False, source=None):
    parts = path.parts
    if path.is_absolute() or '..' in parts or any(p in FORBIDDEN_PARTS for p in parts):
        raise BundleError('A forbidden runtime path was selected.')
    if any(p == '.env' or p.startswith('.env.') for p in parts) or path.suffix.lower() in {'.key', '.pyc', '.p12', '.pfx'}:
        raise BundleError('A secret, database or cache path was selected.')
    if path == PUBLIC_PEM_BINARY and not (native and source is not None and not source.is_symlink()
            and source.is_file() and source.stat().st_size == 2_209_528 and digest(source) == PUBLIC_PEM_BINARY_SHA256):
        raise BundleError('The public cryptographic library differs from its exact regular-file pin.')
    if re.search(r'\.(?:sqlite3?|db)(?:-(?:wal|shm|journal))?$', path.name, re.I):
        if not (native and path == PUBLIC_CATALOG and source is not None and not source.is_symlink()
                and source.is_file() and source.stat().st_size == 16_384 and digest(source) == PUBLIC_CATALOG_SHA256):
            raise BundleError('A database path is not the exact pinned public native catalog.')


def checked(path, boundary, *, native=False):
    if not path.exists() and not path.is_symlink():
        raise BundleError(f'Required runtime input is missing: {path.name}')
    try: resolved = path.resolve(strict=True)
    except (OSError, RuntimeError): raise BundleError('A runtime input is missing or contains an invalid symlink.') from None
    if not resolved.is_relative_to(boundary.resolve()):
        raise BundleError('A runtime input or symlink escapes its source boundary.')
    for parent in (path, *path.parents):
        if parent == boundary: break
        if parent.is_symlink() and not native:
            raise BundleError('Non-native runtime inputs must not contain symlinks.')
    if path.is_symlink() and (not native or Path(os.readlink(path)).is_absolute()):
        raise BundleError('Only contained relative native symlinks may be staged.')
    if not (path.is_file() or path.is_dir() or path.is_symlink()):
        raise BundleError('Devices, sockets and special files cannot be staged.')
    return path


def public_modules(root):
    """Follow the real public entrypoint's relative imports, including lazy imports."""
    todo, modules = ['public_service', 'presentation_linux'], set()
    while todo:
        name = todo.pop()
        if name in modules: continue
        if name in FORBIDDEN_BACKENDS:
            raise BundleError('The public import path reached an Apple/local-runtime module.')
        source = checked(root / 'lab_backend' / f'{name}.py', root)
        modules.add(name)
        for node in ast.walk(ast.parse(source.read_text())):
            if isinstance(node, ast.ImportFrom) and node.level:
                if node.level != 1: raise BundleError('Unexpected backend import above its package.')
                names = [node.module.split('.')[0]] if node.module else [item.name for item in node.names]
                todo.extend(item for item in names if (root / 'lab_backend' / f'{item}.py').is_file())
            if isinstance(node, ast.ImportFrom) and not node.level and node.module:
                if node.module.split('.')[0].startswith(('mlx', 'whisper', 'kokoro')):
                    raise BundleError('A local-model import entered the public runtime.')
                if node.module.startswith('lab_backend.'):
                    todo.append(node.module.split('.')[1])
            if isinstance(node, ast.Import):
                names = [item.name.split('.')[0] for item in node.names]
                if any(name.startswith(('mlx', 'whisper', 'kokoro')) for name in names):
                    raise BundleError('A local-model import entered the public runtime.')
    return [root / 'lab_backend/__init__.py', *(root / 'lab_backend' / f'{name}.py' for name in sorted(modules))]


def dependency_pins(root):
    lock = checked(root / 'lab_backend/requirements-public.lock', root)
    text = lock.read_text()
    pins = dict(re.findall(r'^([A-Za-z0-9][A-Za-z0-9_.-]*)==([^\s\\]+)', text, re.M))
    approved_hashes = {}
    for block in re.split(r'(?m)^(?=[A-Za-z0-9][A-Za-z0-9_.-]*==)', text):
        name = re.match(r'([A-Za-z0-9][A-Za-z0-9_.-]*)==', block)
        if name: approved_hashes[name[1]] = set(re.findall(r'--hash=sha256:([a-f0-9]{64})', block))
    if not pins or any(name.lower().startswith(('mlx', 'whisper', 'kokoro', 'torch', 'gradio')) for name in pins):
        raise BundleError('The public dependency lock is missing or contains local-model dependencies.')
    project = tomllib.loads(checked(root / 'deploy/fastapicloud/pyproject.toml', root).read_text())
    if project['project'].get('requires-python') != '>=3.13,<3.14' or checked(root / 'deploy/fastapicloud/.python-version', root).read_text().strip() != '3.13.16':
        raise BundleError('The staging Python target differs from the verified host runtime.')
    matches = [re.fullmatch(r'([A-Za-z0-9][A-Za-z0-9_.-]*)==([^\s]+)', item) for item in project['project']['dependencies']]
    if not all(matches): raise BundleError('Project dependencies must be exact public registry pins.')
    declared = dict(match.groups() for match in matches)
    expected = {**pins, 'fastapi-cli': '0.0.32'}
    if declared != expected or project.get('tool', {}).get('fastapi', {}).get('entrypoint') != 'main:app':
        raise BundleError('FastAPI project dependencies differ from canonical pins plus the exact startup CLI.')
    resolved = tomllib.loads(checked(root / 'deploy/fastapicloud/uv.lock', root).read_text())
    versions = {item['name']: item['version'] for item in resolved['package']}
    for name, version in expected.items():
        if versions.get(name.replace('_', '-').lower()) != version:
            raise BundleError('The generated uv.lock differs from the canonical dependency pins.')
    if any(name in versions for name in ('fastapi-cloud-cli', 'mlx', 'mlx-lm', 'torch', 'gradio')):
        raise BundleError('Unneeded deployment/account or local-model dependencies entered uv.lock.')
    for package in resolved['package']:
        if package['name'] == project['project']['name']:
            if package.get('source') != {'virtual': '.'}: raise BundleError('Unexpected local project source in uv.lock.')
            continue
        if package.get('source') != {'registry': 'https://pypi.org/simple'}:
            raise BundleError('uv.lock must contain only the public package registry.')
        for artifact in [package.get('sdist', {}), *package.get('wheels', [])]:
            if not artifact: continue
            url = urlsplit(artifact.get('url', ''))
            if url.scheme != 'https' or url.hostname != 'files.pythonhosted.org' or url.username or url.password or url.query or url.fragment:
                raise BundleError('A dependency artifact has an unexpected or credential-bearing URL.')
            hash_value = artifact.get('hash', '').removeprefix('sha256:')
            if not re.fullmatch(r'[a-f0-9]{64}', hash_value) or (package['name'] in approved_hashes and hash_value not in approved_hashes[package['name']]):
                raise BundleError('A dependency artifact differs from its canonical hash lock.')
    return pins


def inputs(root):
    pins = dependency_pins(root)
    native = checked(root / 'deploy/native', root)
    if native.is_symlink(): raise BundleError('The native runtime root cannot be a symlink.')
    manifest = checked(root / 'deploy/slides-runtime.json', root)
    runtime = json.loads(manifest.read_text())
    if runtime.get('architecture') != 'linux-x86_64':
        raise BundleError('The native artifact must target Linux x86_64.')
    for key in ('loader', 'office', 'pdfinfo'):
        name = Path(runtime.get(key, ''))
        safe_name(name)
        if not str(name) or str(name) == '.': raise BundleError('The native manifest is incomplete.')
        checked(native / name, native, native=True)
    source = checked(root / 'lab_backend/data/lab.json', root)
    snapshot = json.loads(source.read_text())
    if not isinstance(snapshot.get('pages'), list) or not snapshot['pages']:
        raise BundleError('The packaged public lab snapshot is empty.')
    for page in snapshot['pages']:
        url = urlsplit(page.get('url', ''))
        if url.scheme != 'https' or url.hostname not in {'mobililab.ethz.ch', 'mobiliarlab.ethz.ch'} or url.username or url.password or url.port:
            raise BundleError('The lab snapshot contains a page outside the official public scope.')
    asset = checked(root / 'rehearsal/dist/assets/einstein.glb', root)
    with asset.open('rb') as stream: header = stream.read(12)
    if asset.stat().st_size < 1024 * 1024 or len(header) != 12 or struct.unpack('<4sII', header) != (b'glTF', 2, asset.stat().st_size):
        raise BundleError('Build the frontend GLB before staging; its container is missing or invalid.')
    selected = [(path.relative_to(root), path, False) for path in public_modules(root)]
    selected += [(Path('lab_backend/project_briefs.json'), root / 'lab_backend/project_briefs.json', False),
                 (Path('lab_backend/data/lab.json'), source, False),
                 (Path('THIRD_PARTY_NOTICES.md'), root / 'THIRD_PARTY_NOTICES.md', False),
                 (Path('requirements-public.lock'), root / 'lab_backend/requirements-public.lock', False),
                 (Path('deploy/slides-runtime.json'), manifest, False)]
    selected += [(Path(name), root / 'deploy/fastapicloud' / name, False) for name in TEMPLATES]
    selected += [(path.relative_to(root), path, False) for path in sorted((root / 'rehearsal/dist').rglob('*'))]
    selected += [(path.relative_to(root), path, True) for path in [native, *sorted(native.rglob('*'))]]
    return selected, pins, snapshot


def validate_stage(root, output, manifest):
    expected = {item['path']: item for item in manifest['entries']}
    actual = {path.relative_to(output).as_posix(): path for path in output.rglob('*')}
    if set(actual) - {'BUNDLE_MANIFEST.json'} != set(expected):
        raise BundleError('The staged directory has missing or unreviewed entries.')
    for name, entry in expected.items():
        destination, source = actual[name], root / entry['source']
        checked(source, root / 'deploy/native' if entry['native'] else root, native=entry['native'])
        checked(destination, output / 'deploy/native' if entry['native'] else output, native=entry['native'])
        safe_name(Path(name), native=entry['native'], source=source)
        safe_name(Path(name), native=entry['native'], source=destination)
        if entry['kind'] == 'file':
            if destination.is_symlink() or not destination.is_file() or digest(destination) != entry['sha256'] or digest(source) != entry['sha256']:
                raise BundleError('A staged runtime file differs from its current source.')
            if stat.S_IMODE(source.stat().st_mode) != entry['mode'] or stat.S_IMODE(destination.stat().st_mode) != entry['mode']:
                raise BundleError('A staged runtime file mode differs from its manifest or current source.')
        elif entry['kind'] == 'symlink':
            if not destination.is_symlink() or os.readlink(destination) != entry['target'] or os.readlink(source) != entry['target']:
                raise BundleError('A staged native symlink differs from its current source.')
        elif not destination.is_dir() or destination.is_symlink():
            raise BundleError('A staged runtime directory changed type.')
    return True


def build(root, output):
    root, output = root.resolve(), output.absolute()
    if output == root or root.is_relative_to(output) or any(parent.is_symlink() for parent in (output, *output.parents)):
        raise BundleError('Choose a new, separate non-symlink staging directory.')
    output = output.resolve()
    if any(output.is_relative_to(root / name) for name in ('lab_backend', 'rehearsal', 'deploy', 'scripts')):
        raise BundleError('The output cannot be inside an application input directory.')
    if output.exists() and any(output.iterdir()):
        raise BundleError('The staging directory is not empty; choose a fresh output without deleting prior evidence.')
    selected, pins, snapshot = inputs(root)
    # Account explicitly for intermediate directories, so injected empty folders
    # are rejected as well as extra files during final inventory validation.
    entries = {}
    for relative, source, native in selected:
        checked(source, root / 'deploy/native' if native else root, native=native)
        safe_name(relative, native=native, source=source)
        if relative.as_posix() in entries: continue
        entry = {'path': relative.as_posix(), 'source': source.relative_to(root).as_posix(), 'native': native}
        if source.is_symlink(): entry.update(kind='symlink', target=os.readlink(source))
        elif source.is_dir(): entry.update(kind='directory')
        else:
            data = source.read_bytes()
            matches = list(SECRET.finditer(data))
            if matches and (relative != PUBLIC_PEM_BINARY or any(not match.group().startswith(b'-----BEGIN ') for match in matches)):
                raise BundleError('Credential-shaped or private-key material was found; no value is displayed.')
            entry.update(kind='file', bytes=len(data), sha256=hashlib.sha256(data).hexdigest(), mode=stat.S_IMODE(source.stat().st_mode))
        entries[entry['path']] = entry
    for name, entry in list(entries.items()):
        for parent in Path(name).parents:
            if parent == Path('.'): continue
            if parent.as_posix() not in entries:
                # Renamed top-level templates have no directory parent; runtime
                # intermediate directories retain their real source directory.
                entries[parent.as_posix()] = {'path': parent.as_posix(), 'source': parent.as_posix(), 'native': parent.is_relative_to(Path('deploy/native')), 'kind': 'directory'}
    output.mkdir(parents=True, exist_ok=True)
    for entry in sorted(entries.values(), key=lambda item: (len(Path(item['path']).parts), item['path'])):
        source, destination = root / entry['source'], output / entry['path']
        if entry['kind'] == 'directory': destination.mkdir(exist_ok=True)
        elif entry['kind'] == 'symlink': destination.symlink_to(entry['target'])
        else:
            checked(source, root / 'deploy/native' if entry['native'] else root, native=entry['native'])
            data, metadata = source.read_bytes(), source.stat()
            if hashlib.sha256(data).hexdigest() != entry['sha256'] or stat.S_IMODE(metadata.st_mode) != entry['mode']:
                raise BundleError('A runtime input changed before it could be staged.')
            with destination.open('xb') as stream: stream.write(data)
            destination.chmod(entry['mode'])
            os.utime(destination, ns=(metadata.st_atime_ns, metadata.st_mtime_ns))
    manifest = {'schema': 1, 'status': 'staged-not-deployed', 'entrypoint': 'main:app', 'hostPort': 8080,
                'targetPython': '3.13.16', 'publicDependencyPins': pins, 'startupTooling': {'fastapi-cli': '0.0.32'},
                'publicSnapshotPages': len(snapshot['pages']), 'sourceSecretsIncluded': False,
                'entries': sorted(entries.values(), key=lambda item: item['path'])}
    manifest['fileCount'] = sum(e['kind'] == 'file' for e in manifest['entries'])
    manifest['fileBytes'] = sum(e.get('bytes', 0) for e in manifest['entries'])
    validate_stage(root, output, manifest)
    (output / 'BUNDLE_MANIFEST.json').write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n')
    validate_stage(root, output, manifest)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try: manifest = build(Path(__file__).resolve().parent.parent, args.output)
    except (BundleError, OSError, KeyError, ValueError) as error:
        raise SystemExit(f'Staging refused: {error}') from None
    print(json.dumps({'status': manifest['status'], 'files': manifest['fileCount'], 'bytes': manifest['fileBytes'],
                      'entrypoint': manifest['entrypoint'], 'port': manifest['hostPort'], 'secretsIncluded': False}))


if __name__ == '__main__': main()
