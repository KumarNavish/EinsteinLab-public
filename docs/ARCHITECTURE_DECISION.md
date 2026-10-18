> **Updated implementation, 14 October 2026:** the original iClone performance now runs in the browser; Qwen3-4B local generation works; Kokoro George int8 provides speech plus phoneme-duration cues; Whisper plus an AudioWorklet enables controlled hands-free interruption. [Read the current measured selection and limitations](VALIDATION_C2.md). The first-pass architecture/cost reasoning below is historical where it describes broken generation or missing browser animation.

# Architecture decision and cost boundary

Reviewed 13 October 2026. This is a feasibility decision grounded in the available source and hardware, not an exhaustive or measured ranking of all current products.

## Preserve the expensive part already built

The upstream private project already contains a CC4 Einstein, carefully mapped mouth/jaw behavior, blink/idle motion, iClone performance clips, Meta room placement, and prerecorded voice. Replacing it with a stock cartoon or static generated portrait would discard useful work. The native Unity scene is therefore the eventual headset path; the browser is a fast, separately testable rehearsal, not a claim of identical rendering or animation quality.

The 298,128,736-byte FBX was restored and hash-verified. Blender converted a selected-morph, resized-texture GLB of 69,905,644 bytes for the browser. Original source assets are preserved and the private derivative is regenerated locally. Gaussian splats were not selected because this prototype needs a working articulated face/jaw and interaction pipeline, not merely a convincing static capture. No new asset purchase or MetaHuman migration was justified by verified improvements.

## Components and trade-offs

| Component | Zero-additional-model-API path built here | Trade-off / paid alternative |
|---|---|---|
| Rendering | Existing Unity/CC4 for native; Three.js/WebXR + original GLB for rehearsal | Browser loses original performance clips and currently uses simpler materials/idle motion. Native Unity and Quest remain unverified. A replacement asset pipeline has no demonstrated advantage yet. |
| Speech input | Local Faster-Whisper base.en, CPU int8; repaired bounded PyAV decoder | Exact synthetic transcription verified. English-only configuration; no measured noisy-room or full-duplex performance. |
| Answers | Transparent lexical retrieval + exact source excerpt; experimental MLX Qwen implementation | Extractive mode is less conversational and retrieval variants currently fail. Qwen chat-template setup is broken. Neither is a finished intelligent host. |
| Voice | Local Piper Alan | Real WAV generation/playback verified; generic British synthetic voice, not Einstein's authentic voice or validated expressive performance. Paid speech remains gated off. |
| Mouth motion | Native existing uLipSync/viseme/jaw integration; browser output-amplitude jaw/morph drive | Browser is not phoneme timing. Native calibration was not revalidated for the new voice. |
| Knowledge | Bounded public ETH website snapshot with URL/date/hash provenance | Fast offline lookup after ingestion; no full-paper ingestion, private material, automatic freshness guarantee, or reliable open-ended answer accuracy yet. |

## GPT-Live versus Realtime

Official OpenAI documentation now provides **GPT-Live** as a distinct full-duplex voice surface: the voice frontend can keep listening/speaking while a separately chosen backend handles reasoning or tools. Client delegation can connect an existing service; it does not require using a coding agent. The Realtime API is a separate integration, not an interchangeable model name on the same endpoint.

The official `gpt-live-1` price is **USD 0.05 per minute of voice-session duration**, billed per second, **plus separate backend model/tool usage**. Thus a 20-minute voice layer is USD 1.00 before backend charges. Active session time includes pauses and backend waiting. This is a cost illustration, not a charge incurred or a measured quality advantage. No Live/Realtime session or API key was created here, and a ChatGPT subscription was not treated as API credit.

For a later approved trial, compare the existing local pipeline against a bounded GPT-Live voice session using the same evidence service and frozen questions. Measure interruption quality, answer correctness, perceived naturalness, and full session cost. Do not claim a superior result before that comparison.

## Primary references

- OpenAI, GPT-Live model and pricing: https://developers.openai.com/api/docs/models/gpt-live-1
- OpenAI, architecture/delegation: https://developers.openai.com/api/docs/guides/live
- OpenAI, usage accounting: https://developers.openai.com/api/docs/guides/voice-latency-cost
- OpenAI, Live versus Realtime connection surfaces: https://developers.openai.com/api/docs/guides/voice-websockets
- Piper Python API: https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/API_PYTHON.md
- Faster-Whisper source: https://github.com/SYSTRAN/faster-whisper
- Qwen MLX model card: https://huggingface.co/mlx-community/Qwen3-4B-Instruct-2507-4bit
- Meta browser platform documentation: https://developers.meta.com/horizon/documentation/web/browser-specs/
- Lab public website: https://mobiliarlab.ethz.ch/ (observed canonical links use https://mobililab.ethz.ch/)

No new billable service, purchase, or upgrade was activated. Local hardware, download bandwidth, and existing repository quotas are real resources; their monetary consumption was not audited.
