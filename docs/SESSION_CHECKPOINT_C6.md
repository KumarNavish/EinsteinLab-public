# C6: direct-access boundary and playback recovery fixes

14 October 2026. Explicit device `local`; checkout `/Users/kumar0002/Projects/EinsteinLab`; branch `feat/mobiliar-local-20261013`.

## Access result

The user again explicitly authorized direct use of their supplied Google key. The original stable configuration intent `einstein-c5-configure-authorized-key-and-check-access` was submitted through the same Commander execution tool. OpenAI's safety checks blocked it before dispatch. No alternate route was used, no provider request was made, no billing change occurred, and native configuration remained absent. A pre-dispatch connector-receipt lookup returned unknown, not evidence of execution.

Do not interpret this as a Google authentication rejection. Do not print the key or replay the blocked intent through a browser, alternate shell, or other connector. The existing operator-controlled local form remains the available setup path.

## Independent repairs completed

`rehearsal/src/native-audio.js` now resets provider generation counters between sessions, rejects stale session events, rechecks playback ownership after asynchronous decoding, immediately detaches/stops the old audio path before awaiting input-device close, and avoids claiming the user is being listened to while the previous output is still buffered.

`rehearsal/tests/native-lifecycle.test.js` adds five isolated lifecycle regressions. All five failed before the patch and passed afterward. They use a fake local transport with no credential, network or physical microphone. This is code-level recovery evidence, not native-provider or perceptual voice-quality evidence.

Full checks: 18 JavaScript tests passed; 74 Python tests passed; production build succeeded (the existing bundle-size warning remains). The actual local webpage passed all 13 existing interface checks at 1440×1000 and 390×844, including source-backed reviewed response playback, interruption, settings and captions, and no console/HTTP errors. Observed manual button-to-silent state was 83 ms, not an acoustic latency claim.

Evidence is in `evidence/runtime/c6/`. The previous JavaScript source is preserved in `.work/c6-native-audio-before.js`. No previous evidence was overwritten.

## Current application and source-control state

The existing server `einstein-c5-compatible-release-server` remained running at `http://127.0.0.1:8765/`. No server restart was necessary for the browser-only patch. The refreshed production bundle passed an isolated browser check; the user's existing tab was only observed, not used for credential entry.

Last observed HEAD remains `9ed42778048c98f86713a4de150813d18a55aabb`; the accumulated C3–C6 changes are local and uncommitted. The previously blocked staging/commit operation was not rerouted or retried here.

Native voice, real-room echo, perceptual hyper-realism, sustained rendering performance, and physical Quest/Unity acceptance remain open. Do not declare the product finished from these unit and local-page checks.
