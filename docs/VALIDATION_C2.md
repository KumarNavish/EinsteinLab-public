# Acceptance record — 14 October 2026 continuation

## Decision

**The controlled desktop spoken interaction now works. The full Steering Committee / Quest acceptance criteria are not met.** The decisive remaining problems are response latency, broad answer/follow-up reliability, and native/headset verification.

This continuation started from `ab59e159b6e7dbf84bdeaa65ad098ad5b3bd815a`. The original private scene and assets remain intact; no changes were merged into upstream `master`.

## What was actually verified

| Surface | Result and boundary |
|---|---|
| Original character performance | The private FBX was exported with its original approximately 22-second iClone standing performance. Browser verification observed 312 animation tracks and actual hand movement during speech. This is no longer a fixed T-pose or an amplitude-only cartoon substitute. |
| Spoken input | Browser `getUserMedia` → AudioWorklet → energy-based utterance detection → local Whisper. The test uses an explicitly synthetic microphone fixture, not a real participant or an acoustic room. |
| Automatic interruption | Speech onset interrupted the playing introduction without an operator pressing Interrupt. This verifies controlled playback interruption, not all full-duplex/noisy-room behavior or every generation-phase cancellation case. |
| Answer generation | The spoken agentic-AI question produced a newly generated, relevant answer with passages from the lab's actual agentic-AI project page. Q&A content is generated rather than an authored fixed script; identical previously synthesized voice segments may be reused from the in-memory cache. |
| Voice and mouth motion | Kokoro George generated the outgoing waveform and phoneme-duration cues; those cues reached the actual character. The latest test delivered 207 mouth cues. Physical audiovisual offset is not measured. |
| Browser acceptance | Latest real-service voice test: **11/11 checks passed**, including microphone release, source relevance, automatic interruption, actual phoneme playback, current-turn timing display, and distinguishing passages from independent pages. Console and HTTP error lists were empty. |
| Source/unit checks | **48 Python tests passed; 8 browser unit tests passed.** These cover code boundaries and selected guards, not general semantic accuracy. |
| Native codec | **11 standalone C# checks passed under Mono.** This is not a Unity scene compile or a licensed player build. |
| Desktop layout/render | Actual desktop and mobile screenshots were inspected. The tested mobile viewport had no horizontal overflow. Active desktop samples were approximately 59–60 fps; this is not sustained Quest or thermal evidence. |
| Local launch | The launcher waits for model/voice readiness, prewarms the explicitly authored introduction, and owns the child server's shutdown. It does not replace an unrelated listener or activate paid services. |

The authored introduction is explicitly marked `prepared-introduction`. Normal answers are marked `local-synthesis`, `evidence-extract`, or `abstention`. Rejected generated output is not silently labelled a successful generated answer.

## Recorded latency: still unacceptable for the target live experience

The following are three controlled runs of the same designed spoken scenario. Transcripts, model output, machine workload, and voice-cache state vary; **this is not a matched before/after optimization benchmark**.

| Run | Transcription | Generation | Speech work | First answer-audio segment | Server completion |
|---|---:|---:|---:|---:|---:|
| Initial spoken run | 3.40 s | 30.15 s | 16.11 s | **49.87 s** | 49.87 s |
| Second spoken run | 2.57 s | 18.23 s | 14.45 s | **32.37 s** | 35.25 s |
| Latest release regression | 3.68 s | 34.13 s | 0.36 s | **38.02 s** | 38.18 s |

The latest voice work was substantially cached. Its 34.13-second generation stage is therefore the principal measured limiter, not speech synthesis. The interface now clears old timing information immediately when a new turn begins; previously it briefly displayed the introduction's tiny cached latency beside a new, slow answer. That misleading UI state was fixed and regression-tested.

Prepared-opening cache timings must not be used as spontaneous-answer latency. Likewise, recording presentation timestamps and the browser's first animation-frame observation of active audio are **not physical acoustic onset or measured lip-to-audio alignment**. The recordings include waiting time; no gap was removed to imply faster inference.

## Measured choices, including rejected alternatives

For the same short sentence and George voice, sequential CPU-only synthesis used three inference threads. Warm full-precision runs took **4.096 and 4.220 seconds**; int8 runs took **1.970 and 1.982 seconds**. Int8 was selected because this matched test showed about **2.1× less synthesis time**, while still returning finite audio and phoneme timings. This is not a perceptual-quality equivalence claim or an end-to-end speedup measurement.

Two smaller language-model integrations were evaluated rather than assuming smaller meant better. Qwen3-1.7B failed the structured-output path in its evaluated cases. A later, distinct Qwen2.5-1.5B-Instruct candidate ran the five designed checks in approximately **2.05–4.39 seconds**, but **0/5 passed the combined generated-output/source gate**. The retained Qwen3-4B passed **4/5** in that matched five-case check, taking approximately **7.31–9.54 seconds** without the rendering workload. The failed GenAI explanation was caught by the anticipated-outcome guard and fell back to an excerpt.

These are **integration results on a small development suite, not model leaderboards or general factual-accuracy scores**. Some failures were JSON/validation failures; they do not establish that a smaller model lacks the underlying knowledge. The faster candidates were not promoted merely to obtain a flattering latency number.

The candidate comparison also records prompt/decode throughput and peak MLX memory. The unrelated system workload was not controlled, so differences between host-only and rendered runs cannot be assigned exclusively to GPU contention.

## Grounding and follow-ups are not solved

The missing Qwen chat template is repaired, pinned, and tested. The generator now selects compact passage tags instead of retyping long hashes/quotations. Each selected tag resolves to an exact substring of an actual retrieved source. Additional checks reject unsupported numbers and selected cases where expected outcomes are stated as demonstrated findings.

**The lexical retrieval implementation itself was not rewritten.** Its known paraphrase failures and weaknesses in extractive fallback remain. The successful generated agentic-AI example shows that the model can select a relevant passage from the retrieved set; it does not establish that retrieval ranking is universally fixed.

In two actual three-turn sequences, asking for a simpler explanation fell back to an unsimplified project excerpt. A later small candidate comparison generated an acceptable simpler explanation from a supplied prior-context fixture; this is not the same as proving an unrestricted multi-turn conversation. An outcome question also produced an unqualified negative about what had been demonstrated. A new absence-of-evidence scope guard was unit-tested afterward, but a proposed additional live regression for that exact case was rejected by the execution tool and was not run.

The public snapshot remains **80 pages / 164 chunks**, with the previously documented budget and omissions. Full linked papers, private results, and unsupported current details are not supplied by this system. See the original [knowledge manifest](../evidence/2026-10-13/knowledge-manifest.json).

## Native / headset status

The exact Unity 2022.3.50f1 package was acquired and its package signature checked. An isolated editor launch reported both a licensing-client validation error and no valid entitlement/license. It stopped before native project compilation. This is not proof that the user's account has no license elsewhere; it is the observed status of this launch.

No entitlement was activated, no project was upgraded to the installed Unity 6 editor, and no APK was produced. No Quest was connected. Room placement, passthrough, physical scale, spatial audio, multi-participant gaze/turn-taking, headset frame time, and thermal stability remain untested. Browser WebXR UI/transparent-overlay work also remains unaccepted.

## Evidence and costs

[The release evidence directory](../evidence/2026-10-14/) contains the actual voice/video recording, silent full-interface walkthrough, screenshots, machine-readable checks, candidate comparisons, retained negatives, and checksums. The combined recording contains the rendered canvas plus its actual outgoing Web Audio in one MediaRecorder. It is neither a static mockup nor a later voice-over. The incoming synthetic question is represented by the fixture/transcript and is not on that outgoing-audio track.

Full public website passages are omitted from committed telemetry and replaced by hashes and source metadata. Original runtime evidence remains local. No credentials, model weights, private GLB, Unity caches, or full website snapshot are committed.

No paid model API was invoked, no purchase was made, and no paid service was activated. Local compute, power, download bandwidth, and existing subscriptions were not financially metered.
