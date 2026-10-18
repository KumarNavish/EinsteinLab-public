# Opus convergence plan — 19 October 2026

Actual `claude-opus-5-5`, max effort, reviewed the current project context, prior plan, fresh live failure, human feedback and proposed corrections. Original output follows unchanged.

Implementation notes: the regular voice path has no server `input_accepted` event; that receipt belongs to typed text mode. Preserve the existing voice `input_start`/playback state and verify the final ready state instead of inventing a text-mode receipt. Before a provider session exists, the viewer can approve local sharing permission, not claim it has shared to an active conversation. Verify local page/permission first and real sharing after connection. Response-item creation queues backend history; only a measured fresh run can rule out a repeated spoken answer. The effective appointment date is not added unless its actual returned source span establishes it. Four API calls have completed; a final evidence review remains within the bounded allocation. No listening acceptance is recorded on the owner's behalf.

# Review of the proposed patch, and final convergence plan

## Part 1. Patch review: substantive issues

The patch is directionally right. Three problems block it, and the first could create a new defect.

**B1. Possible double answer on the cached-fact path (blocker until measured).**
- `send_cached_fact` does two things: it adds a *user* message (the fact plus the question) through `response.item.create`, then speaks the answer through `session.commentary.append`.
- No evidence shows whether the Live voice model also answers that user item on its own.
- If it does, the visitor hears the answer twice, or hears the fact followed by a paraphrase. That is the echo failure again in a new form.
- The unit tests mock the session, so they cannot detect this.
- **Correction:** in session 2, count the occurrences of "Ollier" in the rendered transcript between submit and quiet. Exactly one occurrence passes. Two or more fails.
- **Contingency:** if it fails, send the fact as a non-user context item, or send the user item only *after* playback quiet.

**B2. The client state after `continue` is unverified.**
- The fast path skips the normal flow. That flow may include accept or status events the UI uses to leave "thinking".
- **Correction:** emit the same accept event the typed path emits, and add one test that asserts the UI-facing events arrive in the same order as on the normal path.

**B3. The spoken wording breaks the voice direction.**
- The current answer reads: "The public directory snapshot lists … From the lab website snapshot dated 18 October 2026."
- It repeats "snapshot", ends in a citation-style fragment, and drops the "effective 1 May 2026" detail the model gave last time.
- The voice prompt forbids reading technical metadata aloud.
- **Correction:** template it as one natural sentence, for example: "According to the lab's team page, as of 18 October 2026, Dr. Joseph Ollier is the scientific director." Add the effective date if the cache holds it.

**Smaller issues:**
- **Overfit matcher.** The regex literally encodes my test phrasing. Replace it with a normalizer that strips leading provenance clauses ("according to …") and trailing lab-name qualifiers. Keep the refusal list. Report fast-path coverage only for phrasings that were actually tested.
- **Tags in the visible history.** Bracketed tags are filtered from the live caption only. The visible conversation history still renders "[inhale]". Filter user-visible history too, and keep the raw text only in evidence logs.
- **Tag list too narrow.** Add `breath`, `pause` and plural or "-s" forms (`laughs`, `sighs`).
- **Breath tags in the prompt.** Naming "breath effects" may prime the behaviour it forbids. This is unproven, so leave it, but compare the tag count in session 2 against session 1, which had 2 tags.
- **Caption placement.** The caption still covers the character's legs (`bottom:179px`). Move it beside the source when material is open.

The date handling (oldest source, `lstrip('0')`) and the artifact and reasoning guards are sound.

## Part 2. Final convergence plan

### P0. Free work before the last session

1. **Fix B1–B3** and the tag and history gaps. Run the CI and deploy guards.
2. **Run a free pre-flight in the same browser before requesting a permit:**
   - preload the PDF module;
   - open TraceMonkey and go to page 2;
   - approve sharing and confirm the chip and the bottom status agree.
   - Log each stage with its completion condition. The paid session is requested only if every stage passes.
3. **Fix the driver's waits.** Replace the fixed 20 s waits with stage-specific waits, each with a named failure reason.

**Acceptance:** the pre-flight log shows "page 2 rendered, shared, revision N" before `/api/native/permit` is called.

### P1. Session 2 (the last one: 240 s, same four-step script)

| Step | Pass criteria |
|---|---|
| Fact question | Exactly one answer. Contains "Ollier" and "director". No "Yes,", no "current", no echo or paraphrase. No visible bracketed tags. |
| Fact timing | Report the fast-path submit-to-first-rendered-content time on **one clock only**, from client events. Target ≤4 s, versus about 13.7 s before. A miss is a polish failure, not a blocker, if the answer is correct and arrives once. |
| PDF walkthrough | Presented progressively: 3 rendered steps, 3 local speech boundaries, 0 manual advances, 3 page-2 mark ACKs in the same sequence. Grounded in the state machine: native execution in the dark box, gray interpreter boxes, the same-type loop edge, and side exits that go to an existing trace or back through the monitor. Source statements and inference are visibly separated. No trace-tree premise. |
| Long explanation | At least 140 characters plus the expected term, with an active rendered signal before the interrupt. |
| Interruption | The previous answer stops. The one-sentence reply contains the expected term and does not resume the earlier answer. |

**Also required:**
- end-of-session usage confirmed, room 0, cap still USD 75;
- screenshots show the status line readable and no tags in the captions or history.

### P2. Human listening (when the human is available; it cannot be done tonight)

Codex saves three clips from session 2: the factual answer, one walkthrough step, and the reply after the interrupt. The human scores each 1–5 for:
- accent naturalness (with "forced" as the failure),
- liveliness ("flat" as the failure),
- warmth,
- audible breaths or tags.

**Acceptance:** accent at least 4 and liveliness at least 4 on all three clips, with no audible stage effects. Nobody may record this as passed on the human's behalf.

### P3. Polish that does not need a paid session

1. **UI/UX:**
   - while material is shared, the source dominates, Einstein moves to the side, and the caption sits beside the source;
   - the sources entry point is promoted to a visible "From: lab team page, 18 Oct" chip on the answer.
2. **Reliability:**
   - name the startup phases (preparing audio, permit, connecting voice, ready);
   - investigate the 5.3 s permit time;
   - typing stays usable during all of these phases.
3. **Reasoning and source coherence:**
   - every spoken source claim maps to a returned location;
   - "not found" is said aloud rather than guessed.
4. **Natural communication:** if listening fails, the only remaining lever is the direction text. The voice, model and original design prompt stay unchanged.

### Stop condition

- **Converge:** declare the observed slice accepted only if all P1 rows pass **and** P2 passes. Even then:
  - Safari, Quest, the physical microphone and sustained load remain explicitly untested;
  - these four questions are not the 12-key protocol.
- **If session 2 fails any P1 blocker row:**
  - stop all paid work;
  - write the failure report with the exact stage, condition and evidence;
  - do not retry, add sessions, or reset identity or route.
  - The product stays **not accepted**, pending a new human authorization.
- **If P2 fails:**
  - allow at most one free revision of the direction text;
  - then stop and present the human with the tradeoff: the saved voice cannot change without their approval.
- **Opus calls:** spend the one remaining Opus call only on reviewing the session-2 evidence, with no new plan. Stop after that review regardless of outcome.

**Verdict now:** not accepted. The patch is acceptable to deploy once B1–B3 are fixed and the pre-flight passes.
