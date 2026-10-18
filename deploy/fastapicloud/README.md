Einstein’s keyless FastAPI Cloud staging layout. This folder is a template, not a deploy root. Build a fresh isolated directory from the allowlist:

    python scripts/build_fastapi_bundle.py --output .work/fastapi-full-stage

The builder requires the production native artifact at deploy/native/, its deploy/slides-runtime.json and lab_backend/presentation_linux.py. It never substitutes a probe artifact or downloads runtime dependencies. The slides-runtime builder owns that closure and its Linux execution evidence. Staging verifies paths and byte identity; it does not establish that native conversion, a host, a provider or public acceptance works.

The stage contains the public entrypoint’s backend import closure, project briefs, the current official-lab JSON snapshot, built frontend including the real GLB, third-party notices, the native closure and exact dependency/startup metadata. It excludes the original Git/history, tests, cache, usage databases, credentials, Apple/speech/model modules and deployment-account CLI. Backend modules imported lazily are included; an unexpected path into a local Apple/model runtime stops the build.

Every staged file or contained native symlink has a corresponding source entry in BUNDLE_MANIFEST.json. File hashes and execution modes are compared again against the staged copy and current source. Extra files or empty folders, a source race, non-native symlinks, native symlink escapes, credential-shaped content and PEM private-key material fail staging. A nonempty output is never overwritten. The narrow .fastapicloudignore is a second upload boundary; always deploy only a validated staging directory, never this repository.

Two exceptions cover exact reviewed public Debian payloads in the verified native tree. The Avahi catalog at `deploy/native/usr/lib/x86_64-linux-gnu/avahi/service-types.db` must be a regular 16,384-byte file with SHA256 `e7127eef5e5dbef519a8ad51bed5e84b21675b42240eb2a072220731843f3b15`; every other database remains blocked. The regular 2,209,528-byte `deploy/native/usr/lib/x86_64-linux-gnu/libgnutls.so.30.34.3` must have SHA256 `779b25d20249988bea2c1aa6bbeb218f5ae7ea8a9d30ce4f54ea37372965cc4b`. Its five compiled public PEM-shaped constants are allowed only at that exact file/hash; Google and AQ credential-shape scans still apply. Changed bytes, substituted paths and symlink replacements fail. Both pins are checked again against source and destination during stage validation. The cryptographic library comes from official `libgnutls30` version `3.7.9-2+deb12u7`, payload SHA256 `30abec8c824feb1d2d7e9000a34083cccd19d139625e1b21547e3ac53b922f8e`, at [the pinned Debian package](https://deb.debian.org/debian/pool/main/g/gnutls28/libgnutls30_3.7.9-2+deb12u7_amd64.deb). Its provenance belongs to the signature-verified canonical runtime; no local credential is exempted.

All 36 pins and their artifact hashes in lab_backend/requirements-public.lock remain exact. Only public PyPI artifact URLs are accepted. The host’s observed FastAPI CLI startup additionally needs plain fastapi-cli==0.0.32, whose base closure is frozen in uv.lock. The unnecessary fastapi-cloud-cli/account tooling extra is excluded. The project targets Python 3.13, with .python-version set to the host-observed 3.13.16. The lock was resolved using an installed local Python 3.13.14 without downloading or installing a Python runtime. The host starts main:app through FastAPI CLI/Uvicorn on port 8080.

To update the lock deliberately, keep the canonical public pins and use the public package registry with keyring disabled:

    uv lock --project deploy/fastapicloud --python /path/to/installed/python3.13 \
      --no-python-downloads --default-index https://pypi.org/simple --keyring-provider disabled --no-build

Operator runtime environment is supplied by the host. EINSTEIN_PUBLIC_ORIGIN is required and must name the exact HTTPS app origin. Provider credentials, non-billable-project attestation, durable feedback settings and any asset-distribution approval belong in the host environment; none is written into the bundle. Missing credentials keep the native route unavailable. This entrypoint does not supply a key, crawl at startup, enable private-staging flags or change billing/consent. It calls the existing create_app only; the presentation adapter discovers its own native closure.

Offline security/regression checks use isolated synthetic native and GLB bytes, never execute those fixtures and never deploy or contact a provider:

    python -m pytest deploy/fastapicloud/test_bundle.py -q

After the real canonical native artifact is ready, run the builder against current inputs, inspect its actual manifest, then use the root task’s separate approved host/runtime/public acceptance workflow. No deployment is performed by this script.
