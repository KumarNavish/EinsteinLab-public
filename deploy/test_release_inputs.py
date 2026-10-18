"""Offline release-input adversarial fixtures; no GitHub/provider connections."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location('release_inputs', ROOT / 'deploy/fetch_release_inputs.py')
INPUTS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INPUTS)


class ReleaseInputs(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.addCleanup(patch.stopall)
        patch.dict('os.environ', {'GH_TOKEN': 'synthetic-read-only-token'}).start()
        self.calls = []
        self.pins = json.loads((ROOT / 'deploy/release-inputs.json').read_text())
        self.payloads = {'einstein.glb': b'synthetic-glb-fixture', 'lab.json': b'{"pages":[]}'}
        for asset in self.pins['assets']:
            data = self.payloads[asset['name']]
            asset.update(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
        self.release = {'id': self.pins['release_id'], 'tag_name': self.pins['release_tag'], 'draft': False,
                        'assets': [{'id': a['asset_id'], 'name': a['name'], 'size': a['bytes'], 'state': 'uploaded', 'digest': 'sha256:' + a['sha256']} for a in self.pins['assets']]}

    def gh_run(self, arguments, **options):
        self.calls.append(arguments)
        self.assertEqual(options, {'check': True, 'capture_output': True, 'text': True, 'timeout': 120})
        if arguments[1] == 'api':
            return subprocess.CompletedProcess(arguments, 0, json.dumps(self.release), '')
        folder = Path(arguments[arguments.index('--dir') + 1])
        self.assertEqual(arguments[1:10], ['release', 'download', self.pins['release_tag'], '--repo', INPUTS.REPOSITORY, '--pattern', 'einstein.glb', '--pattern', 'lab.json'])
        self.assertEqual(list(folder.iterdir()), [])
        for name, data in self.payloads.items():
            (folder / name).write_bytes(data)
        return subprocess.CompletedProcess(arguments, 0, '', '')

    def test_published_metadata_and_exact_bytes_are_both_required(self):
        result = INPUTS.fetch(self.root, self.pins, run=self.gh_run)
        self.assertEqual(len(result), 2)
        for asset in self.pins['assets']:
            self.assertEqual((self.root / asset['path']).read_bytes(), self.payloads[asset['name']])
        self.release['assets'][0]['digest'] = 'sha256:' + '0' * 64
        with self.assertRaisesRegex(INPUTS.InputError, 'metadata'):
            INPUTS.fetch(self.root, self.pins, run=self.gh_run)

    def test_pending_publication_wrong_repo_and_destination_fail_before_download(self):
        path = self.root / 'inputs.json'
        for field, value in [('release_id', None), ('repository', 'attacker/elsewhere')]:
            pins = copy.deepcopy(self.pins); pins[field] = value
            path.write_text(json.dumps(pins))
            with self.assertRaises(INPUTS.InputError):
                INPUTS.read_pins(path)
        pins = copy.deepcopy(self.pins); pins['assets'][0]['path'] = '../../other.glb'
        path.write_text(json.dumps(pins))
        with self.assertRaises(INPUTS.InputError):
            INPUTS.read_pins(path)

    def test_wrong_download_or_existing_bytes_do_not_get_overwritten(self):
        self.payloads['lab.json'] = b'{"wrong":[]}'
        with self.assertRaisesRegex(INPUTS.InputError, 'SHA256'):
            INPUTS.fetch(self.root, self.pins, run=self.gh_run)
        path = self.root / self.pins['assets'][0]['path']
        self.assertFalse(path.exists())
        path.parent.mkdir(parents=True); path.write_bytes(b'existing unrelated bytes')
        with self.assertRaises(INPUTS.InputError):
            INPUTS.fetch(self.root, self.pins, run=self.gh_run)
        self.assertEqual(path.read_bytes(), b'existing unrelated bytes')

    def test_symlink_destination_is_rejected_without_touching_target(self):
        outside = self.root / 'outside'; outside.mkdir()
        (self.root / 'rehearsal').symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(INPUTS.InputError, 'symlink'):
            INPUTS.fetch(self.root, self.pins, run=self.gh_run)
        self.assertEqual(list(outside.iterdir()), [])

    def test_gh_failure_is_sanitized_and_no_download_url_is_accepted(self):
        def failure(arguments, **_options):
            raise subprocess.CalledProcessError(1, arguments, stderr='synthetic-token https://example.invalid/?signature=private-fixture')
        with self.assertRaises(INPUTS.InputError) as result:
            INPUTS.fetch(self.root, self.pins, run=failure)
        self.assertNotIn('synthetic-token', str(result.exception))
        self.assertNotIn('private-fixture', str(result.exception))

    def test_ci_lock_is_exact_and_uses_only_public_registry_artifacts(self):
        import tomllib
        lock = tomllib.loads((ROOT / 'deploy/ci-tools/uv.lock').read_text())
        packages = {item['name']: item for item in lock['package']}
        self.assertEqual(packages['fastapi']['version'], '0.143.0')
        self.assertEqual(packages['fastapi-cloud-cli']['version'], '0.26.0')
        self.assertEqual(packages['pytest']['version'], '9.1.1')
        for name, package in packages.items():
            if name == 'einstein-deploy-tools':
                self.assertEqual(package['source'], {'virtual': '.'})
                continue
            self.assertEqual(package['source'], {'registry': 'https://pypi.org/simple'})
            for artifact in [package.get('sdist', {}), *package.get('wheels', [])]:
                if artifact:
                    self.assertTrue(artifact['url'].startswith('https://files.pythonhosted.org/'))
                    self.assertRegex(artifact['hash'], r'^sha256:[a-f0-9]{64}$')


if __name__ == '__main__':
    unittest.main()
