> **Historical first-pass record (13 October 2026).** Superseded for current operation by [the live operator guide](LIVE_DEMO.md), [the continuation validation](VALIDATION_C2.md), and [current owned state](SESSION_CHECKPOINT_C2.md). The original failures and measurements are preserved below.

# Continuation checkpoint

## Owned state

- Device explicitly selected: `local`, Apple M1 / 16 GB, host `dmi-21-pc-12.client.unibas.ch`.
- Checkout: `/Users/kumar0002/Projects/EinsteinLab`.
- Original repository: private `raynaney/mixed_reality_einstien`; branch `feat/mobiliar-local-20261013`.
- Baseline: `32ce8206affa5a239ccf6d887d802ca98f104fb7`.
- Local Git LFS executable: `.work/bin/git-lfs`; prepend `.work/bin` to PATH when using Git in this checkout.
- Python `.einstein-venv`; model cache `.local-models`; private derivative `rehearsal/public/assets/einstein.glb`; snapshot `lab_backend/data/lab.json`.
- Original scene and original LFS objects were not replaced; no other project was modified.

## Service and blocked operations

Owned service session `einstein-20261013-rehearsal-server`, PID 55253, was stopped with Commander call `einstein-20261013-restart-after-audio-fix`; termination was confirmed. The subsequent start intent `einstein-20261013-rehearsal-server-v2` was blocked before execution. **Service stopped; no launch completion claimed.** Do not repeat an uncertain or denied mutation under another identity.

Earlier combined template/retrieval repair intent `einstein-20261013-template-and-retrieval-repair` was also blocked before execution. It would have repaired the missing model template, query expansion/selection, and read a raw browser receipt. **Those changes were not applied.** Do not silently infer otherwise from later successful independent audio/UI work.

## Browser task space

Ego session `einstein-lab-rehearsal` was allocated for this task.

- Open intent `einstein-20261013-browser-open`, phase `open-rehearsal`, operation `e85e816eee1b7d895d26818ca0961b645488ec148d7025d748afc2cd3a69f2c7`: receipt returned `RECEIPT_FINALIZATION_PENDING`, uncertain. Not replayed.
- Read-only observation `einstein-20261013-browser-observe`, phase `observe-open-receipt`, operation `ffe8fccce1666c4a752663825215d44d3ab66a9b9b083d4e9679a1e148e6b083`: queued at last observation.
- Independent QA used a separate, isolated headless Chrome profile and did not mutate or replay the owned Ego page.

## Completed checks and retained failures

- Original assets: restore/hash verification complete.
- Public crawler: 80 pages / 164 chunks, manifest preserved.
- Python: 24 tests passed after audio decoder repair.
- Browser: typed question/source/audio/interrupt and desktop/mobile checks observed; two resource 404s and shadow warning retained.
- Final pose/layout/favicon/shadow edits: build/unit tests passed, rendered retest not performed.
- First HTTP speech test: failed; decoder fixed independently afterward.
- Post-fix offline speech test: exact transcription and synthesized reply, but wrong retrieval -> regression failed as it should.
- Qwen generation: missing template; not working.
- Native Unity compile, actual microphone acoustics, Quest build/performance: not performed.

## Useful sessions / artifacts

`einstein-20261013-visual-polish`: completed exit 0; final browser build.
`einstein-20261013-audio-decoder-repair`: completed; 24 passing Python tests.
`einstein-20261013-end-to-end-evaluation`: exit 1; first live evaluation and initial HTTP audio failure.
`einstein-20261013-ui-recorder-setup`: exit 1 from recorded console failures; actual interaction media saved.
`einstein-20261013-offline-audio-regression`: exit 1 from wrong-source expectation; exact transcription verified.

Reviewable evidence lives in `evidence/2026-10-13/`, with checksums and an explicit distinction between measurements, visual recordings, synthetic audio fixtures, failed cases, and untested claims. Private runtime caches and raw downloaded web content remain ignored.
