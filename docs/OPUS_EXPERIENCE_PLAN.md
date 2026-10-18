# Einstein experience plan — Opus 5.5, max effort

Completed 18 October 2026. This is independent product advice followed by one
focused feasibility correction. The original and final API outputs are preserved
verbatim in [the evidence bundle](../evidence/2026-10-18-opus-experience-plan/).
No runtime code, deployment, model, voice, permissions, quota or spending setting
changed while preparing this plan.

Opus received the original mission, direct user feedback, current source and
protocol contracts, prior design, full test prompts/results, actual screenshots
and the independent timing audit. It chose its own live browser actions. The
newly authorized voice attempt failed in local audio preparation before an
established provider session; it produced no audio recording. The earlier full
functional protocol and its recordings remain valid in their explicit scope.
The latest fresh startup failure is unresolved, so broader conversation readiness
is now unverified. Opus cannot hear audio from its text/image inputs.

The consultation's conservative API-usage estimate is **USD1.52**, including the
final correction; this prices cache reads at full input rate and is not an owner
billing statement. One HTTP400 request caused by an advisory budget below the
provider's documented minimum was retained and corrected before the final call.
The app's **USD75 monthly cap and automatic reload OFF remain unchanged**.
No current balance or exact bill was read.

Implementation notes from Codex:

- Treat the quiet gate as an experiment. It cannot prove which turn an untagged
  waveform belongs to, and can suppress legitimate speech. Never relabel ambiguous
  audio as current merely by attaching a local ID.
- Preserve the saved voice's original design description. The current
  [custom-voice contract](https://developers.openai.com/api/docs/guides/custom-voices)
  requires it for performance; this prompt-generated voice cannot simply move to
  TTS or Realtime unchanged. The
  [Live playback contract](https://developers.openai.com/api/docs/guides/live-conversations)
  separates transcript timing from waveform playback.
- The example script is a design target. Generate actual source explanations
  from inspected evidence; guard failures can route to an existing trace or the
  monitor/interpreter, rather than always taking one hard-coded path.
- Typed answers independent of voice are proposed backend work, not a working
  fallback today. Show that option only when its real route exists and is bounded.
- Gaze is a design proposal: existing head/torso orientation works; precise eye
  targeting is not implemented. Keep the authored resting hands.
- Initial source viewing requires no inference. Sharing still requires explicit
  consent. Do not persist source files across reloads silently.

The plan below is Opus's final corrected output, unchanged.

---

# Einstein: Corrected Final Plan, "Ask the Page"

**Status.** This is a plan only. It authorizes no new permission, cap, model, voice, provider, runtime change or live run. Codex executes later and confirms exact file locations. The provider, model and saved voice stay as they are unless a change is separately verified and approved.

**Evidence labels**
- **[F]** fresh observation from my browser session
- **[E]** supplied evidence (diagnostic, status, source, official docs, earlier harness report)
- **[H]** hypothesis
- **[T]** proposed target, not an existing SLA

---

## 0. What the fresh session shows, and what it doesn't

**Setting.** Ego Lite, an interactive Chromium browser, not headless.

**What I did and saw [F]:**
1. The landing page was calm and the avatar was ready.
2. I opened the TraceMonkey PDF. It stayed on page 1, labelled "Not shared with the conversation". I never clicked Discuss.
3. I typed a question that called it "the figure page" and asked about the Figure 2 state diagram, which is on page 2.
4. After about 21.7 s the status still read "Connecting the approved native voice…". No caption appeared.
5. I pressed Stop at about 50.5 s.
6. The UI then showed: "Audio could not start in this browser. Reload the page or try another browser."

**Post-Stop diagnostic [E]:**
- AudioContext was `running`, `hasStreamNode` false, `hasAudioFace` true, visibility `visible`.
- `nativeConversationId` null, input and output bytes 0, `recordedParts` 0.
- Events: `teaching_local_cancel` and `source_revoked(kind: video)`.

**Visitor-cookie status GET [E]:** HTTP 200, `last_session` null, `active` false, room 0, cap 75 unchanged.

**Source [E].** `native-audio.start` awaits `player.activate` and `prepareNative` under a 20 s timeout *before* calling `/api/native/permit`.

**What this means:**
- The error string comes from that pre-permit audio-preparation phase. No provider session was established or recorded.
- I therefore assert **no** billable usage, **no** provider outage and **no** universal root cause.
- Why the worklet preparation never completed (no stream node) is **unproved**.
- `source_revoked(video)` is internal generic cleanup. It is not a user-visible phantom video and not a high-impact defect. At most, rename or quiet it in logs.

**Product lessons that do follow:**
1. **A typed question waited on voice preparation.** The typed fallback currently still starts native voice [E]. For about 20 s a typed question received nothing useful.
2. **The waiting state didn't name its phase.** "Connecting the approved native voice" was shown while the app was really still preparing local audio, before any permit or provider phase.
3. **The final error gave no next step.** It does belong to the audio phase, but it offers no way forward other than reloading.
4. **Material context is ambiguous to a newcomer.** I described a page I wasn't on and never shared. Existing code already syncs approved visible pages and revisions and cancels stale teaching [E]. So this is a discoverability and affordance problem, not proof that syncing is missing.

**Earlier harness findings [E]:**
- The old first-answer gate accepted "Hello!" or an "I'll do that" acknowledgement as an answer.
- Narration crossed into the next prompt.
- The first rendered signal arrived after 13–19 s.
- The owner rejected both the accent and the cadence. I heard no audio in this session and judge neither.

---

## 1. North star

**What you're looking at, once you've chosen to share it, is what Einstein talks about.** He shows that he is looking. He answers the actual question quickly, takes visible time only when the question is hard, and draws on the original as he explains. He says what the source shows versus what he infers. He stops cleanly when interrupted. A typed question never waits on voice.

---

## 2. Grounded 75-second exemplar

All timings are **[T]**. The content uses only the established Figure 2 behaviour on page 2: the trace monitor's states, guards, side exits, and hot exits leading to branch traces.

| t | Visitor / Einstein | What the visitor sees |
|---|---|---|
| 0 | Opens the PDF, turns to p.2. | The page is shown readably. A persistent context chip reads "p.2 · not shared". |
| 3 | Clicks the chip. | Inline one-time consent: "Let Einstein see the pages you show from this document?" The visitor accepts. The chip changes to "Einstein sees p.2". |
| 5 | Drags a box around Figure 2 (an explicit selection; no auto-crop promise). Asks: "What happens here when a type changes inside a hot loop?" | The question bubble shows "about p.2 · your selection". The status reads "Looking at your selection". |
| ≤6 | "Let's follow the loop around the diagram." | The first mark appears on the monitoring/recording states. |
| ~12 | "Once a loop runs hot, it's recorded and compiled into a trace. That trace assumes what it saw, and guards check those assumptions as it runs." | A mark moves along record → compile → execute. |
| ~18 | "If a value's type no longer matches, a guard fails and execution leaves through a side exit…" | The side-exit edge is marked. |
| ~21 | Visitor interrupts: "So it just gives up?" | Ink freezes and the queued audio stops [T ≤300 ms after the interrupt is detected locally]. |
| ~23 | "Not quite. Control returns to the interpreter. If that same exit keeps firing and gets hot, the monitor records a branch trace from there and attaches it." | The hot-exit → branch-trace path is marked. |
| ~35 | "Is that design actually a good idea overall?" | The status reads "Checking the paper's evidence". A short spoken holding line, once. |
| ~50 | **Conditional on inspection.** "The paper argues [claim as returned], and it reports [result] at [exact returned location, e.g. p.⟨n⟩, Table/Figure ⟨x⟩]. Where its evidence is weaker: [only if found]." If nothing is found: "I can explain the design's intent, but I haven't found where the paper measures that. Shall I look further?" | The view navigates to the returned location and outlines it. Inferences are visibly marked "my reading", not "source". |
| ~70 | "Show me the source." | The bare original appears, with only the cited region outlined. |

No page number, benchmark or weakness is spoken unless evidence inspection returned it. My earlier "weak on branch-heavy code, p.11" example was unverified and is withdrawn.

---

## 3. Product behaviour

### 3.1 Composition and legibility
- With material open, the source takes the dominant area. Einstein moves to a side or corner presence and never covers marks.
- Captions sit beside the source, not over it.
- Marks are high-contrast and few, and the previous step fades when a new one begins.
- The bare original is always one action away.

### 3.2 Material entry
- One "Bring material" entry handles PDF, slides and video. The source appears locally at once, before any voice phase.
- A persistent **context chip** states the truth: "not shared", "Einstein sees p.2", or "Einstein sees your selection".
- The chip is the consent affordance. Consent is explicit, one-time per document and revocable from the chip.
- An unshared document is never sent silently.
- If a question uses deictic words ("this figure", "this page") while nothing is shared, the reply is a clarification plus the consent offer. It is not a guess.

### 3.3 Region selection
- Selection is explicit: drag a box, or tap a figure hit-area only if a local layout heuristic has been separately validated.
- No promise of instantly locating an unseen figure.

### 3.4 Mobile and keyboard
- Mobile: the source is full-width, with captions in a bottom sheet, the chip pinned and large touch targets.
- Keyboard: typing is available immediately; Enter sends; Esc interrupts (it freezes ink and stops queued audio); arrow keys turn pages; a documented shortcut toggles captions.
- Visible focus states throughout.

### 3.5 Captions and listening
- Captions are on by default when voice is active.
- A listening indicator shows only when the microphone is truly open.
- "Thinking" and "Looking" states are distinct from "speaking".

### 3.6 Error and phase states
Phases are named honestly: **Preparing audio → Requesting permission → Connecting voice host → Voice ready.**
- Each phase has its own copy and its own way out.
- After the audio phase times out: "Voice audio didn't start on this device. You can keep reading and typing, or retry audio."
- No "reload" as the only exit.

### 3.7 Clarification, correction and uncertainty
- **Clarify** only when the referent or the goal is genuinely ambiguous.
- **Accept corrections** explicitly ("You're right, that's the side exit, not the loop edge") and update the marks.
- **Separate three kinds of statement:** what the source shows, what Einstein infers, and what he didn't find.
- **Confidence wording is a style choice, not calibrated truth.**

### 3.8 Natural communication
- Adaptive, connected phrasing whose length follows the question.
- No word-count quotas and no repeated catchphrases (no reflexive "nein").
- Follow-ups only when they are actually useful.

### 3.9 Progressive papers, slides and video
- Papers and slides: the question carries the shared visible page or selection and its revision.
- Video: the shared paused frame plus its timestamp.
- Explanations build step by step, each step tied to a mark.

### 3.10 Believable presence
- Keep the current resting hands and the head/torso orientation toward the source or the visitor.
- Gaze goes to the mark being drawn.
- Stillness while listening is preferable to busy motion.

---

## 4. Feasible architecture choices

### 4.1 Turn ownership (the critical correction)

**Contract facts [E]:**
- Live `session.output_audio.delta` carries no turn/response ID, no timing and no completion marker.
- Official docs (live-conversations, voice-websockets) confirm untimed output with no output-done event.
- `openai_live.py` emits that audio into the client's current generation.
- `native.sendText` already cancels teaching and resets the playback epoch.

**Consequences:**
- A local `turn_id` cannot identify old audio that arrives late on the same continuous session.
- Tagging such audio with the current ID would launder stale audio as fresh.
- Zero stale milliseconds can be neither guaranteed nor fully measured.

**What app IDs *can* protect:**
- owned tool and delegation calls
- commentary injections
- teaching steps
- control messages
- audio already queued on the client before an epoch reset

**Bounded, conservative workaround [H, to be decided in P1]:**
- After a new turn or interrupt, keep the epoch reset as today.
- Then hold incoming deltas behind a **quiet gate**: accept new playback only after a continuous no-delta gap of length Q, or once the app has issued the new turn's request and the gap is observed (Q chosen from the repro data).
- Count held audio as **unattributable-suppressed**, not "stale". Count audio arriving after the gate as **accepted-ambiguous**.
- The cost is real. The gate may clip or delay legitimate fresh audio, and that delay is reported alongside it.

**If the quality bar can't be met:**
- Write a proposed alternative: a turn-based route with response-level events, and what it would cost.
- Prompt-generated voices currently work only with GPT-Live, so an alternative **cannot keep this exact saved voice**.
- Any alternative is a verified, approved tradeoff and needs human listening.
- No provider flush, cancel or completion API is assumed.

### 4.2 Startup
- **Show useful local reading before voice.** The source and typed input are usable before 3D or audio finish. Showing a static frame from the existing character asset while it streams is optional.
- **Keep audio preparation as it is,** with its timeout before the permit.
- **Add phase telemetry:** activate start/end, `prepareNative` start/end, worklet/stream-node creation, permit, host, provider. The goal is to locate the unproved worklet stall.

### 4.3 Voice-independent typed route (implementation proposal)
- Today's typed fallback still starts native voice [E].
- **Proposal:** typed questions go through the approved server Responses capability, with bounded per-turn and per-session budgets inside the existing cap. The answer is rendered as text plus marks, and voice is optional and separate.
- This is a new implementation, not an existing fallback and not a UI-only fix.

### 4.4 Reasoning
**Current reality [E]:** multi-call delegation plus specialist vision, evidence and teaching calls. It is not one low-effort call.

**Proposals [H]:**
- **No new classifier API call.** Improve the existing decision point and prompt so routing decides among three cases:
  - answer from verified session evidence;
  - inspect the view;
  - gather evidence across the paper.
- **Deterministic invalidation.** A page change, revision change, new selection or revoked consent invalidates cached evidence. Otherwise verified evidence is reused.
- **Keep two failure modes apart.** *Difficult reasoning* may justify higher effort. *Missing source evidence* calls for a search, or for saying "not found".
- **Effort level.** A higher effort for the evidence-and-judgement path, under the same money cap, is a **proposed configuration experiment**, not a permission expansion.
- Caps, such as the number of deep calls per session, are proposals.

### 4.5 Voice instructions
- **Keep the saved voice's original description in `session.instructions`.** The official custom-voices docs (checked 18 Oct) say to include it.
- **Never mutate the pinned voice's design text.**
- **The "Neutral accent / approximately 60s" prefix** versus the stronger elderly-German direction is a *possible* conflict, not an observed cause.
- **Delivery work** happens only in the additional direction text in `voice_direction.py`: connected thoughts, natural tempo, no clipping "be brief" rules.

---

## 5. Priority order, module paths and dependencies

Paths are as previously referenced. Codex confirms them.

### P0. Measurement honesty (`qa/public-acceptance/`)
- Define three signals:
  - **useful content onset**: the first rendered playback whose transcript meets prompt-specific gates (named entities or values);
  - **first visible action**: the first mark or navigation;
  - **acknowledgement onset**, kept separate from both.
- Transcript timestamps alone cannot prove audible word alignment, so these are reported as approximate.
- Re-score the old first-answer gate as **insufficient** in a new annex. The original full report stays immutable, and its bounded pass stays unchanged.
- **Depends on:** nothing. **Blocks:** P1, P4, P5.

### P1. Turn-ownership feasibility decision and repro (`openai_live.py`, `native_live.py`, `native-audio.js`, `speech-player.js`, `teaching-sequence.js`, `teaching_runtime.py`)
- Analyse existing session logs and recordings, and the delta timing around `sendText`/epoch resets. Produce a known vs unattributable classification.
- Implement the quiet-gate workaround behind a flag, and measure its suppression and delay tradeoff.
- A provider-free replay with labelled synthetic late chunks verifies gate logic **only for those labelled cases**. It proves nothing about isolating arbitrary real late audio.
- **Decision output:** adopt the gate, tune it, or write the approved-tradeoff alternative proposal.
- **Depends on:** P0.

### P2. Honest startup phases and local-first reading (`native-audio.js`, `main.js`, `scene.js`, `index.html`)
- Phase-specific states and copy, phase telemetry, and source plus typing usable before audio.
- Optionally, a static frame from the existing asset while 3D loads.
- **Depends on:** nothing. Can run in parallel with P0.

### P3. Context affordance (`paper-workspace.js`, `main.js`)
- Context chip, inline consent, explicit region selection, and a deictic-question clarification.
- **Inspect and improve the existing approved-page and revision sync; do not rebuild it.**
- **Depends on:** nothing.

### P4. Voice-independent typed route, proposal then implementation (`main.js`, server delegation in `native_live.py` or an equivalent server module)
- Uses the approved Responses capability, with bounded budgets and an explicit failure route.
- **Depends on:** P0, P2. **Needs:** approval of the budget numbers.

### P5. Reasoning routing and evidence (`native_live.py`, `page_vision.py`, `teaching_steps.py`)
- Decision-point prompt changes, deterministic invalidation, evidence reuse, source/inference/not-found labelling and citations to returned locations.
- The effort change runs only as an approved configuration experiment.
- **Depends on:** P0, P3.

### P6. Voice delivery and listening gate (`voice_direction.py`)
- Direction-text changes only.
- Human blind listening on three fixed clips: figure explanation, reply after an interrupt, judgement answer. Scored 1–5 for accent, age, naturalness and warmth.
- **[T]** Accept at accent ≥4 and naturalness ≥4. Stop after three rounds and escalate as a tradeoff proposal.
- **Depends on:** P1 (clean clips).

### P7. Recovery (`main.js`, `paper-workspace.js`, `native-audio.js`)
- After a reload, the source file objects are gone. Show "Re-select your document to continue". No silent persistence and no automatic paid reconnect.
- Network loss and provider loss lead to an honest state and a manual retry.
- Retaining the PDF across reloads would require a new storage and retention decision.

---

## 6. Acceptance criteria [T]

**Startup**
- Source readable and typing enabled ≤5 s after load.
- Phase shown within 1 s of any phase change.
- An audio-phase failure always offers typing and retry.

**Typed route (after P4)**
- Prompt-specific useful text ≤6 s at the median, inside budget.
- A budget or provider failure shows an explicit message, never a silent hang.

**Context**
- With consent, "explain this" resolves to the shared visible page or selection in 10/10 local scripted runs.
- Without consent, 10/10 runs give a clarification plus the consent offer, with zero sends.

**Interruption**
- Local ink freeze and queued-audio stop ≤300 ms after local detection.
- Unattributable-suppressed ms and accepted-ambiguous ms are reported, with no claim of zero stale audio.

**Reasoning**
- Every source claim maps to a returned location.
- Unsupported judgements are labelled inference or "not found".
- Useful content onset reported separately from acknowledgements.

**Voice**
- Owner's listening gate as in P6.

---

## 7. Cost-bounded validation

**Free:**
- P0 re-scoring of existing data.
- P1 log analysis and labelled synthetic replay.
- P2 and P3 local browser checks (interactive Chromium plus one mobile viewport).
- P4 mocked-provider tests.

Local replay results and human listening are different evidence and are reported separately.

**Paid:**
- **None now.** After P0–P5 land, request fresh authorization for **one** scripted session of about 5 minutes: figure question, interrupt, judgement question, show source, Stop.
- Plus the owner's listening rounds.
- No dozens of repeated runs.

**Hypotheses and how to disprove them:**

| Hypothesis | Disproving check |
|---|---|
| The fresh stall lies in worklet/stream-node preparation | Phase telemetry shows `prepareNative` completing on a stalled attempt |
| A quiet gate removes audible cross-turn bleed at an acceptable delay | Repro or human review still finds bleed, or gate delay exceeds the useful-onset target |
| Better affordance fixes context ambiguity | Scripted newcomer runs still ask about unshared pages without seeing the chip |
| Decision-point routing keeps ordinary turns fast | Median useful onset misses its target with no new call added |
| Delivery is fixable by direction text alone | The listening gate fails after three rounds |

None of this counts as "magical" until real people have used it and said so.
