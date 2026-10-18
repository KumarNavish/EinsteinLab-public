# Conversational whiteboards, articulation, and German-influenced delivery

This release extends the existing native-voice application; it does not replace the working lab reader, reasoning helpers, audio stream, or private character assets. **A conceptual whiteboard is now an actual tool-operated scene object. It is not an original figure from a paper and is not evidence that a hypothesis has been demonstrated.**

Open `http://127.0.0.1:8765/` on the prepared Mac, or run `Start Einstein.command` from the repository. Refresh an older tab to load the new client. The same existing Google key and zero-additional-spending gates remain in place.

## Ask Einstein to show his explanation

Start the conversation and ask:

> Please look up the Mobiliar Lab project on language models and cognitive load, then sketch a simple conceptual mechanism. Show uncertain causal relationships as hypotheses.

The native model chooses a real source lookup and proposes nodes and relationships. The browser creates the spatial panel, paints the graph, and acknowledges that the actual scene mesh has rendered. Only then does the backend return `displayed` to the model. Neither a plan nor a dispatched instruction counts as a completed display.

Continue naturally with **“Highlight the part representing the person,” “Simplify this to two boxes,”** or **“Put the whiteboard away.”** The first action targets an existing node or relationship. Simplification replaces the graph and preserves its conceptual label. Dismissal restores the prior camera composition.

The arm gesture is calculated from the real highlighted element's position; it is not a generic gesture clip labelled as pointing. The original body performance remains available while speaking. A target-specific head rotation was tried, failed visual inspection, and was withdrawn. **Do not claim gaze-locked eyes/head or precise fingertip contact.**

The **Read the diagram** button provides a larger, accessible view, useful on a narrow display. Long labels wrap; crowded model-supplied positions are automatically rearranged without changing nodes, relationships, labels, or scientific meaning. Solid, dotted, and dashed connections distinguish information, association, and causal hypotheses. The model-authored diagram itself is still subject to semantic review.

## Voice identity and matching previews

Settings now separate the actual native voice from **English delivery**. The new default delivery requests subtle German-influenced English. The alternative **Original voice** remains available, and both choices persist locally between sessions. A voice/delivery change applies to the next conversation, not a half-reconfigured active connection.

Algenib, Gacrux, and Sadaltager each have an actual recorded German-directed sample. **Hear this voice** plays the corresponding stored sample without opening the microphone or making a new API request. These clips were generated from identical requested text; their exact hashes and transcripts are preserved. They are synthetic interpretations, not authentic Einstein recordings. Accent authenticity, perceived age, and naturalness have not been scored by a human listening panel.

The live connection includes the same requested accent direction. Model behavior can vary between samples and spontaneous dialogue; a directive and a correct transcript are not proof of perceptual equivalence.

## Articulation and audio

The existing HeadAudio integration incorrectly treated the open /aa/ category `0` as a missing event. The integration now accepts zero explicitly without modifying the vendored distribution. A bounded audio-clock timeline smooths transitions and returns the face to rest if the classifier stops. Interrupted output clears pending articulation.

A sustained actual-browser playback test used all three German-directed voice samples, repeated over **159.63 seconds**. It observed real class-zero events, distinct open/rounded/dental poses, finite bounded weights, and mouth closure between clips. This is a stress test of recorded speech, **not** several minutes of spontaneous human conversation or a ground-truth phoneme-alignment study.

The continuous PCM stream, interruption fades, and narrow-band tone safeguard from the preceding release remain. The user's original reported beep was not conclusively captured. Passing a synthetic tone test does not establish that every headset, operating-system sound, or possible provider artifact is removed.

## What the release does not claim

No original-paper figure extraction, general document-upload reader, discovered experiment-video playback, or unrestricted machine actions are added here. Four relevant official lab pages contained no embedded videos. A publisher's known open-access image/PDF URLs returned an HTML security challenge rather than the requested media; they were not labelled as successfully read. A later official-repository fetch was blocked before execution. No captcha, paywall, permission restriction, or tool denial was bypassed, and no invented figure or unrelated video was substituted.

The prior opt-in public-search adapter is not upgraded from unverified to verified by this release. The most recent Flash availability and quota limitations remain in [RESEARCH_CAPABILITIES.md](RESEARCH_CAPABILITIES.md). A whiteboard model invocation uses the actual native model, not a falsely labelled successful Flash check.

The original CC4 character remains visibly synthetic, with noticeable hair-card limitations. Targeted head/eye gaze, human-room echo cancellation, perceptual voice realism, physical audiovisual alignment, and sustained Quest rendering remain unverified. No headset was connected and no native Unity build was produced.

## Implementation boundaries

`visual_tools.py` validates finite, bounded graph data; accepts source identifiers only after an actual source tool returns them; and commits state only after an exact browser acknowledgement. Up to eight nodes and twelve edges are supported. The tools cannot supply executable markup, arbitrary image URLs, local paths, scripts, or new network capabilities.

An action is tied to the conversation generation, action ID, and visual revision. Stale, duplicate, malformed, interrupted, or late receipts do not confirm a new display. The browser restores the previous acknowledged graph after an interrupted progressive render. A render timeout is returned as `not-displayed`, not hidden by a spoken success claim.

Each native connection now has a non-secret conversation identifier in its completion summary. Test harnesses wait for that exact identifier and an inactive state, rather than mistaking a previous conversation's summary for the current result.

## Reproduce validation

```sh
.einstein-venv/bin/python -m pytest lab_backend/tests -q
(cd rehearsal && npm test && npm run build)
# With the existing local application ready and no participant active:
(cd rehearsal && node tests/spatial-board.e2e.mjs)
(cd rehearsal && node tests/native-whiteboard.e2e.mjs)
(cd rehearsal && node tests/sustained-face.e2e.mjs)
.einstein-venv/bin/python scripts/create_visual_dialogue_fixture.py
(cd rehearsal && node tests/spoken-whiteboard.e2e.mjs)
```

The native tests use the existing approved free-tier configuration. They refuse to interrupt an active visitor. The spoken test uses locally generated questions in an isolated Chrome microphone, never a secretly captured participant. The recordings explicitly identify whether they contain only outgoing audio or both outgoing audio and the synthetic input. Set `PLAYWRIGHT_BROWSERS_PATH` to the existing `.work/playwright` directory when the local Playwright recorder requires it.

[Recorded measurements and negative cases](../evidence/2026-10-14-embodied/README.md) accompany the release. A browser render acknowledgement proves a visible action, not the correctness of every scientific interpretation displayed.
