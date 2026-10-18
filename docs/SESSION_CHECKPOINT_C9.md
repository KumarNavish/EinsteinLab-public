# C9 recovery state: reasoning helpers and continuous audio

Baseline: `f2cd512412ca98bd80bbbff5adba5f11325bd1d7`, private branch `feat/mobiliar-local-20261013` in `/Users/kumar0002/Projects/EinsteinLab`, exact device `local`. Read current Git HEAD and remote ref before inferring release state.

## Implemented and verified

- Continuous native PCM AudioWorklet, bounded queue, 80 ms prebuffer, 4 ms discontinuity fades, and 40 ms-lookahead narrowband tone guard. The existing 70 ms face compensation remains. There is no intentional beep oscillator in the app.
- Ten deterministic audio tests, including four synthetic tone frequencies, packet continuity, interruption and three actual voice samples unchanged by the tone guard. Actual browser audio graph passed 8/8 checks, including an injected 1 kHz tone being silent at the analyser. The user's exact reported beep was not captured or conclusively diagnosed.
- Native `calculate`, `plan_work`, `deliver_note` tools. Decimal arithmetic preserves literal precision and rejects code execution. Plans are intentions, tool activity records actual work, and drafts are in-memory/client-downloadable rather than filesystem publication.
- Actual native multi-step test passed 14/14: plan, official-lab reading, arithmetic, source-bearing draft, exact download and completed native response. Raw evidence: `evidence/runtime/c9/reasoning-1791987301298/`.
- Actual native voice regression passed 18/18 after a stronger instruction requiring lookup before the first named-project answer. Raw evidence: `evidence/runtime/c7/native-presence-1791987553164/`. The older C9 attempt without visible source links is retained at `evidence/runtime/c7/native-presence-1791987355758/`.
- Final unit/build checks: 147 Python tests and 36 JavaScript tests passed. Raw logs in `evidence/runtime/c9/backend-final.log` and `frontend-final.log`.
- Curated evidence was created in `evidence/2026-10-14-tools-audio/`, including two actual audio/video recordings, examples, screenshots and JSON results. `recording-integrity.json` contains checked media hashes. Full source excerpts in JSON are replaced by hashes/lengths.

## Explicitly unverified / absent

The Exa official public MCP endpoint returned real tools/list schemas at `https://mcp.exa.ai/mcp`; `exa-tool-contracts.json` records them. A keyless adapter, source parser, privacy opt-in and test fixtures were implemented. No live Exa content request completed in this turn. Default public-web permission is false. No paid agent, new API key, billing or subscription was used.

PDF/DOCX parsing and a persistent upload/text workspace are absent. Two dependency packages were installed in the isolated environment while exploring parsing, but their blocked implementation was not promoted; they are not required by the new running code.

The app has no arbitrary filesystem reader, email sender, publisher, purchaser, permission changer or shell tool. External actions cannot be inferred from a plan or draft. General factual accuracy, physical headset performance and human-room acoustics remain unverified.

## Denied intents: not replayed under new names/routes

- `einstein-c9-public-search-and-read-contract-test`: combined real Exa content search/fetch was blocked before dispatch. No same-intent content call was retried through the native app or another provider route.
- `einstein-c9-document-extraction-worker`: bounded binary-document extraction implementation was blocked before writing; no `document_text.py` was created.
- `einstein-c9-explicit-text-workspace`: persistent private upload/text workspace was blocked before writing; no `workspace.py` was created. The later pure reasoning helper performs no filesystem writes or private-source storage.
- `einstein-c9-release-guide-and-checksum-finalization`: combined extra landing/evidence README/checksum finalization was blocked. Do not infer those writes happened. The independently created `docs/TOOLS_AUDIO.md` and earlier media-integrity evidence remain available.

## Owned running process at checkpoint

Session `einstein-c9-quiet-reasoning-release`, launcher PID 34925 at launch, command `.einstein-venv/bin/python scripts/launch.py --no-browser`, localhost 8765. Launch receipt `4d8846c43bd9aa0470c256ff2f83a8a5313e8901ad1dcbc5542fa049fefcde3d`. It followed deliberate shutdowns of earlier C9 owned sessions after observing no active participant. Reconcile the process and HTTP state before stopping/restarting; a later final-source reload may supersede this session.

The latest decimal-literal and signed-URL refinements were written after the native voice replay and tested locally. A running process must be restarted deliberately to load those backend-only refinements; no replayed audio claim should silently cover unexecuted code.

The user credential/proof/consent remain under ignored `.work/private`. Never display, reconfigure or commit their values. The inherited free-tier proof expires 2026-10-15T10:38:49.734442Z; do not extend it without legitimate verification.

The standard Browser plugin is absent. Commander browser observation returned `NO_WINDOWS`, not a valid page target. Actual QA used isolated headless Chrome profiles through existing Playwright; each test closed its profile. No user browser session or real microphone was captured.

## Final source reload

The earlier `einstein-c9-quiet-reasoning-release` was deliberately terminated after confirming no native participant was active. The final source is launched by session `einstein-c9-handoff-running`, launcher PID 42620, operation `b5f0c9d81e523e37488d4170fe458195331afe08ff147c84dc07250ed4d45e48`, same command/checkout/localhost port. Use that session and actual HTTP health for later reconciliation. A launch receipt alone is not readiness evidence.
