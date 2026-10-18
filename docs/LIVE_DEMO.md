# Run the interactive Einstein desktop prototype

**Current status:** a working, source-grounded desktop voice prototype with an authored opening, automatic speech interruption, local generation, expressive speech, and the original animated character. The controlled browser microphone test passes. **It is not yet a committee-ready, low-latency Quest release.** Read [the measured acceptance record](VALIDATION_C2.md) before presenting.

## On the prepared Mac

Open this file in Finder:

```text
/Users/kumar0002/Projects/EinsteinLab/Start Einstein.command
```

The launcher either opens the existing local application or starts it and waits for its models and prepared introduction to be ready. Initial preparation was approximately 41 seconds in the recorded run. The application is available at **http://127.0.0.1:8765/** on that Mac only; it is not a public deployment.

The equivalent terminal command is:

```sh
cd /Users/kumar0002/Projects/EinsteinLab
.einstein-venv/bin/python scripts/launch.py
```

Use `--no-browser` for automated operation. The launcher never terminates an unrelated listener. Ctrl+C stops a server started by that launcher. If a server is already running, the second launcher only opens the page; it does not take ownership of the existing server.

## Present the current prototype

Click **Begin with an introduction**. This is an explicitly labelled, authored introduction, not a fabricated historical quotation or a supposedly spontaneous answer. Its voice is prepared at startup and cached in memory.

Click **Start voice conversation** and grant microphone permission. Ask a question, then pause. Speech detection submits the question after approximately 0.85 seconds of silence. While Einstein speaks, sufficiently clear new speech interrupts playback and starts the next question. **End conversation** releases the microphone. **Interrupt** remains available as a manual stop.

Desktop testing should use headphones: the browser requests echo cancellation, but real loudspeaker-to-microphone echo and a room of participants have not been validated. The included end-to-end test uses an explicitly synthetic microphone fixture in an isolated Chrome profile, not a human recording.

The following question completed the full automated spoken flow with a relevant source and generated answer:

> What does the lab investigate about delegating decisions to agentic AI?

The source panel exposes the exact retrieved public evidence. Generation can fall back to a direct excerpt when its output fails validation. **Evidence-only fallback** bypasses language generation but does not fix the known retrieval weaknesses. **Fast** voice uses Piper; **Expressive** uses Kokoro George with phoneme-duration cues. Neither is Einstein's authentic voice.

## Important limits during operation

**Do not describe the current response timing as immediate.** A recorded spoken question took about 50 seconds to its first answer-audio segment under the full desktop rendering/recording workload. A separate browser-free repeated query was faster, but voice caching and workload differences prevent a fair end-to-end speedup claim. Switching to the fast voice can reduce speech synthesis work; it does not remove model-generation or retrieval limitations.

**Do not promise reliable answers to every committee question.** Three designed project-generation checks and the spoken agentic-AI example passed, but general retrieval still has known paraphrase failures. In a two-repetition follow-up check, asking for a simpler explanation fell back to an unsimplified source extract. A negative-outcome answer also overstated what missing public evidence establishes; an additional scope guard was added afterward. Exact source tags, quotations, numbers, and selected assertion patterns are checked; full semantic entailment is not proven.

The character now uses the original approximately 22-second iClone standing performance. Its face follows timing from the same generated voice waveform. Physical lip-to-audio alignment, actual participant gaze, multi-person turn-taking, thermal stability, and headset frame rate remain unverified.

**Quest controls are experimental.** The original Unity scene remains the intended native path. Browser WebXR placement is implemented but the headset UI/transparent overlay is not accepted. Do not treat the desktop experience as proof of correct mixed-reality composition.

## Fresh checkout on an Apple Silicon Mac

Use existing authorized access to the private upstream and preserve its asset rights. Install Git LFS and the required open-source tools using approved local procedures. No paid provider key is required.

```sh
GIT_LFS_SKIP_SMUDGE=1 git clone --branch feat/mobiliar-local-20261013 <private-repository-url> EinsteinLab
cd EinsteinLab
git lfs pull --include='Assets/Albert Einstein_blender.fbx,Assets/Textures/**,Assets/Animation/Einstein_WalkAway.anim' --exclude=''
uv venv --python 3.12 .einstein-venv
uv pip sync --python .einstein-venv/bin/python lab_backend/requirements.lock
.einstein-venv/bin/python scripts/setup_local_models.py --llm --expressive
.einstein-venv/bin/python -m lab_backend.ingest --limit 80
mkdir -p .work rehearsal/public/assets
/path/to/Blender --background --python scripts/export_performance.py
cp .work/einstein-performance.glb rehearsal/public/assets/einstein.glb
(cd rehearsal && npm ci && npm run build)
.einstein-venv/bin/python scripts/launch.py
```

The tested export used Blender 5.2.0 LTS. The Python lock is Apple-Silicon-specific because it includes MLX; Linux/Windows installations are not validated by this lock. The model installer pins the selected repositories/revisions and verifies the speech-file and chat-template hashes. It reports an existing mismatch rather than silently overwriting it.

The private GLB derivative, original model downloads, website text snapshot, Unity cache, and virtual environment are not committed. Recreate them locally. The original source FBX and animations remain unchanged. Refresh the website with the ingestion command, then restart the backend; no UI or Unity rebuild is needed for a knowledge-only refresh. The bounded snapshot excludes full linked papers and private lab records.

## Reproduce the checks

```sh
.einstein-venv/bin/python scripts/setup_local_models.py --llm --expressive --verify-only
.einstein-venv/bin/python -m pytest lab_backend/tests -q
(cd rehearsal && npm test && npm run build)
.einstein-venv/bin/python scripts/create_voice_fixture.py
export PLAYWRIGHT_BROWSERS_PATH="$PWD/.work/playwright"
(cd rehearsal && npx playwright install ffmpeg)
# With the localhost service already running:
(cd rehearsal && node tests/browser.c2.mjs)
(cd rehearsal && node tests/voice.e2e.mjs)
PYTHONPATH=. .einstein-venv/bin/python scripts/evaluate_conversation.py
```

The voice test launches a separate Chrome profile with synthetic input. It records the actual canvas and outgoing Web Audio together, as well as a separate silent recording of the full interface. It does not access a human microphone. The raw recording retains the waiting time; it is not a sped-up or redubbed mockup.

`tests/native/WaveCodecTests.cs` contains the separate C# codec checks. They passed under Mono, but **are not a Unity scene compile or player build**.

## Native Unity / Quest

Use **Unity 2022.3.50f1** and the upstream built-in rendering pipeline. The exact signed editor was acquired and launched in an isolated directory, but reported licensing-client validation errors and no valid license/entitlement for that launch. No activation, purchase, project upgrade, license bypass, or APK generation was performed.

Once a valid entitlement and the target headset are available, open the original scene and use **MRDemo / 6. Add local lab conversation (no paid services)**. The native bridge accepts the generated waveform's phoneme cues before falling back to the older voice calibration. This bridge is source code, not an accepted native runtime result.

See [the continuation checkpoint](SESSION_CHECKPOINT_C2.md) for exact owned processes, blocked operations, and remaining acceptance gates.
