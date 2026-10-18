> **Historical first-pass record (13 October 2026).** Superseded for current operation by [the live operator guide](LIVE_DEMO.md), [the continuation validation](VALIDATION_C2.md), and [current owned state](SESSION_CHECKPOINT_C2.md). The original failures and measurements are preserved below.

# Local Mobiliar Lab rehearsal

**Status: development prototype, not a committee-ready or headset-verified release.**

The original Unity/CC4 character is retained. A local speech/knowledge service, a browser rehearsal, and an opt-in Unity conversation component were added. The recorded desktop test proves one typed, source-backed question -> spoken answer -> immediate playback interruption. It does not prove reliable unscripted Q&A. Read [VALIDATION.md](VALIDATION.md) before presenting.

## Start here on the development Mac

Working checkout: `/Users/kumar0002/Projects/EinsteinLab`.
Branch: `feat/mobiliar-local-20261013`.

**The backend is stopped at handoff.** Its restart was blocked by the execution tool after the old owned server was stopped. No alternative restart was attempted. The following are normal operator instructions, not a claim that a service is currently running.

```sh
cd /Users/kumar0002/Projects/EinsteinLab
export PATH="$PWD/.work/bin:$PATH"  # this checkout's locally installed Git LFS
# Use the existing extractive fallback. This does not repair or enable generative Q&A.
export EINSTEIN_LLM="$PWD/.disabled-local-generation"
.einstein-venv/bin/python -m uvicorn lab_backend.app:app --host 127.0.0.1 --port 8765 --no-access-log
```

Open `http://127.0.0.1:8765/` on that same Mac. Do not expose this development service publicly. No cloud credential is required. Terminate the foreground command with Ctrl+C.

For the demonstrated interaction, leave **Evidence-only fallback** selected and type **“How do LLMs affect cognitive load?”**. The page displays the source, plays a locally synthesized answer, and allows **Interrupt**. **Speak a question** starts recording; **Finish question** submits it. Recording automatically ends after 19 seconds. Microphone recordings are processed in memory by the service; the included recordings are explicitly generated test fixtures.

**Important known counterexamples:** “How do large language models affect cognitive load?” and “What does the lab investigate about delegating decisions to agentic AI?” retrieved irrelevant sources during testing. Do not describe this as a robust natural-language retrieval system. The local Qwen generator is also nonfunctional in this snapshot because its separate chat-template file was not downloaded. The proposed repairs were blocked before execution and remain unapplied.

## What the visual controls do

The GLB is a derived version of the original private CC4 asset, not an invented stand-in. Portrait/full-figure views and orbit controls are available. Browser mouth motion follows outgoing audio amplitude and a jaw bone; it is **not phoneme-aligned lip synchronization**. Blink and small idle head movements are procedural. The browser derivative does not contain the original iClone gestural clips.

The latest code contains fixes for the stiff arm pose, floor appearance, answer layout, favicon, and a removed Three.js shadow-map setting. Its build and unit tests pass, but a new rendered test was blocked by the unavailable service restart. The screenshots and screen recording show the **earlier tested visual state**, including its visible defects.

## Reproduce a fresh development checkout

Use existing authenticated access to the private source repository. Preserve its license/asset restrictions. Git LFS is required; its downloads may consume existing repository bandwidth quotas.

The tested platform is Apple M1, 16 GB RAM; Node 26.8.2; Python 3.12; Blender 5.2.0 LTS. The Python lock includes Apple-specific MLX packages. It is not a validated Linux/Windows lock.

```sh
GIT_LFS_SKIP_SMUDGE=1 git clone --branch feat/mobiliar-local-20261013 <private-repository-url> EinsteinLab
cd EinsteinLab
git lfs pull --include='Assets/Albert Einstein_blender.fbx,Assets/Textures/**,Assets/Animation/Einstein_WalkAway.anim' --exclude=''
uv venv --python 3.12 .einstein-venv
uv pip sync --python .einstein-venv/bin/python lab_backend/requirements.lock
.einstein-venv/bin/python scripts/setup_local_models.py
.einstein-venv/bin/python -m lab_backend.ingest --limit 80
/path/to/Blender --background --python scripts/export_avatar.py
(cd rehearsal && npm ci && npm run build)
```

The standard model setup downloads only the free local Whisper and Piper models. `--llm` additionally downloads Qwen, but that path has the unresolved chat-template defect above; do not enable it for a live presentation. No paid provider is selected as a fallback.

The generated GLB, full website snapshot, models, and environment directories are not committed. Regenerate them with the commands above. The original LFS FBX and textures remain in the upstream repository. `evidence/2026-10-13/knowledge-manifest.json` preserves URL/date/hash coverage; linked full papers and private lab material are not ingested.

## Knowledge refresh

```sh
.einstein-venv/bin/python -m lab_backend.ingest --limit 80
```

Restart the backend after a successful refresh to load the new snapshot. Rebuilding Unity or the browser bundle is unnecessary for a knowledge-only refresh. The crawler follows only the two observed ETH lab hostnames, checks robots policy, allows the site's specific WordPress routes, and preserves provenance. Its 80-page budget left one queued URL and two skipped resources in this run. A research project's **Expected Results** are not measured findings.

## Native Unity integration

Use **Unity 2022.3.50f1**, the existing built-in rendering pipeline, and the pinned package manifest. The installed Unity 6000.0.62f1 was deliberately not used to upgrade this project.

1. Open `Assets/Scenes/SampleScene.unity` in the pinned editor. Do not rebuild the scene or duplicate the camera rig.
2. Choose **MRDemo / 6. Add local lab conversation (no paid services)**. This wires the new component to the existing voice, mouth, motion, and calibration profile. Save the scene deliberately after review.
3. Start the local service separately. In the editor, use **6 / left thumbstick** to start or finish a question; **7** interrupts. The operator panel also accepts typed questions.
4. For a physically connected development Quest, `adb reverse tcp:8765 tcp:8765` is the intended loopback development transport. Android microphone permission, cleartext-loopback policy, package compatibility, and the actual build still require device validation. Remote deployment needs HTTPS; do not embed provider credentials.

No headset was connected; no APK was produced. Native code was not compiled in the pinned editor. AR hit testing, placement, scale, passthrough, lip timing, frame rate, thermals, echo behavior, and headset audio are unverified. The WebXR path is experimental and is not a substitute for those checks.

## Operator fallback and stop conditions

If retrieval is wrong, do not improvise a lab finding. Show the source and return to a prepared, reviewed question. The original prerecorded Unity sequence remains available without API credits; it is the upstream sequence, **not a new Mobiliar research presentation**. Stop the demo rather than imply a scripted fallback is live reasoning.

The new paid-speech gate defaults to false. Do not turn it on without explicit spending approval. No GPT-Live/Realtime integration or key provisioning was performed.

## Tests

```sh
.einstein-venv/bin/python -m pytest lab_backend/tests -q
(cd rehearsal && npm test && npm run build)
# Requires the local service, Chrome, and Playwright's video recorder:
(cd rehearsal && npx playwright install ffmpeg && node tests/browser.smoke.mjs)
# Deliberately retains failing retrieval and first-audio-path cases:
PYTHONPATH=. .einstein-venv/bin/python scripts/evaluate_local.py
```

On the prepared Mac, the test recorder is installed in `.work/playwright`; set `PLAYWRIGHT_BROWSERS_PATH="$PWD/.work/playwright"` before entering `rehearsal/`. The recorded browser test used an isolated headless Chrome profile, not the user's browser session. A browser smoke pass for one question cannot establish full task accuracy.
