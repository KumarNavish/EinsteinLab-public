# Original-source experience protocol

`node qa/public-acceptance/experience.mjs --plan` remains offline. The same
`--run`, readiness, budget, exact deployment/source and original-PDF gates apply.
The default receipt contract is now `source-v2`; its pass state is
`PUBLIC_SOURCE_EXPERIENCE_V2_MECHANICS_PASSED_CONTENT_REVIEW_PENDING`.
Historical reports and the legacy `teachingProgress` / `completedTeaching`
helpers retain their original conceptual-graph meaning.

The run uses the same pinned TraceMonkey PDF and page 2, one initial provider
session, at most one carrier renewal and three vision checks. It keeps the
240-second session and 360-second whole-run ceilings and existing cleanup
reserves. No new provider, conversion, microphone, search or feedback is allowed.

Each source stage must have one cumulative `document_action` mark proposal.
The sequence, selected page, original-document hash, inspected image hash and
region ID must match the preceding actual `document_inspected` receipt. The
resolved mark coordinates must equal that region's coordinates. Earlier marks
and the figure crop stay unchanged. A matching successful `document_result`
with the actual crop and mark count must precede the stage and its commentary.
Conceptual replacement views and unrelated document operations fail the run.

At 1280 × 720, the displayed crop must fill at least 60% of the source workspace
width and fit inside it. Staged checks compare the displayed base canvas against
an independently rendered crop of the browser's original PDF canvas. The
original page's pixel hash must remain unchanged. These are enlargement and
pixel-identity checks; readable text and scientific meaning still need human
review.

The local teaching and ink receipts share the browser's performance clock.
Fresh rendered-speech onset must start ink within 300ms, after the ghost mark's
actual render. Every first-walkthrough stage must finish its ink and produce a
fresh heard boundary. Existing 4s share-to-action, 6s request-to-first-action,
2.5s ACK-to-useful-narration and 1.5s boundary-to-next-action ceilings remain.

The restart reuses the same inspection and needs independent sequence, speech
and ink receipts. An ordinary new question must stop progression and ink within
500ms, preserve the acknowledged source marks and crop, and receive a fresh
answer. Actual output recording, staged screenshots, final provider usage and
room zero remain required. Any first failure is retained; no retry is added.

Offline fixtures test the auditor's acceptance and rejection logic only. They
are never evidence that the browser, source inspection or provider ran.
