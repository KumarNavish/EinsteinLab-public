# Final Opus review and evidence corrections

The actual `claude-opus-5-5` at max effort returned the review below. Its verdict is preserved as **NOT ACCEPTED**. It received text, source patch and actual browser screenshots; it could not hear the saved recording.

Corrections from source and contemporaneous receipts:

- “94 characters were spoken” means 94 substantive characters in the received transcript. Exact audible word ownership was not established.
- Product retention flags were false. The separately authorized QA harness saved synthetic test transcripts and audio privately; “no transcripts saved” is not a blanket statement about this QA run.
- The sharing object inside the final event log was a mutable JavaScript reference. Stop/revoke later changed its flags. The contemporaneous `source-walkthrough.json` has approved/sharingAllowed/sharedWithConversation all true and a shared chip. That record, not a mixed-time object reference, establishes the state during the walkthrough. Future instrumentation must deep-clone such snapshots.
- Client playback was already flushed by `NativeConversation.sendText` through `resetPlayback` → `SpeechPlayer.stop` before its input event in tested f5. The failure concerns newly arriving untagged old speech as well as backend ownership; an existing flush is not proof that those late frames stopped. A new diagnostic records the actual local playback-epoch reset.
- The two changed source blobs in branch688bba3 and squash merge5326b5e match exactly; `source-provenance-proof.json` records both. Exact-main CI passed on5326b5e. Squash merges do not retain the branch commit as an ancestor.
- The preceding backend-planning completion arrived 6.252 seconds before question 4. This run proves continuation of old voice, not a third-question backend result first arriving after the interruption. Request ownership for overlapping backend work remains unverified; arbitrary generation tags on untagged audio would not establish it.
- No character asset, saved design, voice identity or rendering source changed between f5 and5326. A difference between unfrozen stills does not by itself establish an asset or quality change.

The valid failures remain: old-answer resumption, a contaminated long-answer gate, repeated/incomplete walkthrough content, cold analysis delay, and missing human listening acceptance. No later paid retry or Opus call was made. The instruction control remains advisory; it does not supply request ownership to hosted backend speech. Post-review changes and their separate offline/deployment evidence are recorded in the delivery report.

---

# Final evidence review: runtime f5aa14f, plus the undeployed-to-voice repair 5326b5e

## Observed passes (mechanics only; nobody listened)

- **Fact question.** One answer only: "Dr. Joseph Ollier is listed as the scientific director."
  - The fresh transcript contains no echo, "Yes," or "current".
  - First transcript arrived 932 ms after submit and the first rendered signal at 1127 ms. That is not proven first-useful-word latency.
  - The date chip ("From: Lab team page · 18 Oct") is visible. The effective date was correctly not invented.
- **Preflight.** Page 2 rendered and local permission was allowed with zero starts, then the PDF closed. After startup, page 2 was re-shared through the UI.
- **Walkthrough mechanics.**
  - Presented progressively: 3 rendered steps, 3 local boundaries, 0 manual advances, 3 mark ACKs on the same document and image hash.
  - The marks match state-machine regions. No trace-tree premise appears.
- **Close.** Room 0, cap USD 75, 147 voice-seconds confirmed. No transcripts or microphone audio saved.
- **Startup.** Typing stayed enabled through all startup phases. The permit took 183 ms, one sample only.

## Exact failures and limits

1. **Interruption failed.** About 29 ms after the fourth question's `input_start`, the voice continued the old answer: " and avoids the interpretation and compilation overhead."
   - It answered the dark box in one sentence.
   - It then resumed the third question's guard-failure content across three more sentences.
   - This is old-answer resumption, not merely multi-sentence output.
2. **Long-explanation gate failed on reconciled evidence.**
   - Only 94 fresh substantive characters were spoken.
   - The answer opened with "I'm ready for the next figure…", a leaked walkthrough closure. That is exactly the abrupt, unrelated framing the owner objected to.
3. **Walkthrough content fell short.**
   - It opened with dead filler: "I see the file… haven't inspected this page yet."
   - The first mark arrived 21.2 s after the question; vision analysis took 17.9 s. This is a long delay.
   - Step 1 restated itself and mislocated Interpret Bytecodes "at the left". The screenshot shows it top-centre.
   - Observation and inference blurred in speech ("One sees… there is a cost to prepare").
   - There was no side-exit or guard step, and no dark-box versus gray-box explanation.
4. **Every event carries `generation: 0` across all four questions.** No mechanism distinguished stale backend output.
5. **The sharing state record is inconsistent.** The chip reads "shared" while `document.sharedWithConversation`, `approved` and `sharingAllowed` are all false. The shared region also silently narrowed to "selected area".
6. **No human listening exists.** "Flat" and "forced accent" remain unresolved. Stills cannot judge gestures or lipsync.

## Candid review of the deployed repair (offline only)

**What it does.** It sends `session.instructions.append` ("Stop speaking immediately…") before each typed input and before the cached fact.

**Where it falls short:**
- **It is plausible steering, not a fix.**
  - Per its own docstring, it does not cancel Responses work or establish a playback boundary.
  - No client playback flush was added, so already-queued old audio can still play.
- **Stale backend results are unaddressed.** "Answer only the latest verified result" gives the model nothing to tell results apart.
  - Generation stays 0.
  - The third question's late backend output would still look "latest". That is the exact mechanism of this failure.
- **It may regress the one row that passed.**
  - The fact path passed without the steer.
  - It now receives "Stay silent while the latest backend work is pending" immediately before its own commentary. That interaction is untested live.
- **It may worsen flatness.**
  - Instructions accumulate with every typed turn.
  - The teaching prompt is now capped at "two short sentences".
  - Both pull against the owner's "too flat" complaint, untested by any listener.
- **The one-sentence regex is overfit.** It matches only a leading "in/answer in/reply in one sentence". "Briefly, in one sentence" would miss. This is the same overfitting I flagged before.
- **Commit provenance is unclear.** Local tests ran on 2950beb and 688bba3. Exact-source CI passed on 5326b5e. The evidence does not show that 5326b5e contains 688bba3.
- **Unexplained visual difference.** The avatar head render in the post-fix free screenshot differs from the earlier stills. This is not investigated here.

## Verdict

**NOT ACCEPTED.**
- Two P1 rows failed: interruption, and long explanation.
- The walkthrough content and latency are inadequate.
- P2 (human listening) has not happened.
- The repair is not live-validated and leaves the stale-result mechanism intact.
- No paid retry. Broad interactions, Safari, Quest, microphone, load testing and the full 12-key protocol remain untested.

## Corrections justified by this evidence (no further paid calls)

1. **Bind backend output to the request.** Increment the generation on each typed `input_start`. Drop tool results, commentary and teaching steps from superseded generations before they reach the voice.
2. **Flush client playback on typed submission** and log the flush.
3. **Remove the steer from the cached-fact path** unless audio is actually playing or work is pending.
4. **Suppress the pre-inspection filler and the closure line**, so the walkthrough opens and ends without empty framing.
5. **Fix the driver's long-explanation gate.** Count only text in the current generation after `input_start`.
6. **Record the run as failed.** Keep these failures in the failure report unchanged.
