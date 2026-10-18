# Local and Unity history

These dated demonstrations and original setup instructions are preserved from the
previous README. They describe the prepared Mac or Unity project, not the current
public OpenAI deployment or its acceptance. Their historical test totals,
provider behavior and limitations remain scoped to the dates below.

For current status use [PUBLIC_LAUNCH.md](PUBLIC_LAUNCH.md) and
[release/readiness.json](../release/readiness.json). The public app runs without
the prepared Mac. The existing local Gemini route and original Unity sources are
preserved; neither proves a completed public voice launch.

## Conversational whiteboards and German-influenced delivery

**Einstein now responds to spoken requests by creating an actual conceptual diagram, highlighting an existing component with a targeted arm gesture, and dismissing it on request.** The browser must acknowledge each rendered action before the model can report success. German-influenced English is available with matching recorded previews; the open-vowel lip-sync defect is repaired and tested over 160 seconds of recorded speech.

[**Watch the actual spoken whiteboard interaction**](../evidence/2026-10-14-embodied/actual-spoken-whiteboard.webm) · [Run and control it](EMBODIED_EXPLANATIONS.md) · [Measurements and retained failures](../evidence/2026-10-14-embodied/README.md)

The latest spoken visual test passed **10/10 checks**, the typed create/highlight/simplify/hide flow **17/17**, and the existing native interruption flow **18/18**. These are controlled desktop tests with synthetic microphone input, not human-room or Quest acceptance. The original character remains visibly synthetic; targeted head gaze, original-paper figure extraction, generic document reading, and experiment-video discovery/playback remain incomplete. No new spending was activated.

![Actual spoken request highlights an existing diagram element](../evidence/2026-10-14-embodied/spoken-pointing.png)

---

> **Research update (14 October):** [Live official-lab reading and Flash evidence checks](RESEARCH_CAPABILITIES.md) · [actual results, including provider failures](../evidence/2026-10-14-research/README.md). General Google Search is not enabled under the current project quota; the preferred 3.8 Flash endpoint timed out and the explicit 3.6 fallback remains intermittent.

# Einstein · a native-voice conversation with the Mobiliar Lab

**Real native audio now works end to end:** a spoken question interrupts Einstein, receives a source-grounded generated answer, and keeps context for a follow-up while the original character reacts to the actual waveform.

[**Watch the actual native voice and character**](../evidence/2026-10-14-native/actual-native-presence.webm) · [Open the operator guide](CURRENT_DEMO.md) · [Measured evidence and limitations](../evidence/2026-10-14-native/README.md)

On the prepared Mac, open **`Start Einstein.command`**, or visit **http://127.0.0.1:8765/** and refresh an older tab. The configured native route defaults to **Algenib** unless a voice preference has already been saved. Microphone access starts only when you choose to begin.

### Listen before choosing a voice

[Algenib · textured](../rehearsal/public/voice-previews/Algenib.wav) · [Gacrux · mature](../rehearsal/public/voice-previews/Gacrux.wav) · [Sadaltager · knowledgeable](../rehearsal/public/voice-previews/Sadaltager.wav)

These are recordings of the same short sentence from the actual native voices, not replacement audio for the demonstration. The in-app **Hear this voice** control plays them without a provider request or microphone access. The old George/Alan settings now appear only in local mode.

### Verified, with the boundary left visible

The real native browser flow passed **18/18 checks**: provider interruption, spoken question, contextual follow-up, relevant public sources, varied audio-driven mouth shapes, microphone/session release, and mobile layout. Observed first audio packets were **1.80 s** after the client’s speech-end estimate and **0.91 s** after a typed follow-up. These are not acoustic onset measurements.

The settings and recorded-preview flow passed **11/11 checks**. The final source passed **81 Python tests and 22 JavaScript tests**. The original CC4/iClone asset is preserved; a small local HeadAudio worklet estimates mouth shapes from the actual outgoing Google waveform.

**This is a verified desktop improvement, not certified human indistinguishability or a Quest-ready release.** The native recording predates subsequent material, cached-preview and source-loader edits; those have separate browser/unit evidence. A final combined native repeat was blocked before execution. Real-room echo, a human listening comparison, physical headset performance, and the licensed Unity build remain unverified. No billing activation or paid fallback was used.

![Actual native conversation, sources available on demand](../evidence/2026-10-14-native/native-speaking.png)

## Original upstream project

The original Unity scene, source assets, package pins, and instructions are preserved below. Do not treat the original prerecorded sequence as evidence that the new conversational or headset acceptance gates have passed.

# Einstein mixed-reality demo

A complete Unity project for a talking CC4 Einstein avatar in a Quest mixed-reality room. iClone animation supplies expression and gestures; timed Rhubarb visemes drive the prerecorded speech. Experimental uLipSync analysis drives new ElevenLabs replies during playback.

**Clone and open this project directly. Do not create a new Unity project or run the scene-building menus for a normal first launch.** The scene, imported model settings, materials, animation controller, voice recordings and calibration profile are already supplied.

## Requirements

- **Unity 2022.3.50f1**, as pinned in `ProjectSettings/ProjectVersion.txt`, installed through Unity Hub. Use the **Built-in Render Pipeline** already configured here; do not convert to URP.
- **Git and Git LFS**. The model, Blender source, many textures and Rhubarb distribution use LFS.
- Internet access for Unity's first package restore. `Packages/manifest.json` and `packages-lock.json` define versions: Meta XR All-in-One 201.0.0, Burst 1.8.18, and other dependencies. uLipSync 3.1.5 is embedded in `Packages/com.hecomi.ulipsync` and must be included in the checkout. Do not install another copy into Assets.
- Windows is the supported path for the included offline speech and Rhubarb tools. Other platforms can play existing clips; regenerating them requires suitable platform tools.
- For headset builds: Unity Hub's **Android Build Support**, including SDK/NDK Tools and OpenJDK; a Quest 3/3S configured for development; and room Space Setup on the headset. A headset is not needed to inspect the project or try the Editor's manual placement path.

## First run from GitHub

Replace the URL and destination below with your repository and preferred directory:

```powershell
git lfs install
git clone <repository-url> EinsteinDemo
cd EinsteinDemo
git lfs pull
powershell -NoProfile -File .\tools\check_collaborator_setup.ps1
```

Prefer a Git clone to GitHub's Download ZIP: LFS payload inclusion in archives can vary. If LFS downloads fail, ask the owner to upload the objects and verify your repository/LFS access. A small pointer text file is not the actual FBX or texture.

1. In Unity Hub, **Add project from disk** and choose the folder containing `Assets`, `Packages` and `ProjectSettings`. Open with 2022.3.50f1.
2. Allow package resolution, shader compilation and model imports to finish. The FBX is about 298 MB; the initial import can take time. Unity regenerates `Library`, `.sln` and `.csproj` files.
3. Open `Assets/Scenes/SampleScene.unity`. Do not add another camera rig, another MRUK instance, or rebuild the scene.
4. Enter Play mode, focus the Game view and press **3** to place Einstein in front of the camera. Existing lines should play with expression and synchronized mouth movement. Press **4** to restart the script.
5. **No generation script and no ElevenLabs account is required for the existing recordings.** Missing live-TTS configuration may produce an ElevenLabs warning; configure it only if you need new speech.

The setup checker is read-only. It checks required files and locally materialized LFS objects; it does not read credential files, start Unity, verify remote uploads, or validate headset behavior.

## Controls

| Editor key | Controller button | Action |
|---|---|---|
| 1 | A | Toggle wall reveal |
| 2 | B | Next environment |
| 3 | X | Place Einstein; afterwards skip/continue a line |
| 4 | Y | Restart scripted speech |
| 5 | Right thumbstick click | Request the live test sentence; requires ElevenLabs setup |

For physical QR placement, make/print a QR code with the exact payload **`einstein`**. There is no QR printable supplied in this repository. Manual placement with 3 is available without one.

## Optional: new speech with ElevenLabs

Two local files are intentionally excluded from Git:

- `.env`: Editor credential, using the exact key name `ELEVEN_LABS`.
- `Assets/Resources/ElevenLabsSettings.asset`: voice/model configuration and optional device credential.

The owner can provide the settings asset privately, or you can create it yourself. See [COLLABORATOR_HANDOFF.md](../COLLABORATOR_HANDOFF.md) for the complete manual handoff list.

1. Copy `.env.example` to `.env` at the project root and replace the placeholder with **your own** ElevenLabs API key. Do not put a real key in the example file.
2. Obtain the owner's settings asset, or select `Assets/Resources` in the Project window and use **Assets → Create → MRDemo → ElevenLabs Settings**, naming the asset exactly `ElevenLabsSettings`. Configure a voice ID your account can access, model ID and voice settings. Leave the asset's API key empty for Editor use. Defaults in the C# source are not evidence of the owner's current configuration.
3. On Einstein's **Eleven Labs Speaker**, assign that asset to **Settings** if the reference is missing. Keep Voice and Lip Sync assigned; Live Lip Sync Profile should reference `Assets/LipSync/EinsteinLiveProfile.asset`.
4. In Play mode, select Einstein, type a sentence under **Try a new sentence**, then click **Speak test sentence**. This consumes ElevenLabs credits. **Stop speaking** interrupts it. New speech and scripted playback take turns controlling the shared voice source.

`ElevenLabsSpeaker.Speak(string text)` is the entry point for a future conversation backend. Audio analysis is live during playback, but the present request waits for the full TTS audio response. There is no implemented microphone → speech recognition → LLM conversation loop or streaming TTS transport.

**Live quality is experimental.** The initial profile came from six existing recordings and agreed with held-out Rhubarb labels in 56/157 stable windows (35.7%). This is not a phoneme-accuracy claim. Prerecorded playback is the established path; the live profile needs better calibration and visual testing. Oculus LipSync is deprecated and is not used.

For a supervised device demo, `.env` is not read on Android. The existing **MRDemo → ElevenLabs: Copy API key into runtime settings (device builds)** menu embeds the local key in the ignored settings asset; **Clear API key from runtime settings** removes it. An embedded key is recoverable from a build; a distributable application needs a backend-held credential. Prerecorded playback needs neither operation.

## When to run tools and menus

Save/commit scene changes before using rebuilding tools. These are maintenance operations, not a mandatory first-run sequence.

| Need | Run, in order | Effect |
|---|---|---|
| Check a fresh checkout | `powershell -NoProfile -File .\tools\check_collaborator_setup.ps1` | Read-only availability check |
| Play supplied dialogue | Open SampleScene → Play → 3 | Uses supplied WAV/JSON files; nothing to generate |
| Change dialogue using ElevenLabs | Edit EinsteinScript Lines → **MRDemo/3c. Generate Voice Lines (ElevenLabs)** → save scene | Generates changed lines, attempts Rhubarb cues and assigns assets; uses credits |
| Change voice but keep dialogue text | Back up/remove the affected `LineNN.txt` stamps, then run **3c** | Generation otherwise skips unchanged text with an existing WAV |
| Use Windows offline placeholder speech | Edit Lines → **3a. Export Lines for TTS** → command below → **3d. Regenerate Visemes (Rhubarb)** → **3b. Assign Voice Lines** → save scene | Overwrites voice WAVs; Windows voice will differ from Einstein's ElevenLabs voice |
| Replace WAVs from another source | Place matching `LineNN.wav` files → update Lines text → **3d** → **3b** → save scene | Rebuilds timing for the new audio |
| Generate cues outside Unity | **3a** → `powershell -NoProfile -File .\tools\make_visemes.ps1` → **3b** → save scene | Uses exported dialogue and existing WAVs |
| Recalibrate experimental live analysis | After audio and cues match, **MRDemo/5. Recalibrate Live Visemes from Existing Audio** | Rebuilds EinsteinLiveProfile; do this after a voice change |
| Replace/reimport Einstein's model | **0. Configure Einstein Import** → **1. Fix Einstein Materials** | Updates model import/materials; inspect results |
| Deliberately rebuild the demo | **2. Set Up Demo Scene** → **3b** → **4. Use iClone Performance** | Rewires objects/settings and rebuilds animation setup; review all custom tuning |
| Rebuild iClone clips/controller only | **4. Use iClone Performance** | Recreates generated clips/controller; can overwrite custom animation setup |
| Diagnose rig mapping | **MRDemo/Rig Report** | Prints bone/blendshape information |

Windows placeholder speech command (run from the project root in Windows PowerShell):

```powershell
powershell -NoProfile -File .\tools\make_voice_lines.ps1
# Optional installed voice:
powershell -NoProfile -File .\tools\make_voice_lines.ps1 -Voice "Microsoft David Desktop"
```

The script reports installed voices. German voices require a separately installed Windows speech language pack. There is no `make_voice_lines.sh` in this project. If Windows blocks a downloaded script, review it and follow your organization's execution-policy procedure.

Rhubarb's executable **and** `tools/rhubarb/res/` models are supplied through LFS. If unavailable, retrieve the complete platform distribution rather than copying only the executable. Unity's 3c generation falls back to spelling-based cues if Rhubarb cannot run; use 3d afterwards to replace those cues. The PowerShell cue script prints completion even if Rhubarb fails, so inspect its errors and the generated JSON before assigning it.

Commit generated WAVs, JSON cue tracks, text stamps, calibration assets and their `.meta` files whenever those outputs change. Do not recalibrate just to reproduce the supplied profile.

## Quest deployment

In Unity 2022 use **File → Build Settings**, select Android and switch platform. SampleScene is already enabled in the build settings. Use Meta's Project Setup Tool to review remaining Android requirements for the restored SDK; do not upgrade packages or apply unrelated changes just to open the project. Ensure headset development access, room Space Setup, scene permission, passthrough and MRUK QR tracking are configured. QR/device behavior needs testing on the target headset; Editor success alone does not establish it.

## Repository layout and version control

```text
Assets/Scenes/             SampleScene
Assets/Scripts/            Avatar, room, speech and live-viseme code
Assets/Editor/             MRDemo setup/calibration menus and test-sentence Inspector
Assets/Animation/          Generated neutral/talk/walk clips and controller
Assets/Audio/Voice/        Supplied LineNN WAV, JSON and text stamps
Assets/LipSync/            Einstein live calibration profile
Assets/Resources/          Local ElevenLabs settings; asset intentionally ignored
Packages/                 Manifest, lockfile and embedded uLipSync package
ProjectSettings/          Shared Unity settings
tools/                    Windows voice/cue scripts, Rhubarb and Blender source
```

Track `Assets` (except the private settings asset), their `.meta` files, `ProjectSettings`, package manifests, **the embedded uLipSync runtime/editor files, profiles, metadata and license (excluding `Samples~/`)**, and tools. Do not ignore all of `Packages`. Unity caches/build outputs, personal IDE files and credentials stay ignored. `.env.example` is safe to commit only while it contains placeholders.

The FBX and Blender source are already tracked with Git LFS, as are many textures and Rhubarb files. Keep `.gitattributes` and LFS installed. `Einstein_Talk.anim` is currently ordinary Git at about 95 MB, close to GitHub's per-file limit; inspect size before committing regenerated clips. LFS history migration, if needed later, must be coordinated with collaborators.

Before handing off changes, commit the README, ignore/template/checker changes and newly unignored `Packages/com.hecomi.ulipsync/`, then push the commit and its LFS objects. A local ignore-rule fix does not upload the package. No cache folder or local IDE project should be sent manually.

## Known limits

Room portals do not yet handle foreground-person/hand occlusion, doors/windows or furniture occlusion. Placement is session-local without a persistent spatial anchor. Live audio classification remains experimental as described above.

The optional uLipSync `Samples~/` directory is intentionally ignored: 1,462 demo files (about 279 MB) are unnecessary for Einstein. The package manifest omits sample registrations, so a fresh checkout does not advertise missing sample imports. The retained package contains 126 files (about 350 KB). Upstream package updates may restore sample registrations; preserve this project-specific omission.
