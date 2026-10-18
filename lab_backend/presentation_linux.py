"""Confined optional Linux PPTX worker. Uses only stdlib before native exec.

The parent supplies a pinned runtime and private ephemeral work directory.
Missing Landlock ABI6 or any policy primitive fails closed. No worker text is
returned to a visitor or written to application logs.
"""
import argparse
import ctypes
import errno
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import resource
import signal
import socket
import stat
import subprocess
import sys
import time

READ = (1 << 2) | (1 << 3)
EXECUTE = 1 << 0
WORK = READ | sum(1 << bit for bit in (1, 4, 5, 7, 8, 12, 13, 14))
MAX_PDF = 20 * 1024 * 1024
MAX_WORK = 80 * 1024 * 1024
MAX_RSS = 300 * 1024 * 1024
MAX_THREADS = 32


def environment(native, work):
    program = native / "usr/lib/libreoffice/program"
    return {"PATH": "/nonexistent", "HOME": str(work), "TMPDIR": str(work), "LANG": "C.UTF-8",
            "XDG_CACHE_HOME": str(work / "cache"), "XDG_CONFIG_HOME": str(work / "config"),
            "SAL_USE_VCLPLUGIN": "svp", "SAL_DISABLE_OPENCL": "1", "SAL_DISABLE_JAVA": "1", "MAX_CONCURRENCY": "2",
            "URE_BOOTSTRAP": "vnd.sun.star.pathname:" + str(program / "fundamentalrc"),
            "UNO_PATH": str(program), "LO_PATH": str(program), "UserInstallation": (work / "profile").as_uri(),
            "FONTCONFIG_FILE": str(native / "fonts.conf")}


def runtime(native):
    loader = native / "lib/x86_64-linux-gnu/ld-linux-x86-64.so.2"
    office = native / "usr/bin/lloconv"
    pdfinfo = native / "usr/bin/pdfinfo"
    libraries = [native / path for path in ("usr/lib/libreoffice/program", "lib/x86_64-linux-gnu", "usr/lib/x86_64-linux-gnu", "usr/lib", "lib")]
    for path in [loader, office, pdfinfo, *libraries]:
        if not path.exists() or not path.resolve().is_relative_to(native):
            raise RuntimeError("native_runtime_incomplete")
    return loader, office, pdfinfo, ":".join(map(str, libraries))


def drop_active_capabilities(libc, seccomp):
    import ctypes
    class Header(ctypes.Structure):
        _fields_ = [('version', ctypes.c_uint32), ('pid', ctypes.c_int)]
    class Data(ctypes.Structure):
        _fields_ = [('effective', ctypes.c_uint32), ('permitted', ctypes.c_uint32), ('inheritable', ctypes.c_uint32)]
    header, data = Header(0x20080522, 0), (Data * 2)()
    capset = seccomp.seccomp_syscall_resolve_name(b'capset')
    capget = seccomp.seccomp_syscall_resolve_name(b'capget')
    if capset < 0 or capget < 0 or libc.prctl(47, 4, 0, 0, 0) != 0:
        raise RuntimeError('capability_drop_failed')
    if libc.syscall(ctypes.c_long(capset), ctypes.byref(header), ctypes.byref(data)) != 0:
        raise RuntimeError('capability_drop_failed')
    if libc.syscall(ctypes.c_long(capget), ctypes.byref(header), ctypes.byref(data)) != 0:
        raise RuntimeError('capability_verification_failed')
    if any(item.effective or item.permitted or item.inheritable for item in data):
        raise RuntimeError('capability_verification_failed')
    # Ambient was cleared; no_new_privs prevents regaining privileges on exec.


def enforce(native, work):
    if sys.platform != "linux" or platform.machine() != "x86_64":
        raise RuntimeError("unsupported_sandbox_platform")
    libc = ctypes.CDLL(None, use_errno=True)
    libc.syscall.restype = ctypes.c_long
    libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
    libc.prctl.restype = ctypes.c_int
    # Load the pinned small policy library before filesystem confinement.
    seccomp_file = native / "lib/x86_64-linux-gnu/libseccomp.so.2"
    if not seccomp_file.exists():
        seccomp_file = native / "usr/lib/x86_64-linux-gnu/libseccomp.so.2"
    seccomp = ctypes.CDLL(str(seccomp_file), use_errno=True)
    seccomp.seccomp_init.argtypes = [ctypes.c_uint32]; seccomp.seccomp_init.restype = ctypes.c_void_p
    seccomp.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]; seccomp.seccomp_syscall_resolve_name.restype = ctypes.c_int
    seccomp.seccomp_attr_set.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_uint32]
    seccomp.seccomp_rule_add_array.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint, ctypes.c_void_p]
    seccomp.seccomp_load.argtypes = [ctypes.c_void_p]; seccomp.seccomp_release.argtypes = [ctypes.c_void_p]
    drop_active_capabilities(libc, seccomp)
    class Compare(ctypes.Structure):
        _fields_ = [("arg", ctypes.c_uint), ("op", ctypes.c_int), ("mask", ctypes.c_uint64), ("value", ctypes.c_uint64)]
    context = seccomp.seccomp_init(0x7fff0000)
    if not context or seccomp.seccomp_attr_set(context, 2, 0x80000000) != 0:
        raise RuntimeError("seccomp_setup_failed")
    blocked = """socket socketpair connect bind listen accept accept4 sendto sendmsg sendmmsg recvmsg recvmmsg shutdown getsockopt setsockopt
ptrace process_vm_readv process_vm_writev pidfd_open pidfd_getfd pidfd_send_signal kcmp process_madvise process_mrelease
open_by_handle_at name_to_handle_at mount umount2 pivot_root chroot setns unshare bpf perf_event_open userfaultfd
io_uring_setup io_uring_enter io_uring_register keyctl add_key request_key syslog reboot kexec_load kexec_file_load
init_module finit_module delete_module fsopen fsconfig fsmount fspick open_tree move_mount mount_setattr
fanotify_init fanotify_mark swapon swapoff acct quotactl iopl ioperm fork vfork setsid setpgid kill tkill
setpriority sched_setparam sched_setscheduler sched_setattr sched_setaffinity get_robust_list
chmod fchmod fchmodat fchmodat2 chown fchown fchownat lchown
setxattr lsetxattr fsetxattr removexattr lremovexattr fremovexattr utime utimes futimesat utimensat""".split()
    numbers = {}
    def rule(name, error=errno.EPERM, comparisons=()):
        number = seccomp.seccomp_syscall_resolve_name(name.encode())
        if number < 0:
            raise RuntimeError("unsupported_seccomp_syscall_" + name)
        numbers[name] = number
        array = (Compare * len(comparisons))(*comparisons) if comparisons else None
        if seccomp.seccomp_rule_add_array(context, 0x00050000 | error, number, len(comparisons), array) != 0:
            raise RuntimeError("seccomp_rule_failed")
    for name in blocked:
        rule(name)
    rule("clone3", errno.ENOSYS)  # libc can use its ordinary pthread clone path.
    rule("prlimit64", comparisons=[Compare(0, 1, 0, 0)])  # Only own pid=0 limit calls.
    rule("clone", comparisons=[Compare(0, 7, 0x10000, 0)])  # No new processes.
    for bit in (0x00020000, 0x02000000, 0x04000000, 0x08000000, 0x10000000, 0x20000000, 0x40000000):
        rule("clone", comparisons=[Compare(0, 7, bit, bit)])
    class Ruleset(ctypes.Structure):
        _fields_ = [("fs", ctypes.c_uint64), ("net", ctypes.c_uint64), ("scoped", ctypes.c_uint64)]
    class Beneath(ctypes.Structure):
        _pack_ = 1
        _fields_ = [("access", ctypes.c_uint64), ("parent", ctypes.c_int32)]
    abi = libc.syscall(ctypes.c_long(444), ctypes.c_void_p(0), ctypes.c_size_t(0), ctypes.c_uint(1))
    if abi < 6 or libc.prctl(38, 1, 0, 0, 0) != 0 or libc.prctl(39, 0, 0, 0, 0) != 1:
        raise RuntimeError("landlock_abi6_required")
    policy = Ruleset((1 << 16) - 1, 3, 3)  # All ABI6 FS, TCP, signal/abstract UNIX scopes.
    descriptor = libc.syscall(ctypes.c_long(444), ctypes.byref(policy), ctypes.c_size_t(ctypes.sizeof(policy)), ctypes.c_uint(0))
    if descriptor < 0:
        raise RuntimeError("landlock_setup_failed")
    loader, office, pdfinfo, _ = runtime(native)
    paths = [(native, READ), (work, WORK), (loader, EXECUTE | (1 << 2)),
             (office, EXECUTE | (1 << 2)), (pdfinfo, EXECUTE | (1 << 2)),
             (Path("/dev/null"), (1 << 1) | (1 << 2)), (Path("/dev/urandom"), 1 << 2),
             (Path("/dev/random"), 1 << 2), (Path("/dev/zero"), 1 << 2)]
    try:
        for path, rights in paths:
            directory = os.open(path, os.O_PATH | os.O_CLOEXEC)
            try:
                entry = Beneath(rights, directory)
                if libc.syscall(ctypes.c_long(445), ctypes.c_int(descriptor), ctypes.c_uint(1), ctypes.byref(entry), ctypes.c_uint(0)) != 0:
                    raise RuntimeError("landlock_rule_failed")
            finally:
                os.close(directory)
        if libc.syscall(ctypes.c_long(446), ctypes.c_int(descriptor), ctypes.c_uint(0)) != 0:
            raise RuntimeError("landlock_enforcement_failed")
    finally:
        os.close(descriptor)
    if seccomp.seccomp_load(context) != 0:
        raise RuntimeError("seccomp_enforcement_failed")
    seccomp.seccomp_release(context)
    return libc, numbers


def denied_open(path, flags=os.O_RDONLY):
    try:
        descriptor = os.open(path, flags); os.close(descriptor)
        return False
    except OSError as error:
        return error.errno in {errno.EACCES, errno.EPERM}


def child(mode, native, work, canary, parent_pid):
    if not sys.flags.isolated or not sys.flags.no_site:
        raise RuntimeError("isolated_worker_startup_required")
    parent_guard = ctypes.CDLL(None, use_errno=True)
    parent_guard.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
    if parent_guard.prctl(1, signal.SIGKILL, 0, 0, 0) != 0 or os.getppid() != parent_pid:
        raise RuntimeError("parent_guard_failed")
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CPU, (30, 30))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_PDF, MAX_PDF))
    resource.setrlimit(resource.RLIMIT_AS, (1536 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_DATA, (256 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))
    # NPROC is per real UID across namespaces, not per worker. Preserve the
    # provider's inherited limit; the supervisor samples this worker's threads.
    loader, office, pdfinfo, libraries = runtime(native)
    # Prepare Python values before Landlock; Path.as_uri lazily imports urllib.
    command = [str(loader), "--library-path", libraries]
    if mode == "office":
        command += [str(office), "-f", "pdf", "-o", '{"ExportNotesPages":{"type":"boolean","value":"false"},"ExportHiddenSlides":{"type":"boolean","value":"true"}}', "--", str(work / "selected.pptx"), str(work / "selected.pdf")]
    elif mode == "pdfinfo":
        command += [str(pdfinfo), str(work / "selected.pdf")]
    child_environment = environment(native, work)
    canary_mode = stat.S_IMODE(os.stat(canary).st_mode) if mode == "proof" else None
    if mode == "proof":
        # Prepare a harmless native pthread callback before filesystem confinement.
        callback_type = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p)
        thread_callback = callback_type(lambda unused: None)
        thread_libc = ctypes.CDLL(None, use_errno=True)
        thread_libc.pthread_create.argtypes = [ctypes.POINTER(ctypes.c_ulong), ctypes.c_void_p, callback_type, ctypes.c_void_p]
        thread_libc.pthread_create.restype = ctypes.c_int
        thread_libc.pthread_join.argtypes = [ctypes.c_ulong, ctypes.c_void_p]
        thread_libc.pthread_join.restype = ctypes.c_int
    libc, numbers = enforce(native, work)
    os.closerange(3, 65536)
    if mode == "proof":
        report = {"capabilities_cleared_and_verified": True, "no_new_privs_verified": libc.prctl(39, 0, 0, 0, 0) == 1,
                  "outside_file_read_denied": denied_open(canary),
                  "outside_file_write_denied": denied_open(canary, os.O_WRONLY),
                  "proc_read_denied": denied_open("/proc/self/status"),
                  "runtime_write_denied": denied_open(native / "fonts.conf", os.O_WRONLY)}
        with (work / "selected.pptx").open("rb") as source:
            report["work_read_allowed"] = len(source.read(8)) == 8
        (work / "allowed-write").write_bytes(b"policy proof")
        report["work_write_allowed"] = True
        for name, family in [("inet", socket.AF_INET), ("unix", socket.AF_UNIX)]:
            try:
                sock = socket.socket(family, socket.SOCK_STREAM); sock.close()
                report[name + "_socket_denied"] = False
            except OSError as error:
                report[name + "_socket_denied"] = error.errno == errno.EPERM
        for name in ("ptrace", "process_vm_readv", "pidfd_getfd", "prlimit64"):
            ctypes.set_errno(0)
            value = libc.syscall(ctypes.c_long(numbers[name]), ctypes.c_long(-1), ctypes.c_long(0), ctypes.c_long(0), ctypes.c_long(0), ctypes.c_long(0), ctypes.c_long(0))
            report[name + "_denied"] = value < 0 and ctypes.get_errno() == errno.EPERM
        try:
            os.chmod(canary, canary_mode)  # Same mode; harmless even if a rule regresses.
            report["outside_metadata_chmod_denied"] = False
        except OSError as error:
            report["outside_metadata_chmod_denied"] = error.errno in {errno.EACCES, errno.EPERM}
        thread_id = ctypes.c_ulong()
        thread_error = thread_libc.pthread_create(ctypes.byref(thread_id), None, thread_callback, None)
        joined = thread_libc.pthread_join(thread_id, None) if thread_error == 0 else None
        report["thread_create_join_allowed"] = thread_error == 0 and joined == 0
        print(json.dumps(report))
        return 0 if all(report.values()) else 78
    os.execve(str(loader), command, child_environment)



class ConversionError(Exception):
    def __init__(self, *, unavailable=False, code='conversion_failed'):
        self.unavailable = unavailable
        self.code = code
        # Only fixed codes and numeric supervisor observations; never child
        # diagnostics, document text, paths, environment or request metadata.
        self.metrics = {}
        self.signatures = ()
        super().__init__('unavailable' if unavailable else 'conversion_failed')


def _stderr_signatures(source):
    """Classify a bounded held descriptor; return only fixed diagnostic labels."""
    source.seek(0)
    prefix = source.read(4096).lower()
    # Phase messages are fixed strings in the pinned lloconv 6.1.1 convert.cc.
    # Labels indicate observations, not a diagnosis from arbitrary child text.
    signatures = {
        'native_init_failed': b'failed to initialise libreofficekit',
        'native_load_failed': b'libreofficekit failed to load document',
        'native_export_failed': b'libreofficekit failed to export',
        'native_exception': b'libreofficekit threw exception',
        'out_of_memory': b'bad_alloc', 'resource_unavailable': b'resource temporarily unavailable',
        'permission_denied': b'permission denied', 'operation_not_permitted': b'operation not permitted',
        'cannot_open_library': b'cannot open shared object', 'not_found': b'no such file',
        'bootstrap_exception': b'bootstrapexception', 'deployment_exception': b'deploymentexception',
        'cannot_bootstrap': b'cannot bootstrap', 'component_context': b'component context',
        'user_installation': b'user installation', 'failed_to_create': b'failed to create',
        'assertion': b'assertion', 'fatal_signal': b'fatal exception', 'terminate': b'terminate called',
        'runtime_error': b'runtime_error', 'system_error': b'system_error', 'fontconfig': b'fontconfig',
    }
    return tuple(label for label, pattern in signatures.items() if pattern in prefix)


def configured_native(project_root):
    """Only operator configuration can select a runtime; uploads supply no path."""
    configured = os.environ.get('EINSTEIN_SLIDES_NATIVE')
    native = Path(configured) if configured else project_root / 'deploy/native'
    if not configured and not native.exists():
        return None
    try:
        native = native.resolve(strict=True)
        manifest = json.loads((project_root / 'deploy/slides-runtime.json').read_text())
        if not isinstance(manifest, dict):
            raise ValueError('runtime_manifest_mismatch')
        expected = {'loader': 'lib/x86_64-linux-gnu/ld-linux-x86-64.so.2', 'office': 'usr/bin/lloconv', 'pdfinfo': 'usr/bin/pdfinfo', 'seccomp': 'usr/lib/x86_64-linux-gnu/libseccomp.so.2', 'fonts': 'fonts.conf', 'office_fundamentalrc': 'usr/lib/libreoffice/program/fundamentalrc'}
        if manifest.get('architecture') != 'linux-x86_64' or any(manifest.get(key) != value for key, value in expected.items()):
            raise ValueError('runtime_manifest_mismatch')
        runtime(native)
        critical = set(expected.values())
        pins = manifest['critical_files_sha256']
        for name in critical:
            path = native / name
            if not path.is_file() or not path.resolve().is_relative_to(native) or hashlib.sha256(path.read_bytes()).hexdigest() != pins[name]:
                raise ValueError('runtime_checksum_mismatch')
        if any(not os.access(native / expected[role], os.X_OK) for role in ('loader', 'office', 'pdfinfo')):
            raise ValueError('runtime_not_executable')
        return native
    except (OSError, ValueError, KeyError, TypeError, RuntimeError):
        raise ConversionError(unavailable=True) from None


def run(native, work, mode, deadline):
    """Run one fixed child, with no shell, user argv, inherited secrets or logs."""
    if mode not in {'proof', 'office', 'pdfinfo'}:
        raise ValueError('Unsupported worker mode')
    native, work = Path(native).resolve(), Path(work).resolve()
    info = work.stat()
    if (not native.is_dir() or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) & 0o077
            or work.is_relative_to(native) or native.is_relative_to(work)):
        raise ConversionError(unavailable=True)
    canary = work.parent / (work.name + '-outside-policy-canary')
    stdout_path = work / (mode + '.stdout')
    process = None
    canary_created = False
    started = time.monotonic()
    metrics = {'elapsed_ms': 0, 'peak_rss_bytes': 0, 'peak_data_bytes': 0, 'peak_address_bytes': 0, 'peak_threads': 0,
               'peak_work_bytes': 0, 'exit_code': None}
    def fail(code):
        raise ConversionError(unavailable=mode == 'proof', code=code)
    try:
        if mode == 'proof':
            descriptor = os.open(canary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
            canary_created = True
            with os.fdopen(descriptor, 'wb') as destination:
                destination.write(b'disposable policy canary')
        command = [sys.executable, '-I', '-S', str(Path(__file__).resolve()), '--child', mode,
                   '--native', str(native), '--work', str(work), '--parent-pid', str(os.getpid())]
        if mode == 'proof':
            command += ['--canary', str(canary)]
        descriptor = os.open(stdout_path, os.O_CREAT | os.O_EXCL | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'w+b') as stdout, os.fdopen(
                os.open(work / (mode + '.stderr'), os.O_CREAT | os.O_EXCL | os.O_RDWR | os.O_NOFOLLOW, 0o600), 'w+b') as stderr:
            # The child inherits only this already-open descriptor. The existing
            # 20 MiB per-file and 80 MiB work limits also bound stderr storage.
            # Never reopen its path after conversion or return any stderr bytes.
            process = subprocess.Popen(command, cwd=work, env=environment(native, work), stdin=subprocess.DEVNULL,
                                       stdout=stdout, stderr=stderr, close_fds=True, start_new_session=True)
            while True:
                pid, status, usage = os.wait4(process.pid, os.WNOHANG)
                if pid:
                    process.returncode = os.waitstatus_to_exitcode(status)
                    metrics['exit_code'] = process.returncode
                    if usage is not None:
                        metrics['peak_rss_bytes'] = max(metrics['peak_rss_bytes'], int(usage.ru_maxrss) * 1024)
                    if metrics['peak_rss_bytes'] > MAX_RSS:
                        fail('rss_limit')
                    break
                if time.monotonic() > deadline:
                    fail('deadline')
                try:
                    child_status = Path(f'/proc/{process.pid}/status').read_text()
                except FileNotFoundError:
                    time.sleep(.05)
                    continue
                rss = re.search(r'(?m)^VmRSS:\s*(\d+)', child_status)
                threads = re.search(r'(?m)^Threads:\s*(\d+)', child_status)
                metrics['peak_rss_bytes'] = max(metrics['peak_rss_bytes'], int(rss[1]) * 1024 if rss else 0)
                metrics['peak_threads'] = max(metrics['peak_threads'], int(threads[1]) if threads else 0)
                for label, field in [('VmData', 'peak_data_bytes'), ('VmSize', 'peak_address_bytes')]:
                    observed = re.search(r'(?m)^' + label + r':\s*(\d+)', child_status)
                    metrics[field] = max(metrics[field], int(observed[1]) * 1024 if observed else 0)
                size = 0
                for path in work.rglob('*'):
                    try:
                        info = path.lstat()
                    except FileNotFoundError:
                        continue
                    if stat.S_ISREG(info.st_mode):
                        size += info.st_size
                metrics['peak_work_bytes'] = max(metrics['peak_work_bytes'], size)
                # Threads are sampled every 50ms, not a kernel per-worker cap.
                if time.monotonic() > deadline:
                    fail('deadline')
                if size > MAX_WORK:
                    fail('work_limit')
                if metrics['peak_rss_bytes'] > MAX_RSS:
                    fail('rss_limit')
                if metrics['peak_threads'] > MAX_THREADS:
                    fail('thread_limit')
                time.sleep(.05)
            if process.returncode:
                error = ConversionError(unavailable=mode == 'proof' or process.returncode == 78,
                                        code='worker_exit')
                error.signatures = _stderr_signatures(stderr)
                raise error
            stdout.seek(0)
            result = stdout.read(4096)
        if mode == 'proof':
            checks = json.loads(result)
            if not isinstance(checks, dict) or len(checks) != 16 or any(value is not True for value in checks.values()):
                raise ConversionError(unavailable=True, code='policy_proof_failed')
        return result if mode == 'pdfinfo' else b''
    except ConversionError as error:
        error.metrics = metrics
        raise
    except (OSError, ValueError, subprocess.SubprocessError):
        error = ConversionError(unavailable=mode == 'proof', code='worker_io')
        error.metrics = metrics
        raise error from None
    finally:
        if process is not None and process.returncode is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
        metrics['elapsed_ms'] = round((time.monotonic() - started) * 1000)
        if canary_created:
            canary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--child', required=True, choices=['proof', 'office', 'pdfinfo'])
    parser.add_argument('--native', type=Path, required=True)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--canary')
    parser.add_argument('--parent-pid', type=int, required=True)
    args = parser.parse_args()
    native, work = args.native.resolve(), args.work.resolve()
    info = work.stat()
    if (info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) & 0o077
            or work.is_relative_to(native) or native.is_relative_to(work)):
        return 78
    return child(args.child, native, work, args.canary, args.parent_pid)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        raise SystemExit(78) from None
