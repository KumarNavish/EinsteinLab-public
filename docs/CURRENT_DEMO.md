> **New embodied explanation tools:** see [EMBODIED_EXPLANATIONS.md](EMBODIED_EXPLANATIONS.md) for actual conversational whiteboards, targeted arm gestures, German-influenced voice direction, matching previews, and current reliability limits. [Latest recorded proof](../evidence/2026-10-14-embodied/README.md). Earlier voice/research instructions are preserved below.

> **Current research scope:** see [RESEARCH_CAPABILITIES.md](RESEARCH_CAPABILITIES.md) for the fresh 120-page corpus, live official-page reading, actual Flash model and Google Search limitations. The voice/character operation below is preserved.

# Einstein: the native-voice desktop release

**The configured Google native voice now works through the complete tested browser flow.** A spoken question interrupts the introduction, receives a source-backed generated answer, and can be followed by a contextual question while the original character reacts to the actual outgoing audio.

This is a verified desktop improvement, not a claim of indistinguishable human realism or physical Quest acceptance. [Actual recording and measurements](../evidence/2026-10-14-native/README.md).

## Open it

On the prepared Mac, open **http://127.0.0.1:8765/**. Refresh an already-open tab to load the current controls. For a later start, double-click:

```text
/Users/kumar0002/Projects/EinsteinLab/Start Einstein.command
```

The terminal equivalent is:

```sh
cd /Users/kumar0002/Projects/EinsteinLab
.einstein-venv/bin/python scripts/launch.py
```

The launcher preserves an existing healthy server and never terminates an unrelated listener. `--no-browser` leaves browser navigation to the operator. The service listens only on localhost; this is not a public deployment.

## Talk to Albert

With the configured native route selected, **Begin a conversation** connects Google audio and requests microphone access. Speak naturally and pause when finished. Speaking over the answer interrupts the output. **End conversation** releases the microphone and the provider session. The separate interrupt button ends the current native session immediately.

A typed conversation can become a spoken one: **Speak to Albert** attaches the microphone to the same connection rather than accidentally closing it. Questions, replies, and sources remain contextual; there is no separate operator answering behind the scenes.

The default for a newly configured native route is **Algenib**, a textured voice. **Gacrux** and **Sadaltager** are also selectable. Saved choices are preserved. The settings now show the actual Google voice, not the irrelevant local George/Alan controls.

**Hear this voice** plays an explicitly recorded sample of that actual native voice. It opens no microphone and makes no provider request. These previews are not passed off as spontaneous answers. Voice changes apply on the next connection; end a running conversation before changing voices.

**Spoken answers** controls the real output gain for both native and local playback. **Captions** and **Research notes** are optional; technical details remain inside settings rather than dominating the character view.

Headphones are appropriate for an initial live test. The browser requests echo cancellation, but the successful automated test used a synthetic microphone fixture, not a real room of participants.

## What changed

The native route uses direct Gemini audio, not the old speech-recognition → local language-model → TTS chain. A real test found that an evidence lookup was being treated as a completed answer before audio existed. The lab lookup is now explicitly blocking, and a tool-only boundary is not presented as a finished answer.

The face estimates several mouth shapes from the same outgoing waveform using a small, local HeadAudio worklet. The original CC4/iClone performance remains intact; its gesture strength and speed respond to vocal energy. Listening/thinking states, variable blinks, subtle head movement, and revised skin/hair/eye lighting support the presence without adding a second generated face or replacing the voice.

The audio path applies **70 ms of configured compensation** for the local viseme estimator. That is not a measured physical lip-sync result. Estimation remains fallible, and the character is still a synthetic 3D portrayal.

## Evidence, not just configuration

The real native browser run passed **18/18 checks**, including provider interruption, a spoken agentic-AI question, contextual follow-up, source evidence, mouth-shape variation, session/microphone release, and mobile layout. First audio packets were observed after approximately **1.80 seconds for the spoken question** and **0.91 seconds for the typed follow-up**. Those clocks start at a client speech-end estimate or text submission, not a microphone-to-ear acoustic instrument.

The three same-text voice previews produced first packets in **0.70–0.98 seconds**. The latest settings/preview check passed **11/11**, including zero provider requests during preview, actual mute behavior, preference retention, and hiding the unrelated voice controls. Final source checks: **81 Python tests and 22 JavaScript tests**.

The full native recording precedes the subsequent reflection/material, cached-preview, default-voice, and optional-source-loader edits. The material/preview changes have separate actual browser evidence; an attempted additional combined native repeat and broader dialogue batch was blocked before dispatch. Do not infer that unexecuted test from the earlier successful one.

## Privacy and cost boundary

The user entered the credential through the local form. This release did not retrieve it from a browser, change it, activate billing, or add a paid fallback. Native operation requires explicit external-processing consent and the previously verified free-tier project. The provider model is fixed; a native session is limited to ten minutes and one active connection.

Native mode sends microphone audio and public lab context to Google. Free-tier content may be used to improve Google products. The bridge does not save normal microphone audio or conversation transcripts. Explicit test scripts save their synthetic-input recordings and transcripts as labelled evidence.

Only engine and voice preferences enter localStorage. The credential remains in the ignored owner-private `.work/private/` directory and is never included in the repository or evidence. The application’s free-tier approval expires after 24 hours; a fresh billing/quota check is required before renewing it. Expiry disables the external route rather than silently permitting a charge.

## Reproduction on another Apple Silicon Mac

Use existing authorized access to the private repository and preserve upstream asset rights. No paid provider is required for the local fallback. After installing approved Git LFS, Python/uv, Node, and Blender tooling:

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

The local Python environment and Blender export were tested on Apple Silicon. The original large GLB, model caches, full website snapshot and credentials are not committed. The setup script installs the original locked speech/language models. Extra semantic encoder/reranker files are optional: if absent, the source loader explicitly reports the preserved lexical backend instead of failing startup. Native named-project lookup still uses the actual public project pages. A completely fresh machine installation has not been exercised end-to-end.

A new machine needs its own independently verified free-tier configuration and operator consent; this repository does not ship an API key or a reusable billing approval. Refreshing the public website snapshot requires the ingestion command and a server restart, not a Unity/UI rebuild. Changed-page hashes disable old reviewed summaries.

## Test commands

```sh
.einstein-venv/bin/python -m pytest lab_backend/tests -q
(cd rehearsal && npm test && npm run build)
# Local configuration and an idle native service must already exist:
.einstein-venv/bin/python scripts/verify_native_voice.py --approved-public-text-test
.einstein-venv/bin/python scripts/create_voice_fixture.py
export PLAYWRIGHT_BROWSERS_PATH="$PWD/.work/playwright"
(cd rehearsal && npx playwright install ffmpeg)
(cd rehearsal && node tests/native-presence.e2e.mjs)
(cd rehearsal && node tests/voice-settings.e2e.mjs)
```

Native tests make real, bounded provider requests only after the local configuration gate passes. The settings test instead uses the recorded previews and makes no provider-generation request. Mock-provider unit tests are labelled separately.

## Remaining acceptance gates

Physical Quest, the required licensed Unity build, real-room echo, participant gaze/position, sustained headset frame time/thermals, and human listening comparison with GPT-Live remain unverified. The existing Unity bridge is not automatically upgraded to the new browser native-audio path. The public knowledge snapshot is not a full-paper review or a guarantee that every research question can be answered.

The fastest honest next evaluation is a real human conversation with the running native mode and its three voice choices—not another claim of completion from downloaded models or passing protocol schemas.
