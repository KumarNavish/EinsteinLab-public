# Bounded speech playback repair — 15 October 2026

## User-visible failure

The reported toast, `Audio playback queue exceeds its time budget`, is emitted by the decoded local-speech scheduler. That scheduler previously accepted every decoded clip immediately and threw once the next start time was more than twenty seconds ahead of the audio clock. A cached introduction can arrive in milliseconds while containing more than thirty seconds of speech. Fast delivery should cause backpressure, not make a valid spoken answer fail.

The failed turn handler previously called `finish()`, leaving already scheduled partial speech alive after displaying a failure. Source allocation also occurred before the scheduling-limit check.

## Repair

`ScheduledSpeechQueue` serializes decoded clips, schedules exact four-second sample ranges from the original waveform, and waits for room within a twenty-second future-playback window. It does not increase the old limit, discard speech, change speaking rate, or synthesize replacement audio. Mouth cues retain the original whole-clip time through `cueOffset`; the original sentence caption is captured when its clip enters the queue.

Interruption aborts pending waits and invalidates late decoding results. Count, encoded-memory, decoded-memory and clip-duration limits remain finite. A stalled or suspended output clock fails with an actionable message rather than accumulating speech indefinitely. A failed local turn now cancels its network reader, clears pending playback, and requests cancellation of the owned backend turn. Idle notification occurs synchronously on stop, so a later animation frame cannot overwrite the visible error state. Queue diagnostics fall to zero as scheduled speech drains.

The separate native PCM/AudioWorklet implementation and its tone filter are not replaced. Anam is not introduced. No provider key, billing setting or hosting configuration is changed by this code patch. A later native regression renewed the existing local free-tier proof from an actual authenticated observation; it did not change the key or consent.

## Evidence actually obtained

- Eighteen new scheduler invariant tests passed, including a ninety-six-second synthetic producer burst, exact sample coverage, long replay slicing, interruption, delayed decoding, clock stalls, memory bounds and failed-epoch recovery.
- Eight actual `SpeechPlayer` integration-unit tests passed for sample offsets, cue timing, captions, cancellation, native preview delay and synchronous stop notification.
- The isolated patch against the repository's accepted `main` baseline passed **75 JavaScript tests** and its production build. The active development checkout passed **92 tests**; it contains unrelated earlier experiments, which are not included in this patch.
- A real **headed Chrome** run completed the application's authored introduction with **32.70 seconds of observed non-silent span**, **seven incoming speech segments**, **twelve scheduled slices**, **five backpressure waits**, and **19,973 ms peak scheduled audio**. The measured audio graph was non-silent, and the queue exception did not occur. This was a real local-service response, not a mocked API or a Google generation request.
- That headed run passed its first seven checks, then the test script attempted to click an introduction button that the engaged layout correctly hides. Its overall run therefore failed. A corrected recovery-flow test was run later and also exited unsuccessfully; detailed diagnostic execution was blocked. Do not label either complete browser suite as passing.
- The first headless run encountered a non-advancing audio clock. The new guard stopped the output and reported it. This is not proof that a real user's output device will fail, nor proof of a repaired browser/OS audio driver.

The local-introduction browser tests did not use a human microphone or measure acoustic latency, perceptual realism, native Google conversation, a public deployment, or all device types. A separate subsequent native regression is recorded below. The authored introduction's cached server timing is not spontaneous-answer latency.

## Waveform conservation check

An additional browser **OfflineAudioContext** comparison rendered the exact same twelve-second waveform as one uninterrupted buffer and as three scheduled four-second ranges, using the actual loaded application's scheduling method. At 24 kHz input / 48 kHz output, all 580,800 compared samples were identical. At 44.1 kHz input / 48 kHz output, the maximum absolute difference was 2.98e-8, with RMS difference 6.52e-9. Both passed the predefined 1e-5 tolerance.

This supports preservation of sample ordering and resampling continuity at the slice boundaries. It does not measure a user's physical output device, perceived naturalness, native streaming, or multi-turn recovery. The unsuccessful full browser runs above remain unsuccessful; this independent DSP check does not relabel them.

## Native conversation preserved — later independent check

The local native-voice gate had expired. The authenticated Google AI Studio page for the same project was inspected at19:45:04UTC on15October2026 and still showed **Free tier**, **Set up billing**, and Gemini3.8Live's65,000TPM limit. Only that observation record was renewed; no key, consent, project, billing setting or paid fallback changed.

The existing native conversation acceptance suite was then run in **headed Chrome**, retaining all eighteen original assertions. **18/18 passed**: the synthetic spoken question interrupted the actual provider introduction, received evidence from the relevant agentic-AI project page, and retained that context in a typed follow-up. Speech-driven mouth/gesture motion worked; ending released the microphone and provider session; mobile overflow and console/HTTP checks passed.

The first spoken-answer audio packet was observed at6.79seconds; the contextual follow-up at0.89seconds. These are first-packet timings, not measured microphone-to-ear delay. The face classifier emitted1,844events across14distinct classes, including the open-vowel class0; those are classifier outputs, not ground-truth phoneme alignment. The question audio was explicitly synthetic, not a participant recording or noisy-room test.

[Actual native conversation recording](../evidence/2026-10-15-audio-backpressure/actual-native-conversation.webm) and `native-regression.json` preserve this result separately. This does **not** convert the previously failed complete local-recovery suites into passes or establish public-site readiness.

## Reproduce

```sh
cd rehearsal
npm test
npm run build
# Requires the running local application and a usable Mac audio output.
EINSTEIN_HEADED=1 node tests/speech-backpressure.e2e.mjs
# Independent waveform continuity check; uses no physical audio output:
node tests/speech-waveform.e2e.mjs
```

The browser test records the real canvas and outgoing audio, preserves waiting time, and does not access a microphone or call a model provider. It records failure outcomes instead of treating a build as behavioral proof. Existing captured failure artifacts remain in the original checkout's ignored `.work/audio-queue-repair-20261015/` directory.

## Integration boundary

Only this audio repair and its tests are in the review branch. The original development checkout, its staged neck/feedback work, the separate public-release checkout, and upstream `raynaney/mixed_reality_einstien` are preserved. This repair does **not** certify completion of the paper, video, slide, visitor-isolation or public-launch requirements.
