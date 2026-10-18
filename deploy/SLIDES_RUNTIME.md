# Linux presentation conversion

Build the pinned optional runtime with Python 3.12 or newer:

```sh
python tools/build_slides_runtime.py
python tools/build_slides_runtime.py --verify-only
```

The stdlib-only builder downloads the exact official Debian payload URLs in `slides-runtime.json`, verifies every size and SHA256, extracts without installing packages or running maintainer scripts, removes privileged mode bits, applies the recorded LibreOffice relocation, and checks the complete regular-file/link digest. It refuses an existing output. The native tree is ignored by Git; the checked-in manifest and builder reproduce it. No compiler, apt, dpkg, gpgv, account or runtime download is required for this pinned rebuild.

The pins were derived from official bookworm main and security indexes whose Release signatures were cryptographically checked against pinned Debian primary fingerprints. The manifest records the index/key/Release hashes, verification tool, time and limitations. PGPy's missing revocation/self-signature policy checks are disclosed; broader key-trust or online revocation validation is not claimed. Pin updates require a fresh explicit signature/dependency review and execution evidence.

`lab_backend/presentation_linux.py` discovers `deploy/native/`; an operator may relocate those same pinned bytes with `EINSTEIN_SLIDES_NATIVE`. Uploads cannot select paths, commands, formats or URLs. The worker uses the private ELF loader/library paths, LibreOfficeKit through the official `lloconv` binary, and private profile/temp/output files. It disables Python site startup, closes inherited descriptors, clears active/ambient capabilities, verifies no_new_privs, applies Landlock ABI6 and seccomp, and fails closed if a required primitive is missing. Files outside the native tree/private work area cannot be read; network sockets, process escape, and metadata mutations are denied. No converter stderr or document metadata reaches application logs. A content-free success message is emitted only after the temporary work directory is gone.

The existing 8 MiB upload, 120-slide, 40-second, 20 MiB PDF and one-conversion limits remain. The worker also enforces CPU/file/address-space/data/FD limits and samples RSS, work size and actual child thread count. The 32-thread guard is supervisor sampling, not a kernel task cap. Host NPROC is inherited because its real-UID scope made 32 unusable on the measured shared provider UID. MAX_CONCURRENCY is fixed at 2, and fork/namespace creation stays denied.

The checked final Linux fixture contains a colored mechanism diagram, a normal embedded chart XLSX and an HTTPS citation. It produced a 1-page PDF under all 16 confinement checks in about 2.45 seconds total, with office RSS about 220 MiB. Evidence and PDF paths are recorded in the manifest. This is one compatibility fixture, not a throughput or full-deck compatibility benchmark. LibreOffice 7.4 rendering can change fonts, wrapping, alignment and chart ticks. Rich animations and OLE are unsupported; chart workbooks must contain inspected values without formulas, macros or links. Export from the authoring application to PDF when exact layout is needed.

The native closure contains third-party Debian binaries and their accompanying copyright/license notices under `native/usr/share/doc/`. Package names, versions, official download URLs and SHA256 values are pinned in the manifest. The builder's controlled config/link changes are the only packaging modifications; no third-party executable is patched.
