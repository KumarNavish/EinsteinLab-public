# Manual external browser checks

`public-acceptance.yml` runs one owner-approved scenario on the existing included
Ubuntu runner. It is manual only, serializes with deployments and uses no provider
keys, deployment secrets, paid runner, Actions artifacts or shared cache. Keep
the account's Actions budget at $0 and review included minutes before dispatch.

The owner must review earlier receipts, verify the exact live deployment and
funding, confirm an empty room and avoid deployment/reset during the run. The
workflow checks that its source descends from the deployed commit and that tracked
runtime inputs are unchanged; a QA-only commit can therefore test the current
image. Actual browser responses separately establish frontend and original-character
hashes. Private backend identity remains an owner deployment receipt.

- `remaining`: one provider session, up to five specialist starts and one PPTX
  conversion; the existing 15-minute protocol. Only committed PPTX and synthetic
  WAV fixtures are needed. It covers slides, whiteboard, lab evidence, synthetic
  microphone overlap, responsive/security checks and cleanup. It cannot pass the
  full protocol or establish a human microphone verdict.
- `research-recovery`: at most two provider sessions, two optional OpenAI public-research operations, three active
  minutes per session and six minutes total. Real Settings/processing consent
  precedes search and reading of an actually returned official ETH URL. Source
  receipts and fresh spoken narration are required. Refresh during actual voice
  must close the first session with final usage; after 33 seconds without automatic
  reconnection, a manual typed reconnect, actual voice and Stop must pass. This
  tests page refresh, not physical network loss or quota exhaustion. It captures
  no microphone or feedback and does not export an audio recording.

After merging and reviewing the harness, dispatch exactly one scenario:

```sh
gh workflow run public-acceptance.yml --repo KumarNavish/EinsteinLab --ref main \
  -f scenario=remaining \
  -f source_commit=EXACT_40_CHARACTER_DEPLOYED_COMMIT \
  -f deployment_id=OWNER_VERIFIED_DEPLOYMENT_UUID \
  -f prerequisites_verified=true
```

Use `scenario=research-recovery` for that separate allocation. There are no
provider retries or fallbacks. A failed gate stays failed/incomplete. Existing
Chrome must be present; the job does not install a replacement browser.

## Retrieve the evidence

Private job logs contain gzip/base64 file records with original byte counts and
SHA-256 hashes. Encoding is transport, not access control. The exporter refuses
JSON containing raw transport credentials or permit URLs before logging it.

`report.json` and `runner-export.json` are included. For `remaining`, the selected
allowlist is the revised whiteboard, returned slide 1, 390px mobile view, synthetic
microphone response and actual browser-output WebM. A 5 MiB compressed total cap
can omit media; the export manifest records every omission. Raw PCM and the full
gallery are never exported. Download the logs before their retention expires:

```sh
umask 077
gh run view RUN_ID --repo KumarNavish/EinsteinLab --log > .work/external-RUN_ID.log
```

The following decoder verifies ordered chunks, byte counts and hashes before
creating each file. Run it with a fresh output directory:

```sh
python3 - .work/external-RUN_ID.log .work/external-RUN_ID <<'PY'
import base64, gzip, hashlib, json, pathlib, re, sys
source, output = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
output.mkdir(mode=0o700)
allowed = {'report.json', 'runner-export.json', 'R-revised-focused-whiteboard.png',
           'R-converted-slide-1-return.png', 'R-active-mobile-390.png',
           'R-synthetic-microphone-response.png', 'R-actual-browser-output.webm'}
current = None
for line in source.read_text().splitlines():
    # Ignore the workflow's echoed JavaScript source; decode actual log records.
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

Read the report state, coverage, actual spoken answers, final usage and room
cleanup. Inspect only media listed as exported. Keep separate scenario receipts
and retained failures intact; neither workflow scenario is a monolithic full-pass
receipt. No public execution is established by the offline checks of this runner.
