# Third-party source and asset notices

This branch extends the existing **private** `raynaney/mixed_reality_einstien` repository. It does not apply a new top-level license to the upstream project, grant rights to CC4/iClone source assets, or authorize public redistribution. Preserve upstream authorship, embedded package notices, and original file history.

## Avatar, motion, and prerecorded voice

The original Einstein FBX, textures, iClone animation, calibration, and prerecorded voice remain upstream materials. No top-level upstream license was detected at inspection. Access to this private repository is not evidence of an unrestricted redistribution license. The browser GLB is a derivative generated locally from those assets and deliberately ignored by Git. The operator explicitly instructed public hosting of the existing character on 16 October 2026. That instruction authorizes this deployment; it does not establish a third-party copyright licence or unrestricted downstream redistribution rights. The publication record identifies the exact deployed asset.

## Added software dependencies

Installed package metadata reports: Piper `1.8.0` — `GPL-3.0-or-later`; Faster-Whisper `1.2.1` — MIT; MLX-LM `0.32.0` — MIT; PyAV `19.0.1` — BSD-3-Clause; FastAPI `0.143.0` — MIT. Three.js and Vite retain their upstream license notices in their packages. This notice is not a declaration that all components have one uniform license; review distribution obligations before releasing a combined product.

Model revisions and downloaded-file hashes are preserved in `evidence/2026-10-13/model-provenance.json`. Qwen3-4B-Instruct-2507's MLX model card identifies Apache-2.0. The local generation path is experimental and currently fails setup validation; its presence is not a working model result.

## Piper Alan voice

The downloaded voice card identifies `en_GB`, one speaker, 22,050 Hz, medium quality, fine-tuned from a US English Lessac medium voice. It points to the Mycroft `en_UK/apope_low` dataset for licensing rather than stating a standalone license in the card. Follow the linked source terms before redistribution. Do not label this as Einstein's authentic voice or a clone of it.

Source voice reference supplied by the card: https://github.com/MycroftAI/mimic3-voices/tree/master/voices/en_UK/apope_low

## Public lab content

The knowledge service ingests public pages only for the local demonstration. Page text is not committed wholesale. The committed manifest contains titles, URLs, dates, and content hashes; a few exact excerpts are retained as necessary test evidence. No private research findings, credentials, or committee materials were ingested. Website access does not imply that expected results have been empirically established.


## Continuation: Kokoro and retained performance

The continuation uses `kokoro-onnx` with the official `thewh1teagle/kokoro-onnx` release `model-files-v1.1`, selecting the int8 model and `bm_george` voice. The wrapper repository identifies an MIT license; the upstream Kokoro-82M model card identifies Apache-2.0. Preserve the applicable upstream notices and inspect the exact voice/model terms before redistribution. These statements do not grant new rights to the original private Einstein character, iClone performance, or any other bundled material.

Primary references:

- https://github.com/thewh1teagle/kokoro-onnx
- https://huggingface.co/hexgrad/Kokoro-82M
- https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1

The original private performance is now included in the **locally regenerated** browser derivative. The large derivative stays ignored. The committed screen recordings document the authorized private development branch; no public distribution permission is asserted.

Exact selected model revisions and speech/template file hashes are in `lab_backend/models.lock.json`. Additional smaller model candidates were downloaded for isolated application tests and were not selected or bundled. The demonstration voice is a synthetic portrayal, not Einstein's authentic voice, a claim of historical endorsement, or a participant recording.


## Native-audio face estimator and recorded voice previews

HeadAudio is vendored from `met4citizen/HeadAudio`, commit `d3af5f9ff86ab6b2b1913d411a4e1922ec101953`. Its MIT license and per-file hashes are retained in `rehearsal/public/vendor/headaudio/`. It estimates Oculus visemes from waveform features, which the application maps onto the existing CC4 character. This does not grant new rights to the original private character or animations, and is not a claim of exact phoneme alignment.

Primary implementation: https://github.com/met4citizen/HeadAudio

The three short voice previews are generated samples of the selected Google native voices and are labelled recordings. No authentic Einstein recording or cloned voice is used. Their metadata and hashes are in `rehearsal/public/voice-previews/manifest.json`. Public distribution rights to unrelated upstream character assets are not asserted. Preserve applicable Google service terms and the synthetic-portrayal disclosure.

Primary provider references: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live and https://ai.google.dev/gemini-api/docs/speech-generation


## Articulation integration and German-directed samples

The zero-class correction and audio-clock smoothing are application integration code. The vendored HeadAudio distribution and its MIT notice were not modified; its original recorded hash remains intact. `rehearsal/src/viseme-timing.js` accepts the valid open-vowel class zero explicitly rather than treating it as a missing event. It is an acoustic estimate, not provider-supplied phoneme truth.

The German-influenced voice previews are new synthetic Google-native samples generated from the same authored comparison dialogue, not recordings of the historical Einstein or private participants. `rehearsal/public/voice-previews/german/manifest.json` records their exact hashes, text, timing observations and provenance. The voices remain subject to the applicable provider terms; no new license to the private avatar or original motion assets is asserted.

Whiteboard diagrams are model-authored conceptual explanations rendered from bounded graph data. Attribution links refer to inspected source pages; the generated diagrams are not original figures from those papers. No scientific publisher image or PDF was successfully incorporated in this release, and no failed challenge page is redistributed as a figure.
