"""Offline parent guards only. Native policy execution uses the keyless host probe."""
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from lab_backend import presentation_linux as worker


def test_isolated_worker_blocks_planted_python_startup(tmp_path):
    marker = tmp_path / 'startup-executed'
    (tmp_path / 'sitecustomize.py').write_text('from pathlib import Path\nPath(' + repr(str(marker)) + ').write_text("unexpected")\n')
    environment = {'PATH': os.defpath, 'HOME': str(tmp_path), 'PYTHONPATH': str(tmp_path)}
    code = 'import ctypes,hashlib,json,pathlib,platform,re,resource,signal,socket,stat,subprocess,sys,time; print(json.dumps([sys.flags.isolated,sys.flags.no_site]))'
    subprocess.run([sys.executable, '-c', code], cwd=tmp_path, env=environment, check=True, capture_output=True, timeout=10)
    assert marker.exists()  # Confirm the disposable baseline exercises startup.
    marker.unlink()
    result = subprocess.run([sys.executable, '-I', '-S', '-c', code], cwd=tmp_path, env=environment, check=True, capture_output=True, timeout=10)
    assert not marker.exists()
    assert json.loads(result.stdout) == [1, 1]


def private_dirs(tmp_path):
    work, native = tmp_path / 'unique-conversion', tmp_path / 'native'
    work.mkdir(mode=0o700); native.mkdir()
    return native, work


def test_parent_stdout_symlink_cannot_truncate_outside_file(tmp_path, monkeypatch):
    native, work = private_dirs(tmp_path)
    secret = tmp_path / 'outside-private-file'; secret.write_bytes(b'protected bytes')
    (work / 'pdfinfo.stdout').symlink_to(secret)
    monkeypatch.setattr(worker.subprocess, 'Popen', lambda *a, **kw: pytest.fail('Child must not launch on a planted capture link'))
    with pytest.raises(worker.ConversionError):
        worker.run(native, work, 'pdfinfo', float('inf'))
    assert secret.read_bytes() == b'protected bytes'


def test_parent_reads_held_capture_fd_after_child_replaces_path(tmp_path, monkeypatch):
    native, work = private_dirs(tmp_path)
    secret = tmp_path / 'outside-private-file'; secret.write_bytes(b'protected bytes')
    class SyntheticChild:
        pid = 19999999
        returncode = None
    def launch(command, **kwargs):
        assert command[1:3] == ['-I', '-S']
        kwargs['stdout'].write(b'Pages: 1\n'); kwargs['stdout'].flush()
        (work / 'pdfinfo.stdout').unlink()
        (work / 'pdfinfo.stdout').symlink_to(secret)
        return SyntheticChild()
    monkeypatch.setattr(worker.subprocess, 'Popen', launch)
    monkeypatch.setattr(worker.os, 'wait4', lambda *args: (SyntheticChild.pid, 0, None))
    assert worker.run(native, work, 'pdfinfo', float('inf')) == b'Pages: 1\n'
    assert secret.read_bytes() == b'protected bytes'


def test_proof_canary_is_unique_and_removed(tmp_path, monkeypatch):
    native, work = private_dirs(tmp_path)
    canaries = []
    class SyntheticChild:
        pid = 19999998
        returncode = None
    def launch(command, **kwargs):
        canary = Path(command[command.index('--canary') + 1]); canaries.append(canary)
        assert canary.name == work.name + '-outside-policy-canary'
        assert canary.is_file()
        kwargs['stdout'].write(json.dumps({str(i): True for i in range(16)}).encode()); kwargs['stdout'].flush()
        return SyntheticChild()
    monkeypatch.setattr(worker.subprocess, 'Popen', launch)
    monkeypatch.setattr(worker.os, 'wait4', lambda *args: (SyntheticChild.pid, 0, None))
    worker.run(native, work, 'proof', float('inf'))
    assert canaries and not canaries[0].exists()


def test_supervisor_tolerates_exit_before_proc_status_read(tmp_path, monkeypatch):
    native, work = private_dirs(tmp_path)
    class SyntheticChild:
        pid = 19999996
        returncode = None
    def launch(command, **kwargs):
        kwargs['stdout'].write(b'Pages: 1\n'); kwargs['stdout'].flush()
        return SyntheticChild()
    waits = iter([(0, 0, None), (SyntheticChild.pid, 0, None)])
    def missing_status(path, *args, **kwargs):
        assert str(path) == f'/proc/{SyntheticChild.pid}/status'
        raise FileNotFoundError
    monkeypatch.setattr(worker.subprocess, 'Popen', launch)
    monkeypatch.setattr(worker.os, 'wait4', lambda *args: next(waits))
    monkeypatch.setattr(Path, 'read_text', missing_status)
    monkeypatch.setattr(worker.time, 'sleep', lambda _: None)
    assert worker.run(native, work, 'pdfinfo', float('inf')) == b'Pages: 1\n'


def test_supervisor_tolerates_vanishing_work_file(tmp_path, monkeypatch):
    native, work = private_dirs(tmp_path)
    vanished = work / 'removed-temp'
    vanished.write_bytes(b'temporary')
    real_lstat = Path.lstat
    class SyntheticChild:
        pid = 19999995
        returncode = None
    def launch(command, **kwargs):
        kwargs['stdout'].write(b'Pages: 1\n'); kwargs['stdout'].flush()
        return SyntheticChild()
    waits = iter([(0, 0, None), (SyntheticChild.pid, 0, None)])
    def raced_lstat(path, *args, **kwargs):
        if path == vanished:
            raise FileNotFoundError
        return real_lstat(path, *args, **kwargs)
    monkeypatch.setattr(worker.subprocess, 'Popen', launch)
    monkeypatch.setattr(worker.os, 'wait4', lambda *args: next(waits))
    monkeypatch.setattr(Path, 'read_text', lambda *args, **kwargs: 'VmRSS: 1000 kB\nThreads: 1\n')
    monkeypatch.setattr(Path, 'lstat', raced_lstat)
    monkeypatch.setattr(worker.time, 'sleep', lambda _: None)
    assert worker.run(native, work, 'pdfinfo', float('inf')) == b'Pages: 1\n'


def test_pinned_runtime_discovery_rejects_changed_bytes(tmp_path, monkeypatch):
    monkeypatch.delenv('EINSTEIN_SLIDES_NATIVE', raising=False)
    native = tmp_path / 'deploy/native'; native.mkdir(parents=True)
    expected = {'loader': 'lib/x86_64-linux-gnu/ld-linux-x86-64.so.2', 'office': 'usr/bin/lloconv', 'pdfinfo': 'usr/bin/pdfinfo',
                'seccomp': 'usr/lib/x86_64-linux-gnu/libseccomp.so.2', 'fonts': 'fonts.conf',
                'office_fundamentalrc': 'usr/lib/libreoffice/program/fundamentalrc'}
    for directory in ('usr/lib/libreoffice/program', 'lib/x86_64-linux-gnu', 'usr/lib/x86_64-linux-gnu', 'usr/lib', 'lib'):
        (native / directory).mkdir(parents=True, exist_ok=True)
    pins = {}
    for role, name in expected.items():
        path = native / name; path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'Synthetic discovery fixture; never executable: ' + name.encode())
        path.chmod(0o755 if role in {'loader', 'office', 'pdfinfo'} else 0o644)
        pins[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    (tmp_path / 'deploy/slides-runtime.json').write_text(json.dumps({'architecture': 'linux-x86_64', **expected, 'critical_files_sha256': pins}))
    assert worker.configured_native(tmp_path) == native
    (native / expected['office']).write_bytes(b'changed bytes')
    with pytest.raises(worker.ConversionError) as raised:
        worker.configured_native(tmp_path)
    assert raised.value.unavailable


@pytest.mark.parametrize(('status', 'code'), [
    ('VmRSS: 307201 kB\nVmData: 1200 kB\nVmSize: 1500000 kB\nThreads: 1\n', 'rss_limit'),
    ('VmRSS: 1000 kB\nVmData: 1200 kB\nVmSize: 1500000 kB\nThreads: 33\n', 'thread_limit'),
])
def test_resource_rejection_retains_content_free_cause_and_kills_child(tmp_path, monkeypatch, status, code):
    native, work = private_dirs(tmp_path)
    class SyntheticChild:
        pid = 19999993
        returncode = None
        def wait(self): self.returncode = -9
    killed = []
    monkeypatch.setattr(worker.subprocess, 'Popen', lambda *args, **kwargs: SyntheticChild())
    monkeypatch.setattr(worker.os, 'wait4', lambda *args: (0, 0, None))
    monkeypatch.setattr(worker.os, 'killpg', lambda *args: killed.append(args))
    monkeypatch.setattr(Path, 'read_text', lambda *args, **kwargs: status)
    with pytest.raises(worker.ConversionError) as raised:
        worker.run(native, work, 'office', float('inf'))
    error = raised.value
    assert error.code == code and not error.unavailable
    assert error.metrics['peak_rss_bytes'] == int(status.split()[1]) * 1024
    assert error.metrics['peak_data_bytes'] == 1200 * 1024
    assert error.metrics['peak_address_bytes'] == 1500000 * 1024
    assert error.metrics['peak_threads'] == int(status.split()[-1])
    assert error.metrics['elapsed_ms'] >= 0
    assert set(error.metrics) == {'elapsed_ms', 'peak_rss_bytes', 'peak_data_bytes', 'peak_address_bytes', 'peak_threads', 'peak_work_bytes', 'exit_code'}
    assert killed == [(SyntheticChild.pid, worker.signal.SIGKILL)]


def test_failure_classification_reads_held_stderr_not_replaced_path(tmp_path, monkeypatch):
    native, work = private_dirs(tmp_path)
    outside = tmp_path / 'private-outside-file'; outside.write_bytes(b'private outside bytes')
    class SyntheticChild:
        pid = 19999992
        returncode = None
    def launch(command, **kwargs):
        kwargs['stderr'].write(b'private document text: LibreOfficeKit failed to load document (bad_alloc)')
        kwargs['stderr'].flush()
        assert (work / 'office.stderr').stat().st_mode & 0o777 == 0o600
        (work / 'office.stderr').unlink()
        (work / 'office.stderr').symlink_to(outside)
        return SyntheticChild()
    monkeypatch.setattr(worker.subprocess, 'Popen', launch)
    monkeypatch.setattr(worker.os, 'wait4', lambda *args: (SyntheticChild.pid, 1 << 8, None))
    with pytest.raises(worker.ConversionError) as raised:
        worker.run(native, work, 'office', float('inf'))
    error = raised.value
    assert error.code == 'worker_exit' and error.metrics['exit_code'] == 1
    assert error.signatures == ('native_load_failed', 'out_of_memory')
    assert 'private document' not in str(error) and str(outside) not in str(error)
    assert outside.read_bytes() == b'private outside bytes'


def test_stderr_capture_link_cannot_truncate_outside_file(tmp_path, monkeypatch):
    native, work = private_dirs(tmp_path)
    outside = tmp_path / 'private-outside-file'; outside.write_bytes(b'private outside bytes')
    (work / 'office.stderr').symlink_to(outside)
    monkeypatch.setattr(worker.subprocess, 'Popen', lambda *args, **kwargs: pytest.fail('Do not launch with a planted capture link'))
    with pytest.raises(worker.ConversionError):
        worker.run(native, work, 'office', float('inf'))
    assert outside.read_bytes() == b'private outside bytes'


def test_classification_reads_only_4096_bytes_and_returns_no_child_text():
    assert worker._stderr_signatures(io.BytesIO(b'private arbitrary text')) == ()
    assert worker._stderr_signatures(io.BytesIO(b'x' * 4096 + b'bad_alloc')) == ()
    assert worker._stderr_signatures(io.BytesIO(b'LibreOfficeKit failed to export (private document text)')) == ('native_export_failed',)
