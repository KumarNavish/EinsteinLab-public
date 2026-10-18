# C8 — live official-lab reading and Flash evidence checks

14 October 2026. Device `local`; checkout `/Users/kumar0002/Projects/EinsteinLab`; branch `feat/mobiliar-local-20261013`. This turn began at `14061792695f88398114e7cab6e36ff29df40d4f`; inspect current Git HEAD and remote ref for the released revision.

## Owned running application

Current server: **`einstein-c8-research-release-running`**, launcher PID **80693**, child **80696** at the latest observation. Command `.einstein-venv/bin/python scripts/launch.py --no-browser`, URL `http://127.0.0.1:8765/`. Start operation `230c0eaa90b14b6dc3394a031c6f0d301742159a8cf6d1a75ef82e81dda1e88b`; readiness receipt `941a072cb4c5498c1785740978d6f0d5d956f5b16cb6a54b234fc69b33e8d9ed`.

Earlier C8 hosts were deliberately terminated to load the corrected source. Do not run them beside this server. Check actual participant activity and the original session receipt before a restart. No separate background reasoning agent is running.

## Implemented and actually observed

The public snapshot is now 120 HTML pages / 678 source spans, fetched `2026-10-14T12:43:32.354990+00:00`. Forty historical publication/news pages were added; the prior 80 page texts did not change. Eighteen project contexts preserve methods, actual results, expected outcomes, researcher names, status labels and source URLs. This is source context/retrieval, not model fine-tuning or an import of private lab records. The old snapshot remains `.work/c8-previous-lab.json`.

`live_lab.py` reuses the established two-host lab-only crawler. Actual native turns refreshed VR/EMG project pages, the telematics page, and the official directory. Fresh dates and source links appeared in the real browser. General public-URL fetching is not implemented.

`flash_research.py` requests source-bound claims and checks identifiers, exact source substrings, numbers and selected hypothesis/interpretation constraints. The preferred model is Gemini 3.8 Flash, but repeated actual requests timed out. Gemini 3.6 Flash completed a source-bound standalone comparison in 2.755 seconds (excluding prior HTTP page reads). The selected fallback and its reason are exposed, not hidden.

The integrated native Flash checks were not consistently successful: real provider 503 errors and further 504/timeouts were retained. The final voice abstained instead of claiming a completed synthesis. Do not describe a mocked test or the single standalone success as an end-to-end reliability result. The earlier native comparison that moved a screen comparator to the wrong outcome is retained as a negative.

109 Python tests and 25 JavaScript unit tests/build pass. The final rendered browser check passed 11/13; its central Flash-completion gate failed. Source links/freshness, visible capability limits, resource release, mobile layout and runtime health were observed. No human microphone or headset test was performed here.

## Search, cost and secrets

Google Search was actually tried with the existing approved native model. Custom-function-only setup connected; Search-only setup failed with code 1011 and quota/billing terms. Search was removed from the running native configuration, so ordinary voice continues to work. Do not re-enable it merely because the public documentation lists support.

The Flash token route remains the existing free-tier project. No billing activation, key mutation, paid fallback, reset credits or upgrade occurred. App Flash usage is capped at 50 requests per UTC day and eight consultations per native session. Only explicit 502/503 errors receive one bounded retry, counted against the budget. Quota failures/timeouts are not automatically replayed.

The supplied key and proof remain under `.work/private` with the prior owner-only handling. Never print, export or commit them. Research counters contain counts only. Uvicorn now runs at warning log level to avoid INFO-level websocket permit URLs.

## Evidence and rejected operations

Curated evidence: `evidence/2026-10-14-research/`; full local evidence: `evidence/runtime/c8/`. Committed JSON replaces full source quotations/excerpts with hashes, keeping source URLs and dates.

The following requests were blocked before execution and were not rerouted: `einstein-c8-public-web-reader` (generic fetcher file was not created), `einstein-c8-free-search-contract-check`, `einstein-c8-sdk-schema-and-lab-coverage`, `einstein-c8-source-bound-flash-integration-check` (the 90-second 3.8 test), `einstein-c8-current-flash-public-url-verification`, and `einstein-c8-context-coverage-and-research-boundary`. Do not infer results from these attempted calls. The scoped official-lab reader is the existing crawler reused for its already defined lab hosts, not an alternate arbitrary-network route.

Important completed sessions: `einstein-c8-verify-official-page-research-dialogue` (real reads and retained flawed comparison), `einstein-c8-audit-comparison-claim-fidelity` (standalone successful Flash claim/source binding), `einstein-c8-final-research-ui-regression` (actual browser, principal Flash gate failed), and `einstein-c8-isolate-cross-model-resource-limit` (both paired provider calls timed out; no causal resource-limit conclusion).

## Next acceptance gates

Restore genuinely available general search only within the user's cost/authority boundary. Obtain repeatable responses from the intended Flash endpoint and then repeat source-grounded spoken comparisons with the same outcomes/comparators and retained negatives. A source-bound quote check is not a complete entailment proof. Do not replace these gates with another screenshot or model-catalog lookup.
