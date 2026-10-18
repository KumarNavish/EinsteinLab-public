# Research and browsing: current capabilities

Updated 14 October 2026. This extends the existing native Einstein conversation; it does not replace the avatar, voice selection or interruption path.

## Available versus unavailable

| Capability | Actual status |
|---|---|
| Read official Mobiliar Lab webpages during a conversation | **Implemented and exercised against real pages.** `lookup_lab` refreshes selected pages through the existing, robots-aware lab-only reader. |
| Public lab knowledge | **120 dated public HTML pages, 678 source spans and 18 project descriptions** in the native context. The refresh added 40 historical news/publication pages; it did not discover 40 new projects. |
| Careful Flash-based evidence synthesis | **Implemented, but provider reliability is not cleared.** A standalone Gemini 3.6 Flash comparison succeeded with exact citations; native-session checks also returned provider 503 errors. Failed checks are disclosed rather than presented as verified answers. |
| Google's current strongest Flash | Google identifies **Gemini 3.8 Flash** as its most intelligent Flash. Actual requests on this project timed out through GenerateContent, streaming and Interactions. The selected 3.6 fallback is explicit, not described as the newest model. |
| General Google Search | **Not enabled in this release.** The real native model connected without Search but rejected Search with a quota/billing error. No billing or paid fallback was activated. |
| Arbitrary website browsing / full linked papers | **Not implemented as a working release capability.** Do not infer it from the presence of a grounding-metadata parser or from a successfully read lab page. |
| Private Mobiliar research or internal documents | Not imported, searched or transmitted. Public retrieval/context is not model fine-tuning. |

The interface exposes these boundaries in settings. The live native model is instructed not to claim an internet search occurred when it did not.

## Use it on the prepared Mac

Open `http://127.0.0.1:8765/` and retain **Native voice**. The existing saved key and external-processing approval are reused; no key entry is needed after this update.

Examples of supported source-specific questions:

- “Check the official Telematics for Road Safety page now. Did accident probability improve significantly, or was that only driving behavior?”
- “Check the current lab directory: who is listed as scientific director?”
- “Ask Flash to compare VR for Relaxation and EMG for Relaxation. Keep the actual results separate from expected outcomes.”

The first two completed with real official-page reads and relevant spoken answers in the development check. The third exercises the additional Flash layer. If the provider is unavailable, Einstein should say the evidence check did not complete rather than inventing a synthesis. This is deliberate uncertainty handling, not a successful completed research answer.

Sources appear under **Research notes**. Each source records whether it came from a live official-page read or the dated local snapshot. A cached official-page read retains its original fetch timestamp; it is not relabelled as a newly fetched page.

## How evidence reaches the voice

1. The voice model chooses `lookup_lab` for a precise public-lab lookup, or `consult_flash` for a more difficult comparison or evidence check.
2. The selected official pages are refreshed using the existing approved lab-host/WordPress-route reader. It respects robots policy and has bounded time and content limits. General account/private URLs are not part of this reader.
3. Flash receives the actual excerpts, identifiers, dates and evidence categories—not a claim that its own memory is a source.
4. It returns a bounded list of claims, each with an evidence kind and exact supporting source substring. Local checks reject nonexistent identifiers, quotations absent from the supplied text, unsupported numbers and selected hypothesis-as-result errors.
5. The native voice is instructed to preserve the researcher's factual wording, especially the endpoint, comparison group and significance. Interpretation must be labelled. Missing public evidence is not proof that no evidence exists elsewhere.

These are accuracy safeguards, **not a proof of semantic correctness**. Exact citation matching does not by itself prove that a statement follows logically from the source.

An early native comparison incorrectly attached a screen comparison to mood/relaxation, when the supplied page attached that comparison specifically to heart-rate-variability parameters. That negative example is retained. The source-bound standalone Flash comparison kept those endpoints and controls separate. The spoken handoff was tightened afterward; the final native browser check encountered provider errors and therefore verified the explicit refusal path, not a successful corrected research narration.

## Model and cost decisions

- Voice remains `gemini-3.8-live` with the selected native voice.
- Preferred research model is `gemini-3.8-flash`.
- Selected fallback is `gemini-3.6-flash`, because it completed a source-based task when 3.8 timed out. It is not assumed to be equally capable.
- Flash is capped at **50 application research requests per UTC day** and **eight consultations per voice session**. One retry is allowed only after an explicit 502/503 response. That retry counts against the daily budget. Quota/billing rejections and timeouts are not retried automatically.
- The already approved free-tier credential is reused privately. No billing activation, paid Search tool, purchase, API-key change or account permission change occurred.
- The existing 24-hour free-tier proof remains a cost guard. It is not the credential's expiry; do not extend it without a fresh legitimate check.

Official pricing lists free token inference for the selected Flash generations but not free-tier Search grounding for them. Native Live Search is documented as supported; the actual project rejected it. The actual account result takes precedence over a capability-table assumption.

Primary documentation, checked 14 October 2026:

- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/docs/live-tools
- https://ai.google.dev/gemini-api/docs/google-search

## Knowledge refresh and scope

The snapshot was refreshed at **2026-10-14T12:43:32 UTC**. Existing 80 page texts were unchanged; 40 additional historical news/publication pages were added. One URL remained queued at the 120-page limit. Linked PDFs and a malformed contact link were explicitly skipped; no full-paper review is claimed.

```sh
cd /Users/kumar0002/Projects/EinsteinLab
.einstein-venv/bin/python -m lab_backend.ingest --limit 120
```

Restart the owned local server after a successful corpus refresh to rebuild the source index and native project context. No character asset or browser rebuild is required for a knowledge-only update. Live lookups already refresh selected official pages independently, with a three-minute cache.

The former snapshot is preserved locally at `.work/c8-previous-lab.json`. Full public text, model caches, credential files and research counters remain ignored by Git. The release evidence retains source identifiers, hashes, dates and measured outcomes rather than committing a wholesale website copy.

## Validation and remaining gap

**109 Python tests and 25 JavaScript unit tests pass; the production build passes.** The actual browser test confirms live source links, date/origin labels, explicit model/search limits, resource release and mobile layout without runtime/HTTP errors. Its principal real-Flash success check did not pass because of provider errors; the expected-results wording check also cannot pass on an abstention instead of a completed synthesis. This is not described as an all-green research release.

General internet search, dependable newest-Flash execution, broad factual accuracy and a successful final spoken research synthesis remain open. Physical headset/room-acoustic acceptance remains unchanged from the previous release.
