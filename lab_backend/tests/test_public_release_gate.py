"""Synthetic gate tests; a passing test does not certify any real deployment."""
import hashlib
from pathlib import Path
import importlib.util
import pytest

SPEC=importlib.util.spec_from_file_location('public_release_check',Path(__file__).resolve().parents[2]/'scripts/check_public_release.py')
module=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


def fixture(tmp_path):
    evidence=tmp_path/'test-evidence.json'
    evidence.write_text('{"scope":"synthetic gate unit fixture"}')
    reference={'path':evidence.name,'sha256':hashlib.sha256(evidence.read_bytes()).hexdigest()}
    manifest={'public_url':'https://example.test','depends_on_personal_computer':False,
              'checks':{name:{'status':'passed','evidence':[reference]} for name in module.REQUIRED}}
    return manifest,evidence


def test_complete_synthetic_manifest_passes_schema_gate(tmp_path):
    manifest,_=fixture(tmp_path)
    assert module.evaluate(manifest,tmp_path)==[]


@pytest.mark.parametrize('url',['http://127.0.0.1:8765','http://example.test',None,'https://localhost'])
def test_local_or_nonhttps_url_is_not_public_completion(tmp_path,url):
    manifest,_=fixture(tmp_path);manifest['public_url']=url
    assert 'No verified external HTTPS application URL' in module.evaluate(manifest,tmp_path)


def test_one_failed_scenario_prevents_release(tmp_path):
    manifest,_=fixture(tmp_path);manifest['checks']['paper']['status']='blocked'
    assert 'paper: blocked' in module.evaluate(manifest,tmp_path)


def test_changed_evidence_cannot_keep_a_passing_label(tmp_path):
    manifest,evidence=fixture(tmp_path);evidence.write_text('changed')
    assert any('hash mismatch' in item for item in module.evaluate(manifest,tmp_path))


def test_missing_and_out_of_root_artifacts_are_rejected(tmp_path):
    manifest,_=fixture(tmp_path)
    manifest['checks']['feedback']['evidence']=[{'path':'../private-file','sha256':'0'*64}]
    assert any('out-of-scope' in item for item in module.evaluate(manifest,tmp_path))


def test_personal_computer_dependency_is_not_complete(tmp_path):
    manifest,_=fixture(tmp_path);manifest['depends_on_personal_computer']=True
    assert 'Laptop independence has not been established' in module.evaluate(manifest,tmp_path)
