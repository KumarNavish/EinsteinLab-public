# Zero-provider renderer comparison

Manually dispatch `renderer-benchmark.yml` with the reviewed candidate SHA on
`main`, after verifying the included Actions allowance and $0 spending budget.
It compares baseline `ab1327dc` and the candidate on the same Ubuntu runner,
using isolated local public-service instances, the original hash-pinned character,
identical locked dependencies, and the existing authored two-page PDF. It never
connects a provider, submits feedback or deploys an app.

The manual `renderer` choice defaults to `standard`, preserving the existing
headless Chrome configuration (SwiftShader on the measured Ubuntu image).
`mesa-llvmpipe` is a separate compatibility variant: it requires the installed
Mesa GLX/DRI and Xvfb paths, then runs headed Chrome under Xvfb with ANGLE OpenGL.
EGL package inventory is optional diagnostics. No packages are installed.
Missing required paths or a WebGL identity other than llvmpipe fail the
variant; there is no fallback or retry. `report.json` and `runner-export.json`
record the selected mode, and each version records its actual WebGL identity.
If preflight fails before the benchmark, the job stays failed and its logs state
that no renderer report was generated; no result is inferred from package names.

Both modes use the same fixed gates below, original character and one included
private Ubuntu job, capped at eight minutes. Mesa is CPU rendering; no performance
improvement or GPU acceleration is assumed. Keep its result separate from the
retained SwiftShader failures. No production renderer changes are made.

The real keyboard controls and file selection/page 1→2→1 controls must complete.
Candidate CDP p95 must be at most 1 second; keyboard and each navigation must take
at most 8 seconds. Intervals between completed `renderer.render` calls must have
median ≤100 ms and p95 ≤250 ms. If the baseline median exceeds 100 ms, the
candidate median must improve by at least 25%; healthy baselines need no cadence
improvement. These are render-command completion intervals, not a physical
display or headset measurement. Raw rAF intervals and submission durations are
also retained. The harness observes quality decisions without forcing them.

Receipts use the same timestamped, ordered gzip-base64 records as public
acceptance. `runner-export.json` lists selected and omitted files under the 2 MiB
compressed cap; no Actions artifact or external storage is used. Retrieve and
verify them with a fresh output directory:

```sh
umask 077
gh run view RUN_ID --repo KumarNavish/EinsteinLab --log > .work/renderer-RUN_ID.log
python3 - .work/renderer-RUN_ID.log .work/renderer-RUN_ID <<'PY'
import base64, gzip, hashlib, json, pathlib, re, sys
source, output = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
output.mkdir(mode=0o700)
allowed = {'report.json', 'runner-export.json', 'baseline.png', 'candidate.png'}
current = None
for line in source.read_text().splitlines():
    record = re.search(r'(?:^|\t)\d{4}-\d\d-\d\dT\S+Z EINSTEIN_FILE_(BEGIN|CHUNK|END) (.*)$', line)
    if not record:
        continue
    kind, value = record.groups()
    if kind == 'BEGIN':
        assert current is None
        current = {**json.loads(value), 'parts': []}
        assert current['name'] in allowed and current['encoding'] == 'gzip-base64'
    elif kind == 'CHUNK':
        index, encoded = value.split(' ', 1)
        assert current is not None and int(index) == len(current['parts'])
        current['parts'].append(encoded)
    elif kind == 'END':
        data = gzip.decompress(base64.b64decode(''.join(current['parts']), validate=True))
        assert len(data) == current['bytes']
        assert hashlib.sha256(data).hexdigest() == current['sha256'] == value
        with (output / current['name']).open('xb') as target:
            target.write(data)
        current = None
assert current is None and (output / 'report.json').is_file()
assert (output / 'runner-export.json').is_file()
PY
```

A passing benchmark establishes only the recorded local rendering/UI checks.
Public conversation, speech quality, source reasoning and physical-device
acceptance require their separate actual public receipts.
