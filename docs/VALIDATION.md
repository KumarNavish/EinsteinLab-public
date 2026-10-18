> **Historical first-pass record (13 October 2026).** Superseded for current operation by [the live operator guide](LIVE_DEMO.md), [the continuation validation](VALIDATION_C2.md), and [current owned state](SESSION_CHECKPOINT_C2.md). The original failures and measurements are preserved below.

# Validation record — 13 October 2026

## Decision

**Do not present this branch as the finished Steering Committee experience.** It contains a concrete, tested desktop interaction and useful reusable components, but generative answers, retrieval robustness, final visual changes, native compilation, and physical Quest acceptance are not cleared.

Source baseline: `32ce8206affa5a239ccf6d887d802ca98f104fb7` (`master` of the existing private upstream). The original scene, avatar, materials, and iClone clips were preserved. No broader rights to those assets are asserted.

## Evidence and acceptance

| Check | Actual result | Evidence / interpretation |
|---|---|---|
| Private repository and source assets | Verified | Authenticated Mac GitHub account accessed upstream; the ChatGPT GitHub installation returned 404. Original FBX size and SHA-256 matched LFS pointer. |
| Backend unit tests | 24 passed, 1.58 s | Includes source/citation checks, unknown questions, bounded audio decoding, cross-origin checks, request validation, and late-cancellation ordering. These are not scientific/semantic validation. |
| Browser unit tests / build | Passed | Three turn-ownership/base64 tests; production build succeeded. Bundle-size warning remains. |
| Public knowledge ingestion | 80 pages, 164 chunks | Robots-aware bounded crawl, source URL/date/hash manifest; one queued URL and two skipped resources. Full papers/private material excluded. |
| Actual character rendering | Verified on desktop before final polish | Original rigged character and embedded textures loaded in Chrome using Apple M1 Metal. The recorded pose is visibly stiff. |
| Typed question -> sourced answer -> audio | Verified for the cognitive-load example | Exact question: “How do LLMs affect cognitive load?” A correct project excerpt was shown and local voice playback started. |
| Playback interruption | Verified in that desktop test | Button-to-ready observation: 50 ms. Not an acoustic or end-to-end microphone latency measurement. |
| Desktop frame rate | 60 fps in recorded sample | 365,710 rendered triangles / 61 draw calls including rendering passes. Not Quest frame rate or a sustained thermal test. |
| Desktop/mobile layout | Partial | No horizontal overflow at 390×844. The first recording exposed answer clipping when sources expanded. A subsequent code fix built successfully but was not re-rendered. |
| Browser console | Failed in recorded run | Two resource 404 errors and a deprecated shadow-map warning. Favicon/shadow fixes were subsequently built; their rendered postconditions are still unverified. |
| Natural-language retrieval | Failed adversarial/variant examples | The six-case run passed five designed expectations, but the agentic question selected unrelated human-rights news. The spelled-out “large language models” variant also selected unrelated SME news. Do not generalize the 5/6 figure to factual accuracy. |
| Local Qwen synthesis | Failed | Missing separate `chat_template.jinja`; tokenizer raises ValueError. Model-file availability is not a working generation result. The repair command was blocked and unapplied. |
| Original HTTP audio input | Failed | Faster-Whisper called PyAV with the removed `metadata_errors` keyword. The service returned 503. |
| Repaired offline speech decoding | Transcription and synthesis verified; answer grounding failed | Exact synthetic input text recovered in 2,961.3 ms; local reply synthesis 3,111.2 ms. Retrieval chose the wrong source, so the complete regression correctly failed. This was not HTTP, a human microphone, or a headset test. |
| Native Unity / APK / Quest | Not tested | Correct Unity version unavailable; no Quest attached. No native build or hardware performance claim. |
| Paid usage | No paid model API invoked or paid service activated | Local inference/downloads only. Electricity, existing subscription costs, and LFS/network quotas were not metered. |

## Latency observations, not a polished production benchmark

The first cold typed turn spent 45.52 s in the failed local generation attempt and 14.68 s loading/synthesizing voice: **60.20 s server total**. This unacceptable cold-start result is retained.

Later extractive typed turns took approximately **0.72–0.93 s server time** before HTTP transfer/playback, including roughly 0.71–0.93 s TTS. During the recorded, GPU-active browser test, the cognitive-load turn took **2.72 s server time** and **2.74 s to receive the response**. These are small observations under different runtime states, not matched provider comparisons or guaranteed response latency.

The repaired offline synthetic-audio test recovered the exact transcript, but selected an irrelevant page. Audio correctness and answer correctness are separate acceptance gates.

## Recording and screenshots

All media in [the evidence directory](../evidence/2026-10-13/) comes from the actual implemented application, not mockups. The screen recording is **video-only**; audio playback was verified through the running Web Audio graph and is supplied separately as `answer-1.wav`. The recording and screenshots predate the final pose/layout/shadow/favicon edits; do not use them as proof of those edits.

- [Actual desktop interaction, WebM](../evidence/2026-10-13/recorded-desktop-interaction.webm)
- [Desktop screenshot](../evidence/2026-10-13/desktop-conversation.png)
- [Mobile screenshot](../evidence/2026-10-13/mobile-conversation.png)
- [Locally generated answer audio](../evidence/2026-10-13/answer-1.wav)
- [Machine-readable browser test](../evidence/2026-10-13/browser-smoke.json)
- [First live evaluation, negatives retained](../evidence/2026-10-13/live-evaluation.json)
- [Failed first HTTP speech test](../evidence/2026-10-13/speech-roundtrip.json)
- [Post-repair offline speech test](../evidence/2026-10-13/offline-speech-regression.json)

## Next acceptance gates

The denied template/retrieval repairs require a newly admitted continuation, not a replay under a new command identity. After that, freeze a varied set of committee questions and require the correct source plus an entailed answer, including paraphrases, false premises, project-status ambiguity, researcher identity, and follow-ups. Keep the current counterexamples as regressions. Exact quote matching alone does not establish that every generated assertion follows from evidence.

Then re-run the same browser checks after the visual edits, repeat a real microphone session with interruption/echo conditions, compile the pinned Unity project, and validate on the actual headset. Measure audio-to-first-response, lips-to-audio offset, repeated-session failure rate, stereo frame time, and thermals. These are remaining work, not results claimed by this branch.
