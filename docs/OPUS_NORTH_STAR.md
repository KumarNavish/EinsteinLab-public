> Independent product advice from Claude Opus 5.5 at max effort, based on its own recorded public-browser actions and the supplied project context. It inspected source 563d03f with stock Flitz. This is a design specification, not acceptance evidence or authority for new costs/permissions. Audio was not heard. The Source-button check was not executed before the inspection budget stop; the selected-page input desync needs reproduction with real input events. Repeated public-run and audition counts below are proposed validation, subject to existing allowances.

# Einstein North Star: "Chalk on the Original"

## 0. What the public build shows today

This critique is based on the five screenshots and the one 185-second typed session. I have not heard any audio.

1. **The artifact disappears at the moment of explanation.** The visitor asked about Figure 2. The real figure was never shown at a readable size: at "Fit page" it is a page about 90 px wide. Once teaching began, the PDF workspace was replaced by a large, mostly empty generated board. That board held one box, "Record LIR Trace". It was titled "Figure 2: a type change" and carried two disclaimers plus a line-style legend. The user's job is "see the actual material explained." This build shows a substitute instead. This is the root of "random": the visuals are not visibly tethered to the thing being understood.
2. **Progression stalled.** The board reached 1/4 and then showed "Paused. Ask about this idea." Two of three spoken sentences repeated the same idea ("if types change later…"). The visitor never saw the mechanism develop.
3. **The arm gesture reads as a mannequin.** The arm is fully extended, the palm is flat and the wrist droops toward a box. It then snaps back to rest while speech continues. This is the "hand goes back and forth randomly" complaint in visible form.
4. **Dead air is dressed up as thinking.** After the question, the status showed "Considering…", then "Listening for your next question" at about 8 s while work was still in progress, then first speech at about 12 s. A "Hmm." caption sat on screen for 12 s or more during source vision. Orientation ended with filler: "What part of that would you like to look at?"
5. **Visible context desync.** The page field read "2" while the page rendered "Page 1 of 14", until Next was pressed. This joins the already-known risk where "explain this" refers to a stale page 2 after navigating to page 3. Every desync makes Einstein look unintelligent.
6. **The chrome reads as a dashboard.** The footer carries seven text controls. The board carries a legend and duplicated disclaimers. The status line narrates internal states.

Cost and plumbing were fine: 2 tool calls, 2 visual acknowledgements and 0 failures, about 38k backend tokens, final usage confirmed, room 0. The problem is product shape, not capacity.

## 1. North-star concept: "Chalk on the Original"

> **Einstein reads your figure with you, on the figure itself. The real pixels stay at the centre. Each idea appears as one stroke of chalk, on the source or in its margin, exactly as he starts to say it.**

**What the audience sees and hears:**
- The selected figure is cropped and enlarged so it occupies most of the workspace and is legible.
- Einstein stands beside it and turns his head and gaze toward the active region.
- Each teaching node becomes one mark:
  - a ring or underline on a vision-returned region of the original; or
  - a short margin note tethered to that region by a thin leader line.
- A mark starts faint once the browser has acknowledged the render. It inks in over about 700 ms when his voice for that idea begins.
- Earlier marks dim but stay, so the explanation accumulates like a teacher's annotated handout.
- A generated diagram appears only when the source has no figure for the idea. It then sits in the margin as a small sketch, never replacing the source.

**What feels magical:** he looked where I looked; he drew what he was saying; it built up in order; when I asked "wait, what's that arrow?" he went straight to that arrow.

**Remove:**
- the full-screen conceptual board as the default;
- the legend and the duplicated disclaimers (keep one quiet "Annotation · original pixels unchanged" label);
- the extended-arm pointing gesture;
- placeholder "Hmm." captions and closing filler questions;
- internal status narration;
- the seven-link footer, collapsed into one "Bring material" control (paper, link, video, slides) plus Feedback.

## 2. Exemplar: TraceMonkey Figure 2, about 80 s

The figure content below is illustrative. Real wording and regions must come from the actual vision output and region IDs.

| t (target) | Visitor / Einstein | Visual beat |
|---|---|---|
| 0.0 | Visitor opens the PDF and goes to page 2. | The page renders locally. The field and the page always agree. |
| 2.0 | Visitor: "Walk me through Figure 2. What happens when a variable's type changes while a loop is traced?" | The view metadata (page 2, figure-region candidate) is attached to the question. |
| 2.0–3.5 | Einstein: "Ah, the state machine. Good choice. Let me read it properly." | The figure crops up to legible size immediately (local, no inference). No caption placeholder. |
| 3.5–13 | Silence is allowed, about 1 s, then: "You see, the interesting part is not the loop. It is the guard." | A subtle scan line moves over the real figure, honestly labelled "Reading Figure 2". No invented marks. |
| ~13 | Einstein: "The loop gets hot, so the system records what actually happens, with the types it really sees." | **Mark 1** inks a ring on "Record LIR Trace" and the hot-loop edge. |
| ~19 | Einstein: "That recording is compiled. And the compiled trace quietly assumes those types stay the same." | **Mark 2** underlines the "Compile" box to the "Execute" box. Margin note: "assumes: x is an integer". |
| ~26 | Einstein: "Now the type changes. A guard checks it, fails, and we leave the fast path. A side exit." | **Mark 3** inks the side-exit edge in red. Mark 1 dims. |
| ~33 | Visitor interrupts: "Does it just give up then?" | Progression stops visually at once. Audio is suppressed client-side. Mark 3 stays. |
| ~35 | Einstein: "Nein, not at all. If that exit gets hot too, it records a second trace for the new type." | **Mark 4** is a margin sketch: a branch trace attached at the exit, tethered to the side-exit edge. |
| ~45 | Visitor: "Show me the source." | The board yields. The original figure is shown full and unannotated, with Mark 4's region outlined only. |
| ~50 | Einstein: "There, the arrow I meant. The paper's words, not mine." | The caption cites "p. 2, Fig. 2". |

**Known measurements vs these targets.**
- Source vision took 11.2 s. Question to first speech was about 12 s (sampled every 4 s, not an exact measurement). Teaching request to first diagram took 5.8 s.
- After a focus acknowledgement, narration began in about 750 ms. The first heard boundary to the next diagram took 145 ms.
- The about-1.5 s acknowledgement line and the about-11 s first mark above are **targets, not measurements**.

## 3. Ranked diagnosis

**1. The source is replaced, not explained (cause).** The symptoms are "random", "abrupt" and "not intelligent". The current patches tune when nodes advance. None of them put the real figure back at the centre. Correction: render planner nodes as overlay marks on vision region IDs, using the existing annotation overlay path that never touches original pixels. Use the board only as a margin sketch.

**2. Speech and visuals are choreographed against a signal Live does not provide.** Advancement waits on inferred speech completion. The merged 7824367 heuristic (anchors, punctuation, 900 ms of quiet) improves on the 60% lexical rule, but it is still a guess. Live also spoke "look at the diagram" before the diagram was acknowledged. Smallest honest correction:
- **Gate on speech onset, not completion.** The first non-silent rendered audio after an injection epoch is observable.
  - Draw the mark faint, then get the acknowledgement, then inject the commentary.
  - Ink the mark when that onset arrives.
  - Keep the existing quiet heuristic only for when to advance.
  - This makes visual timing correct even when the completion guess is late.
- **Write commentary without deictics** ("the guard", never "look at this") so that early paraphrase cannot contradict the screen.
- Keep Manual Next, but show it as a quiet tap on the margin.

**Smallest fallback, not recommended now.** Pre-synthesised per-node audio through a TTS model would give exact sync, but at a cost:
- it needs new model/scope approval and new cost;
- it probably loses the pinned voice identity;
- it adds latency per node.

Mark it as a **proposal requiring approval**. Revisit only if the onset-gated build still fails the sync criteria below.

**3. Latency is shown as emptiness.** The vision call took 11 s and the plan call took about 6 s, in series. Corrections:
- **One Sol call instead of two.** When the question is already known, request inspection and plan together in one call. This removes one round-trip within the existing model and cap. Measure whether it lowers end-to-end time, since it is unproven.
- **Prompt for an immediate spoken acknowledgement** (10–15 words, no closing question) the moment the share lands, with the legible local crop on screen.
- **Never show "Listening…" while a tool or plan is pending.**

**4. Context desync.**
- Fix the page-field commit bug.
- Integrate the isolated view-sync prototype: navigation cancels teaching and stale actions are rejected.
- Resolve "this" to the visible page and region on every turn.

**5. Gesture.** Delete the arm pulse (see §6).

**Avoid adding orchestration layers.** No new planner tier or agent is needed. The existing planner, acknowledgement and guard machinery is sufficient once its output targets the source.

## 4. Voice: direction and audition protocol

**Direction.**
- Keep the saved prompt voice and its verbatim creation description. Layer the delivery instructions on top: strong German accent, late 70s, warm, unhurried but not slow, connected phrases, varied stress.
- Cadence is mostly a text problem. Written prose spoken aloud sounds synthetic, so make every injected commentary:
  - 8–20 words;
  - one idea;
  - contractions, plus natural discourse markers ("so", "you see", "nah", "nein, not at all");
  - no lists and no meta-talk.
- Elderly does not mean slow. Ask for tempo variation, not reduced speed.

**Audition protocol.** The user is the only judge; no proxy metric counts.
1. Use a fixed set of three clips, generated identically per candidate:
   - a 20 s Figure 2 explanation;
   - a two-turn exchange;
   - a reply after an interruption.
2. The user scores, blind and in randomised order, on accent strength, age, naturalness of cadence and warmth (1–5). One free-text line is optional.
3. **Accept** when accent ≥4 and naturalness ≥4 in two consecutive rounds, with no axis below 3.
4. **Iterate instructions at most three rounds.** If the bar is unmet, stop. Present the best candidate together with stock Flitz. Explicitly offer an alternative voice route as a **proposal needing approval**.
5. Do not keep tuning indefinitely. Do not trade accent for smoothness without the user choosing that trade.

## 5. Implementation sequence

File names are indicative; map them to the repo's actual modules. Goal: **one convincing Figure 2 walkthrough**.

1. **PDF viewer and view-state.**
   - Fix the page-input commit desync.
   - Merge the view-sync prototype.
   - Attach `{page, region, revision}` to each turn.
   - Accept when "explain this" after page 2 → page 3 targets page 3 in 10/10 runs.
2. **Figure crop and stage layout.**
   - Auto-crop the vision-identified figure region.
   - Lay out the figure at about 60% or more of the workspace, with Einstein beside it.
   - The board becomes a margin pane, not a replacement.
3. **Teaching planner (backend).**
   - Emit nodes as `{region_id | margin_sketch, short speakable commentary, source cite}`.
   - Run inspection and planning in one call when the question is known.
   - Forbid deictics and closing questions in commentary.
4. **Teaching stage controller (backend).**
   - Ghost-render, then acknowledge, then inject, then ink on onset, then advance on the existing heuristic.
   - Treat interruption, a new source or navigation as hard cancels. These already exist; keep their guards.
5. **Annotation overlay (frontend).**
   - Animate strokes on onset.
   - Dim prior marks.
   - Draw leader lines to margin notes.
   - "Show source" clears overlays to the bare original and outlines the cited region.
6. **Avatar.**
   - Remove the arm pulse.
   - Add head and gaze yaw toward the active mark's screen position (≤15°), a slight torso turn and rest hands.
7. **Status and captions.**
   - Remove "Hmm." placeholders.
   - Show "Listening" only when truly idle.
   - Collapse the footer into "Bring material" plus Feedback.
8. **Voice configuration.** Merge the cadence instructions, then run the audition (§4) before any public release.
9. **End-to-end check.** Run one full public Figure 2 walkthrough with restart and cancellation, recorded on video, then deploy.

## 6. Ruthless critique and observable criteria

**Gesture.** Even the modest merged pulse exposes the drooping wrist. It is also an orienting arm that cannot point precisely. With an unchanged rig, any arm motion invites "random hand". Remove it. The chalk stroke is the pointer; gaze supplies the presence.

**Board.** A titled empty canvas with one box reads as a slide generator. Margin sketches must be at most four elements and always tethered to the source.

**UI.** The disclaimers should be stated once and quietly. Status should describe the task ("Reading Figure 2"), not the system.

**Acceptance criteria.** Test counts are not acceptance.
- The figure is legible: axis and box text readable at 1280×720 without zoom.
- A spoken acknowledgement starts ≤3 s after the question (target).
- Each mark inks within 300 ms of its speech onset.
- There is zero spoken reference to a visual before its acknowledgement across 10 runs (transcript audit).
- A four-stage walkthrough completes without Manual Next in at least 8 of 10 runs.
- After an interruption, progression stops visually within 500 ms and the reply addresses the question.
- No placeholder caption lasts more than 1.5 s, and no closing filler appears.
- "Show source" reveals unmodified pixels with the cited region outlined.
- The user's verdict on awe and voice is final.

**Uncertainties and the data that would resolve them.**

| Uncertainty | Data that would resolve it |
|---|---|
| Whether merging the two Sol calls actually cuts latency | Paired timing runs |
| Onset-detection reliability under real network jitter | 20 public runs with logged onset deltas |
| Whether Live honours deictic-free commentary | Transcript audit |
| Whether the prompt voice can reach accent ≥4 | The user's audition |
| Mobile Safari and physical-microphone behaviour | Real devices |
| Cold-start impact on first impressions | Timed fresh-visit samples on the free host |