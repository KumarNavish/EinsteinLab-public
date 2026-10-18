# Public browser acceptance

`keyless.mjs` exercises the actual public app without starting a provider. `run.mjs` exercises actual paid provider sessions. The 2026-10-17 run passed spoken conversation, source-owned PDF annotations, video and two-visitor isolation, then failed at the two-slide PPTX conversion. Its partial report remains under `evidence/2026-10-17-public-acceptance/`; complete provider acceptance is pending. A successful keyless run does not establish native speech, research, vision, annotation or human realism acceptance.

The 2026-10-16 keyless run passed 18 functional checks, made zero native permit/WebSocket requests and submitted one labelled engineering feedback entry. Authenticated owner readback matched all seven fields. Its report and screenshots are in `evidence/2026-10-16-public-acceptance/keyless-2026-10-16T18-49-21-570Z/`. Manual mobile review found the actor overlapping the hero heading at 390×844; `visual-review.json` preserves that failure. The subsequent local repair passed 35 isolated zero-provider checks at 390×844, 320×568 and desktop; `evidence/2026-10-16-mobile-welcome/` records that separate result. Earlier failed public runs remain alongside the keyless report.

The prepared provider protocol expects OpenAI `gpt-live-1` for continuous speech and `gpt-6.1-sol` for delegated reasoning, source pixels and evidence synthesis. Those are expected configuration labels until an actual run observes them. The owner must confirm the deployed source, provider funding and PUBLIC READY before execution. These scripts do not create credentials, change billing, deploy, install dependencies or touch a user dashboard.

## Requirements and offline checks

- Existing Chrome, Node and the repository's installed Playwright dependency under `rehearsal/node_modules`.
- The reviewed `rehearsal/dist` matching the deployed source. Actual served entry JS/CSS and the pinned GLB are hashed; the owner CI/host receipt establishes private backend identity. At the exact production FastAPI origin the character uses the bundled `rehearsal/src/character-transfer.json`: fourteen immutable Netlify CDN chunks preserve the original 55,079,784 bytes and full SHA-256. Local and other origins keep the original GLB path.
- An explicit authorized public PDF at `EINSTEIN_PUBLIC_PDF`; there is no bundled paper or download. The original TraceMonkey PDF was used in the recorded run. Foundation-model unfamiliarity cannot be proved.
- Synthetic video, recorded microphone and two-slide PPTX fixtures in `fixtures/`. Their manifests record exact bytes, hashes and provenance. Optional paths are `EINSTEIN_PUBLIC_VIDEO`, `EINSTEIN_PUBLIC_MIC_WAV` and `EINSTEIN_PUBLIC_PPTX`; another deck needs corresponding acceptance expectations.
- An exact public HTTPS origin, owner-verified deployment UUID and 40-character deployed source SHA. Those IDs are provenance labels, not independently verified private backend hashes.

These commands open no browser and make no network/provider request:

```sh
node qa/public-acceptance/keyless.mjs --plan
node qa/public-acceptance/run.mjs --plan
node qa/public-acceptance/run.mjs --remaining --plan
node --check qa/public-acceptance/keyless.mjs
node --check qa/public-acceptance/run.mjs
node --test qa/public-acceptance/helpers.test.mjs
```

Both protocols use fresh Chrome contexts, real controls and renderer acknowledgements. They do not mock the bridge, intercept routes, override visibility/consent guards, inject tool results or substitute generated source pixels. Evidence uses fresh timestamp folders under `evidence/YYYY-MM-DD-public-acceptance/`. No automatic retry occurs.

The production character loader uses at most four concurrent chunk requests with credentials omitted and redirects refused. It checks every chunk's actual byte count and hash, then the complete reassembled GLB before parsing. The provider protocol separately captures each actual CDN response body and computes its own per-chunk and full-asset hashes. It permits only those exact manifest GET paths outside the app origin and verifies that they carry no Cookie or Authorization header. Verified chunk mode never issues a fallback 55 MB GLB GET. Mock-fetch unit fixtures test this transfer offline; they are distinct from public browser evidence.

## Provider-free public UI run

After explicit approval of the single feedback write:

```sh
EINSTEIN_PUBLIC_KEYLESS_APPROVED=1 \
EINSTEIN_PUBLIC_URL='https://exact-public-host' \
EINSTEIN_PUBLIC_DEPLOYMENT_ID='OWNER_VERIFIED_DEPLOYMENT_UUID' \
EINSTEIN_PUBLIC_RELEASE_SHA='EXACT_40_CHARACTER_DEPLOYED_SOURCE_SHA' \
EINSTEIN_PUBLIC_PDF='/absolute/path/to/authorized-public-paper.pdf' \
node qa/public-acceptance/keyless.mjs --run
```

The five-minute run covers the textured actor on desktop/mobile, source-file PDF navigation and pixel invariance, native video play/pause/seek/rewind/speed, mobile overlay alignment, security headers and browser/CSP errors. It declines processing when the dialog is reachable. With native availability disabled, the UI stops before that dialog; this is recorded as a limitation rather than a completed decline test. It never clicks a media Discuss control. Any native permit or WebSocket attempt closes the browser and fails the run.

The local-media and feedback checks run while the 55 MB character downloads. Character readiness and complete asset bytes must still be observed before the full functional state can pass. A slow download can fail the run after its single feedback entry was already saved; inspect the report and do not repeat the write blindly. Chrome can evict the large response body from its inspector cache; the fallback is one ordinary same-cookie GET with its own byte hash, explicitly labelled in the receipt.

## Prepared provider run — PUBLIC READY required

The plan uses two actual provider sessions, one expected third-visitor capacity rejection while both remain active, one PPTX conversion and fifteen minutes total. The normal path has eight specialist checks: the paper's opening and figure pages, two video frames, two converted slides, one rendered whiteboard and one evidence synthesis. This corrects the earlier omission of the opening-page inspection. Nine is the conservative protocol goal: an unexpected excess fails and closes the sessions. This browser counter is not an atomic provider or spending guard; a dispatched backend batch may already be running. The owner reviews actual usage and cost against the approved project spending controls. There are no automatic retries, model changes or fallback calls.

All three independent browser processes load and verify their assets sequentially before paid sessions begin, avoiding competing cold downloads on the operator's shared connection. This does not establish simultaneous cold-load performance. The separately isolated voice sessions still run concurrently. Each session reserves time for the actual close handshake within its 570-second protocol allocation. Work is divided between A and B to stay within the backend's 32-response per-session ceiling. Every source or renderer failure stops the run. A missed gate is a failure or incomplete result, even when earlier scenarios passed.

```sh
EINSTEIN_PUBLIC_READY=1 \
EINSTEIN_PUBLIC_BUDGET_APPROVED=1 \
EINSTEIN_PUBLIC_URL='https://exact-public-host' \
EINSTEIN_PUBLIC_DEPLOYMENT_ID='OWNER_VERIFIED_DEPLOYMENT_UUID' \
EINSTEIN_PUBLIC_RELEASE_SHA='EXACT_40_CHARACTER_DEPLOYED_SOURCE_SHA' \
EINSTEIN_PUBLIC_PDF='/absolute/path/to/authorized-public-paper.pdf' \
EINSTEIN_PUBLIC_FIGURE_PAGE=2 \
node qa/public-acceptance/run.mjs --run
```

Visitor A uses typed prompts for actual generated speech/captions and multi-turn conversation, an original PDF figure with both box and ellipse marks from returned same-page region IDs, a converted two-slide walkthrough and an official lab evidence question. The authored deck has Input→Outcome with A=2/B=5 on slide 1, and Dose→Response with Control=3/Treatment=7 arbitrary units on slide 2. The script checks those values without including them in prompts. Both slides must be inspected and annotated, and the viewer must navigate 1→2→1 with the correct document/page ownership. The lab question requires actual `lookup_lab`, `consult_flash`, a source-bound result labelled with the actual model and official source URLs.

Visitor B uses an independent cookie and conversation. It controls the original synthetic video through actual play, pause, speed, seek and rewind actions, inspects two different frames and applies a source-owned frame mark. It creates a conceptual graph, revises and focuses it, asks the backend to inspect the actual rendered JPEG, then dismisses it. Source page/frame hashes and matching action IDs, revisions and renderer acknowledgements are required; a spoken claim alone cannot pass an action.

B's authored synthetic WAV then enters Chrome's actual `getUserMedia` capture, worklet, resampler and provider route during a binary-search explanation. The protocol requires an actual local output overlap, suppressed incoming packets while the same backend stream continues, recognized soap-bubble input and a new spoken response. The fixture was authored locally with macOS system speech and ffmpeg. It provides no human microphone, acoustic or naturalness verdict. It must not cause a socket interrupt or generation change.

GPT-Live supplies continuous audio rather than provider voice turn-complete or interruption events. The protocol requires new actual rendered signal samples for each spoken response and a new client-local `playback_idle` boundary after the relevant tool receipts. Its recorded reason is either `playback-drained`, which requires an empty queue, or `rendered-silence`, which requires at least 450ms of actual rendered quiet plus the player's 70ms speaker delay. Silent PCM may continue arriving and remain queued during rendered silence; this is not a queue drain or provider completion. The protocol records signal-sample and quiet telemetry, the actual boundary timestamp and the transcript. Initial/all-zero PCM, packet counts, a timer alone or an old completion cannot count as speech. Local speech suppression is not provider cancellation.

A tool acknowledgement can be followed by a local quiet boundary before the substantive answer continues. The two slide checks therefore keep their existing bounded wait open until the actual received output transcripts contain the required source values, mechanism and scope, as well as the matching action and playback receipts. The assertions remain in place. Transcript fragments are collected only since that prompt; user text and source metadata cannot supply the answer. Playback must follow those output transcript receipts too, so new substantive text cannot reuse the earlier prelude's playback boundary. Whiteboard inspection additionally requires two distinct full labels from the actual visible graph, alongside the matching rendered-image acknowledgement and backend image receipt. These are semantic acceptance predicates, not new provider completion events or silence timers.

Visitor C first declines processing, which must create no permit, WebSocket or microphone capture, then attempts a full room. The genuine server `room_active_sessions` must remain two while `room_capacity_rejections` increases exactly once. Concurrent unrelated visitors can make those aggregate receipts ambiguous and fail the check. Cleanup first dismisses any open native dialog with Escape so the actual Interrupt control remains reachable. Actual Interrupt controls must stop A and B, release mic/audio/source state and settle the room to zero. Each server session must return confirmed final provider usage, with distinct conversation IDs.

The report retains sanitized model/tool events, region ownership, actual browser output recordings, PCM/HTTP/WebSocket byte counts, response and connection timing, render/audio counters, source hashes, cookie hashes and settled server status. It excludes raw cookies, authorization headers, permit URLs, credentials and image base64. Prompt timing records the first observed rendered signal during active playback, polled at 200ms intervals; it includes player delay and does not count silent PCM as speech. Browser byte counts exclude TLS framing and hidden server-provider traffic. Final usage comes from the server's provider receipt; monetary charges need the owner's separate provider readback. All required coverage keys, recordings, security checks and cleanup must pass before the script can emit `PUBLIC_OPENAI_PROTOCOL_PASSED`.

The provider protocol submits no feedback. The earlier keyless UUID `915ea6fc-937a-4d64-bf6a-fde9d574c431` already passed authenticated owner readback for all seven fields; it is a separate receipt. A feedback POST during this protocol is an error and closes the sessions. Do not rerun the keyless script merely to repeat that completed write. Provider acceptance remains unverified until the actual deployed protocol runs and all gates pass.

## Focused remaining scenarios

After reviewing the earlier same-deployment conversation, original-PDF, video, consent, isolation and capacity receipts, the owner can explicitly approve the smaller `--remaining` allocation. Use the same environment and fixture gates above, then run `node qa/public-acceptance/run.mjs --run --remaining`. This opens one fresh microphone-capable visitor and permits exactly one provider connection attempt/session, one PPTX conversion and at most five observed specialist starts (four expected: two slides, one whiteboard image and one lab synthesis). The fifteen-minute whole-run and 570-second session limits remain. There are no retries or quota resets.

This mode reuses the complete slide 1→2→1 walkthrough, source-owned annotations, conceptual creation/revision/focus/actual JPEG inspection/dismissal, official lab evidence, synthetic microphone and overlap, mobile/security, actual Interrupt, confirmed final provider usage and room-zero cleanup. The original served frontend and character byte checks remain unchanged. It skips the already reviewed baseline conversation, original PDF, video, declined-consent and two-visitor isolation/capacity block. It makes no new isolation or capacity claim.

Its report records `mode: remaining`, the six required coverage keys and the six unexercised keys. It can emit only `PUBLIC_REMAINING_SCENARIOS_PASSED`; default full mode still requires all twelve keys, two sessions and the third capacity-denied attempt before emitting `PUBLIC_OPENAI_PROTOCOL_PASSED`. A focused pass does not promote an earlier failed full report. Any broader acceptance claim requires the owner's explicit aggregate of the exact source/deployment and hashed earlier and focused receipts.


## Focused microphone acceptance

`node qa/public-acceptance/run.mjs --run --microphone-only` uses the same deployment/funding gates and verifies one fresh visitor, one voice session and initial connection, no specialist calls or conversions, a 180-second session limit and six minutes total. Its required gates are `synthetic-mic-local-overlap`, `responsive-security` and `cleanup`. It can emit only `PUBLIC_MICROPHONE_SCENARIOS_PASSED`; it cannot promote an earlier failed full report.

The authored speech is followed by 120 seconds of exact zeros, longer than the capture waits and cleanup allowance. This prevents Chrome's repeating fake-capture file from supplying a second request during the bounded test. The gate requires exactly one local utterance, the two actual playback resets around that utterance, nonzero rendered signal in the post-input epoch, a fresh recognized bubble question and a new spoken bubble answer. Earlier binary-search playback and cumulative signal counters alone cannot pass it. This remains synthetic capture, without a physical microphone or acoustic claim.


Renewable voice transport keeps the same provider session. Fresh `/voice`
attempts retain the original allocation; `/renew` carriers have a separate bound
of two per provider session (four in the full protocol, two in remaining mode).
Reports retain both total socket attempts and renewal counts. The observer removes
private renewal controls and orders/de-duplicates actual `transport_seq` events,
so replay does not inflate audio, provider or tool counts. All pending observed
sequence gaps must drain before a pass. This permits planned transport renewal;
it does not permit a replacement provider session, extra quota reservation or retry.
