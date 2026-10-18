# Continuation checkpoint — 14 October 2026

## Exact working state

- Explicit device: `local`, Apple M1 / 16 GB.
- Checkout: `/Users/kumar0002/Projects/EinsteinLab`.
- Private upstream: `raynaney/mixed_reality_einstien`.
- Branch: `feat/mobiliar-local-20261013`.
- This continuation began at `ab59e159b6e7dbf84bdeaa65ad098ad5b3bd815a`; read current Git HEAD and the remote ref for the released revision.
- Prepend `$PWD/.work/bin` to PATH for the locally installed Git LFS. No global Git configuration was changed.
- Original scene, FBX, textures, and iClone source are preserved. The generated private GLB and model/runtime caches remain ignored.

## Current owned server

**Session `einstein-c2-handoff-runtime` was observed running and ready.**

- Launcher PID: `39930`; child Uvicorn PID: `39933` at observation.
- Command: `.einstein-venv/bin/python scripts/launch.py --no-browser`.
- Working directory: the checkout above.
- Address: `http://127.0.0.1:8765/`, connected Mac only.
- Launch operation: `0a527df8bd4414235bdac595d0e88d1477d7790312847d6cb5c61ea150c5ea88`.
- Readiness observation: `6fd4f61d59322980af7efa0aa85bc0e3cb7b287fcff6ebfd24efb74b3d33cd39`.
- Prewarm: 15.038 s for models/voice plus 7.459 s for the authored introduction in that start.

Reconcile the session and actual HTTP health before restarting or claiming continued availability. The launcher forwards termination to its owned child. Do not terminate a listener merely because it uses the same port. Earlier sessions `einstein-c2-final-local-launch` and `einstein-c2-release-runtime` were deliberately terminated before isolated comparisons.

No autonomous reasoning task is running in the background. The only intended persistent application process is the local server.

## Selected runtime

Qwen3-4B-Instruct-2507 MLX, exact model/chat-template pins in `lab_backend/models.lock.json`. Kokoro George int8 supplies speech and phoneme durations; Piper Alan is an explicit faster/simpler voice. Whisper base.en handles local transcription. No model provider API key or paid endpoint is used.

Qwen3-1.7B and a distinct Qwen2.5-1.5B-Instruct candidate were tested locally but not promoted. The latter was faster but failed the current generated-output/source gate in all five designed checks; Qwen3-4B passed four of those five. These are integration outcomes, not general model intelligence scores.

The original retrieval code is unchanged. Compact passage-tag selection, numeric checks, hypothesis guards, and a negative-evidence scope guard are generator-boundary changes, not a claimed retrieval rewrite.

## Verified outputs

`evidence/2026-10-14/` contains curated proof and retained negatives. Raw full runtime outputs remain in `evidence/runtime/c2/`.

- 48 backend tests; 8 browser unit tests; 11 standalone C# codec checks.
- Actual original animation and source-backed voice playback.
- Repeated controlled spoken question/interruption tests using a synthetic browser microphone, not a real room.
- Latest voice regression: 11 checks passed; first answer-audio segment 38.02 s, total server time 38.18 s. This is still too slow.
- Real voice/video captured together, plus a silent full-interface recording. No voice-over substitution or waiting-time removal.
- Last visible fixes: clear previous-turn timing immediately, and label multiple passages from one page honestly rather than calling them independent sources.
- Native scene compilation/Quest execution remain unverified. The correct Unity editor reported licensing-client validation and entitlement errors.

## Rejected operations: unapplied, not rerouted

The following tool rejections are material. Do not infer completion or replay the same denied intent under a different identity/route:

- `einstein-c2-measure-retrieval-baseline`: the frozen 36-question retrieval measurement was not executed. `benchmarks/committee_questions.json` exists but is not a completed benchmark.
- `einstein-c2-project-aware-retrieval`: the proposed alias/ranking/chunk/source-selection rewrite of `knowledge.py` was not applied.
- `einstein-c2-render-budget-and-ar-surface`: adaptive desktop frame limiting, transparent WebXR overlay, exit control, and associated visibility cleanup were not applied.
- `einstein-c2-small-model-format-diagnostic`: the proposed Qwen3-1.7B raw-output format diagnosis was not run.
- `einstein-c2-neutral-mouth-and-runtime-identification`: the proposed bind-pose jaw/health-identity edits were not applied. Existing speech-driven mouth controls passed numerical reset checks; that does not validate this unapplied geometry repair.
- `einstein-c2-verify-scoped-outcome-answer`: the proposed extra live post-guard outcome regression was not run. The new guard has unit evidence, not that live result.

## Remote and browser recovery

The GitHub connector returned 404 for this private repository. The existing authenticated Mac `gh` account could read and push the authorized feature branch. Preserve repository privacy; do not create a public mirror or change upstream master.

Research gateway reads/configuration were unavailable:

- Policy read operation `f96b9d712b82e9dcdc1c0e9e860c4e362e09ae485bbc56219ae30dca71ca5b42`: timeout / uncertain observation.
- Configuration operation `ac69dfe3921f0b848b74bf3f995d81679e6a911fe7898699121ed45e1352508a`: timeout / uncertain observation.

No remote job, GPU allocation, tunnel, raw SSH, or substitute machine was used.

The owned Ego task space remains `einstein-lab-rehearsal`. Original open receipt `e85e816eee1b7d895d26818ca0961b645488ec148d7025d748afc2cd3a69f2c7` and read-only observation `ffe8fccce1666c4a752663825215d44d3ab66a9b9b083d4e9679a1e148e6b083` were uncertain. The current read-only observation operation `c4eab82926593c5f1f0cc8431048a13e951bb9537c8749b47a48e8f7f0017c6a` was queued at last observation. No ambiguous browser mutation was replayed. Automated validation used isolated Playwright Chrome profiles, closed after testing.

## Next scientific/engineering decisions

The next useful work is not another cosmetic pass. Admit a focused correction of retrieval/output robustness and response-time bottlenecks; retain the current failures as regressions. Measure spontaneous-answer latency separately from prepared/cached audio. Validate negative-result wording and real multi-turn follow-ups, not just one generated answer.

A valid Unity entitlement and actual Quest are needed before native/headset claims. Browser AR composition, room echo, participants, positional audio, physical lip timing, and sustained headset performance are still open acceptance gates.
