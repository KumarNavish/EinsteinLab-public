# Reasoning tools and quiet continuous audio

## What this revision does

The native conversation can now make a short plan, read the existing official-lab sources, calculate with a restricted Decimal arithmetic tool, and deliver a reviewable Markdown note. The interface records the tools that actually ran and offers a **Download this draft** button. A plan is not labelled execution, and a draft is not labelled published or sent.

Example request:

> Make a short plan, read the official Telematics for Road Safety results, calculate (250-200)/250*100 as a separate hypothetical example, and deliver a downloadable note. Keep the invented numbers separate from the lab's actual results.

Use the existing running application at `http://127.0.0.1:8765/` on the prepared Mac. Refresh the page to load the new JavaScript. The saved provider credential is unchanged. The voice remains Gemini native audio; the additional Flash researcher retains its previously documented availability limitations. This revision does not claim a new successful Flash benchmark.

## The beep investigation

No intentional oscillator, beep, chime or notification sound was found in the application. A narrow-band scan of the three recorded provider voices and an earlier conversation recording did not reproduce the reported tone. Therefore its exact origin—provider audio, packet discontinuities, room feedback, headset or operating-system sound—has not been established.

The previous native path scheduled a separate AudioBufferSource for each network packet and could cut abruptly on interruptions or late packets. The new path uses a continuous AudioWorklet ring buffer, 80 ms prebuffering, and short start/stop/underrun fades. Packet boundaries no longer define new audio sources. The microphone worklet now supplies 1024-sample blocks instead of 4096, reducing the block interval to about 21 ms at 48 kHz.

A conservative narrow-band guard mutes an almost perfectly stable 650–6000 Hz sine sustained for at least 60 ms. It is not a general noise suppressor and should not be described as eliminating every possible beep. All three actual recorded voice samples were unchanged by that guard in deterministic tests. Four synthetic tone frequencies were suppressed; an actual browser test also verified silence for an injected 1 kHz tone while normal recorded voice played.

The guard uses approximately 40 ms lookahead, the stream uses 80 ms prebuffering, and the existing face compensation adds 70 ms. These are configured buffering components, not a measured total microphone-to-ear delay. Device/OS sounds are outside this app's output graph.

## Public search and webpage reading

Settings now has **Public web research · Exa**, disabled by default. It permits only the documented, keyless Exa public MCP `web_search_exa` and `web_fetch_exa` tools on the next native connection. Queries and public URLs go to Exa; returned evidence goes to Google. No API key, cookie, private file or paid agent is supplied to Exa. Google Search remains disabled after its earlier billing/quota rejection.

The real Exa tools/list endpoint returned the search and read schemas. The attempted live content smoke test was blocked by the execution layer before dispatch. Parser, permission and error-handling tests use labelled fixtures. **A successful real Exa search/read has not been verified in this release.** The UI and status endpoint retain that distinction.

Only accessible public HTTPS references are admitted. Local/private networks, credential-bearing links, Google account documents and signed URLs are refused. There is no login, paywall or anti-bot bypass. Search highlights are not claimed as entire articles or visual PDF understanding. Requests have response/size/time limits and no automatic paid fallback.

## What is not implemented

The proposed binary-document extractor and persistent private text workspace were blocked before their files were written. They are not present, and no differently named replacement was used. There is no general file-upload reader, visual PDF/chart reader, private Drive/mail reader or arbitrary Mac file access in this revision. Do not label it “reads anything.”

The agentic lane is deliberately limited to planning, public-source inspection when enabled, arithmetic, and in-conversation drafts. It cannot send email, buy, publish, delete, change permissions, run arbitrary code or operate the user's apps. Those actions require separately authorized integrations and their own acceptance checks.

## Reproduce the checks

```sh
cd /Users/kumar0002/Projects/EinsteinLab
.einstein-venv/bin/python -m pytest lab_backend/tests -q
(cd rehearsal && npm test && npm run build)
# Actual browser audio graph, recorded voices and injected test tones; no provider call:
(cd rehearsal && node tests/continuous-audio.e2e.mjs)
# Existing approved Google native route; public web explicitly off:
export PLAYWRIGHT_BROWSERS_PATH="$PWD/.work/playwright"
(cd rehearsal && node tests/reasoning-work.e2e.mjs)
```

Tests retain source URLs, exact tool receipts and resulting draft text. The local recordings combine the real renderer and outgoing audio, with no voice replacement. No human room-echo or physical Quest acceptance follows from a desktop test.

Primary technical references: Exa's hosted endpoint and keyless policy at https://exa.ai/mcp; its public source formatter contracts at https://github.com/exa-labs/exa-mcp-server; Web Audio gain interpolation guidance at https://developer.mozilla.org/en-US/docs/Web/API/GainNode.
