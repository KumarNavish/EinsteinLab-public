"""Isolated packaging tests. Synthetic native/GLB fixtures never run or deploy."""
import importlib.util
import hashlib
import json
from pathlib import Path
import shutil
import struct

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('fastapi_bundle', ROOT / 'scripts/build_fastapi_bundle.py')
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


@pytest.fixture
def source(tmp_path):
    root = tmp_path / 'source'
    for name in ('lab_backend/data', 'rehearsal/dist/assets', 'deploy/native/bin', 'deploy/fastapicloud'):
        (root / name).mkdir(parents=True)
    for name in ('__init__', 'presentation_linux', 'native_live'):
        (root / f'lab_backend/{name}.py').write_text('')
    (root / 'lab_backend/public_service.py').write_text('from .native_live import NativeBridge\n')
    (root / 'lab_backend/project_briefs.json').write_text('{}')
    (root / 'lab_backend/data/lab.json').write_text(json.dumps({'pages': [{'url': 'https://mobililab.ethz.ch/'}]}))
    (root / 'THIRD_PARTY_NOTICES.md').write_text('Synthetic packaging fixture notice.')
    for name in ('loader', 'office', 'pdfinfo'):
        (root / 'deploy/native/bin' / name).write_bytes(b'Synthetic non-executed packaging fixture')
    (root / 'deploy/slides-runtime.json').write_text(json.dumps({'architecture': 'linux-x86_64',
        'loader': 'bin/loader', 'office': 'bin/office', 'pdfinfo': 'bin/pdfinfo'}))
    (root / 'rehearsal/dist/index.html').write_text('<!doctype html><title>Synthetic packaging fixture</title>')
    with (root / 'rehearsal/dist/assets/einstein.glb').open('wb') as out:
        out.write(struct.pack('<4sII', b'glTF', 2, 1024 * 1024)); out.seek(1024 * 1024 - 1); out.write(b'\0')
    # Use actual reviewed public locks/templates; no runtime package install.
    for name in bundle.TEMPLATES:
        shutil.copy2(ROOT / 'deploy/fastapicloud' / name, root / 'deploy/fastapicloud' / name)
    shutil.copy2(ROOT / 'lab_backend/requirements-public.lock', root / 'lab_backend/requirements-public.lock')
    return root


def test_allowlisted_stage_hashes_match_source_and_exclude_unrelated_private_files(source, tmp_path):
    (source / '.env').write_text('SYNTHETIC_PRIVATE_FILE_DO_NOT_COPY')
    (source / 'lab_backend/speech.py').write_text('SYNTHETIC_UNRELATED_APPLE_MODULE_DO_NOT_COPY')
    output = tmp_path / 'stage'
    result = bundle.build(source, output)
    assert result['status'] == 'staged-not-deployed'
    assert result['entrypoint'] == 'main:app'
    assert bundle.validate_stage(source, output, result)
    assert not (output / '.env').exists() and not (output / 'lab_backend/speech.py').exists()
    assert not (output / '.git').exists() and not (output / 'deploy/fastapicloud/test_bundle.py').exists()
    assert (output / 'uv.lock').read_bytes() == (source / 'deploy/fastapicloud/uv.lock').read_bytes()
    (output / 'lab_backend/native_live.py').write_text('unreviewed edit')
    with pytest.raises(bundle.BundleError, match='differs'): bundle.validate_stage(source, output, result)


def test_extra_file_or_empty_directory_is_not_in_the_manifest(source, tmp_path):
    output = tmp_path / 'stage'; result = bundle.build(source, output)
    (output / 'extra-empty-directory').mkdir()
    with pytest.raises(bundle.BundleError, match='unreviewed'): bundle.validate_stage(source, output, result)


def test_native_execution_modes_match_source_and_manifest(source, tmp_path):
    native = source / 'deploy/native/bin/office'; native.chmod(0o755)
    output = tmp_path / 'stage'; result = bundle.build(source, output)
    staged = output / 'deploy/native/bin/office'; assert staged.stat().st_mode & 0o777 == 0o755
    staged.chmod(0o644)
    with pytest.raises(bundle.BundleError, match='mode'): bundle.validate_stage(source, output, result)
    staged.chmod(0o755); native.chmod(0o700)
    with pytest.raises(bundle.BundleError, match='mode'): bundle.validate_stage(source, output, result)


@pytest.mark.parametrize('relative', ['rehearsal/dist/.env', 'rehearsal/dist/private.key', 'rehearsal/dist/usage.sqlite3', 'rehearsal/dist/usage.sqlite3-wal', 'deploy/native/cache.db'])
def test_secret_and_database_paths_fail_before_any_staging(source, tmp_path, relative):
    (source / relative).write_text('synthetic private fixture')
    with pytest.raises(bundle.BundleError): bundle.build(source, tmp_path / 'stage')
    assert not (tmp_path / 'stage').exists()


def test_only_exact_native_catalog_bytes_are_allowed_and_revalidated(source, tmp_path, monkeypatch):
    assert bundle.PUBLIC_CATALOG_SHA256 == 'e7127eef5e5dbef519a8ad51bed5e84b21675b42240eb2a072220731843f3b15'
    # Isolated non-executed content exercises the hash pin without depending on
    # the ignored native artifact being rebuilt before this CI test runs.
    data = b'public package catalog fixture'.ljust(16_384, b'\0')
    monkeypatch.setattr(bundle, 'PUBLIC_CATALOG_SHA256', hashlib.sha256(data).hexdigest())
    catalog = source / bundle.PUBLIC_CATALOG
    catalog.parent.mkdir(parents=True); catalog.write_bytes(data)
    output = tmp_path / 'catalog-stage'; result = bundle.build(source, output)
    staged = output / bundle.PUBLIC_CATALOG
    assert staged.read_bytes() == data
    catalog.write_bytes(b'X' + data[1:])
    with pytest.raises(bundle.BundleError, match='catalog'): bundle.validate_stage(source, output, result)
    with pytest.raises(bundle.BundleError, match='catalog'): bundle.build(source, tmp_path / 'mutated-stage')
    assert not (tmp_path / 'mutated-stage').exists()
    catalog.write_bytes(data); staged.write_bytes(b'X' + data[1:])
    with pytest.raises(bundle.BundleError, match='catalog'): bundle.validate_stage(source, output, result)
    staged.write_bytes(data); catalog.unlink()
    target = source / 'deploy/native/bin/catalog-fixture'; target.write_bytes(data)
    catalog.symlink_to('../../../../bin/catalog-fixture')
    with pytest.raises(bundle.BundleError, match='catalog'): bundle.build(source, tmp_path / 'linked-stage')
    with pytest.raises(bundle.BundleError, match='catalog'): bundle.validate_stage(source, output, result)


def test_public_crypto_pem_exception_requires_pinned_regular_path_and_keeps_key_scans(source, tmp_path, monkeypatch):
    assert bundle.PUBLIC_PEM_BINARY_SHA256 == '779b25d20249988bea2c1aa6bbeb218f5ae7ea8a9d30ce4f54ea37372965cc4b'
    # A non-executed format fixture, not key material or an actual ELF binary.
    data = (b'-----BEGIN PRIVATE KEY-----\n' + b'A' * 64 + b'\n').ljust(2_209_528, b'\0')
    monkeypatch.setattr(bundle, 'PUBLIC_PEM_BINARY_SHA256', hashlib.sha256(data).hexdigest())
    library = source / bundle.PUBLIC_PEM_BINARY
    library.parent.mkdir(parents=True); library.write_bytes(data)
    output = tmp_path / 'crypto-stage'; result = bundle.build(source, output)
    staged = output / bundle.PUBLIC_PEM_BINARY
    library.write_bytes(b'X' + data[1:])
    with pytest.raises(bundle.BundleError, match='cryptographic'): bundle.validate_stage(source, output, result)
    library.write_bytes(data); staged.write_bytes(b'X' + data[1:])
    with pytest.raises(bundle.BundleError, match='cryptographic'): bundle.validate_stage(source, output, result)
    library.unlink(); library.symlink_to('other-library')
    (library.parent / 'other-library').write_bytes(data)
    with pytest.raises(bundle.BundleError, match='cryptographic'): bundle.build(source, tmp_path / 'symlinked-crypto-stage')
    library.unlink(); (library.parent / 'other-library').unlink()
    for key in (b'AIza' + b'x' * 35, b'AQ.' + b'x' * 40):
        content = key + data[len(key):]
        library.write_bytes(content)
        monkeypatch.setattr(bundle, 'PUBLIC_PEM_BINARY_SHA256', hashlib.sha256(content).hexdigest())
        with pytest.raises(bundle.BundleError, match='Credential-shaped'): bundle.build(source, tmp_path / 'key-stage')


def test_native_relative_symlink_is_preserved_but_escape_and_absolute_are_refused(source, tmp_path):
    link = source / 'deploy/native/bin/office-link'; link.symlink_to('office')
    output = tmp_path / 'valid-stage'; result = bundle.build(source, output)
    assert (output / 'deploy/native/bin/office-link').is_symlink()
    assert bundle.validate_stage(source, output, result)
    link.unlink(); link.symlink_to(tmp_path / 'outside-file')
    (tmp_path / 'outside-file').write_text('synthetic outside fixture')
    with pytest.raises(bundle.BundleError): bundle.build(source, tmp_path / 'bad-stage')


def test_frontend_symlink_and_embedded_credential_shape_are_refused_without_echo(source, tmp_path):
    target = source / 'rehearsal/dist/synthetic.js'
    target.symlink_to(source / 'THIRD_PARTY_NOTICES.md')
    with pytest.raises(bundle.BundleError): bundle.build(source, tmp_path / 'link-stage')
    target.unlink()
    fake = 'AIza' + 'x' * 35
    target.write_text(fake)
    with pytest.raises(bundle.BundleError) as error: bundle.build(source, tmp_path / 'secret-stage')
    assert fake not in str(error.value)


def test_private_pem_material_is_rejected_without_mistaking_crypto_header_constants_for_keys(source, tmp_path):
    # Shared crypto libraries legitimately contain format strings, not keys.
    (source / 'deploy/native/bin/crypto-format.so').write_bytes(b'-----BEGIN PRIVATE KEY-----\0')
    bundle.build(source, tmp_path / 'format-stage')
    kind = 'PRIVATE' + ' KEY'
    (source / 'rehearsal/dist/private.pem').write_text(f'-----BEGIN {kind}-----\n' + 'A' * 64 + f'\n-----END {kind}-----\n')
    with pytest.raises(bundle.BundleError, match='private-key material'): bundle.build(source, tmp_path / 'pem-stage')


def test_public_import_closure_refuses_apple_module_and_changed_lock(source, tmp_path):
    (source / 'lab_backend/public_service.py').write_text('from .runtime import local_model\n')
    (source / 'lab_backend/runtime.py').write_text('')
    with pytest.raises(bundle.BundleError, match='Apple'): bundle.build(source, tmp_path / 'apple-stage')
    (source / 'lab_backend/public_service.py').write_text('')
    lock = source / 'deploy/fastapicloud/uv.lock'
    lock.write_text(lock.read_text().replace('version = "0.0.32"', 'version = "0.0.31"'))
    with pytest.raises(bundle.BundleError, match='uv.lock'): bundle.build(source, tmp_path / 'lock-stage')


def test_missing_native_worker_or_artifact_never_creates_output(source, tmp_path):
    (source / 'lab_backend/presentation_linux.py').unlink()
    with pytest.raises(bundle.BundleError, match='missing'): bundle.build(source, tmp_path / 'stage')
    assert not (tmp_path / 'stage').exists()


def test_uv_artifact_hash_and_private_index_are_not_substitutable(source, tmp_path):
    lock = source / 'deploy/fastapicloud/uv.lock'; original = lock.read_text()
    import re
    lock.write_text(re.sub(r'hash = "sha256:[a-f0-9]{64}"', 'hash = "sha256:' + '0' * 64 + '"', original, count=1))
    with pytest.raises(bundle.BundleError, match='hash lock'): bundle.build(source, tmp_path / 'hash-stage')
    lock.write_text(original.replace('registry = "https://pypi.org/simple"', 'registry = "https://private.example.org/simple"', 1))
    with pytest.raises(bundle.BundleError, match='public package registry'): bundle.build(source, tmp_path / 'index-stage')


def test_output_cannot_alias_source_or_overwrite_existing_work(source, tmp_path):
    with pytest.raises(bundle.BundleError): bundle.build(source, source / 'rehearsal/dist/stage')
    output = tmp_path / 'existing'; output.mkdir(); (output / 'preserve').write_text('existing unrelated work')
    with pytest.raises(bundle.BundleError, match='not empty'): bundle.build(source, output)
    assert (output / 'preserve').read_text() == 'existing unrelated work'
