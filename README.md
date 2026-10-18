# Einstein · Mobiliar Lab

A browser-based research companion with a 3D Einstein portrayal, live voice, a reasoning backend and workspaces for original papers, uploaded slides, video and explanatory diagrams.

[Try the web app](https://einstein-mobiliar-lab.fastapicloud.dev/)

This is an early research prototype. Voice delivery, response latency and the timing of guided source explanations are still being refined. The current live configuration uses GPT-Live 1 and GPT-6.1 Sol. Speech is AI-generated; it is not a historical Einstein recording.

## Source snapshot

This independent public repository contains the webapp source and tests from revision `3c8f9130b1f1111fcff8f3dcf171722bec320534`. `PUBLIC_SNAPSHOT.json` records the copied files and hashes. The private development repository and existing deployment remain separate. This copy contains no production credentials, private owner logs, original Unity assets or generated test recordings. Historical docs may refer to private development evidence. The application builds on the original Einstein character project by Rayna Ney; no new licence to that character or its motion assets is asserted.

## Run and test

Use Node 24. In `rehearsal/`, run:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run build
```

For local character rendering, supply an authorized model at `rehearsal/public/assets/einstein.glb`. The model binary and original Unity assets are not distributed here. The public deployment uses its existing CDN transfer; `rehearsal/src/character-transfer.json` records its byte/hash pins.

The Python service and locked dependencies are in `lab_backend/` and `deploy/fastapicloud/`. See `deploy/fastapicloud/README.md` for packaging and `docs/PUBLIC_LAUNCH.md` for configuration. Production deployment tooling is pinned to the private application repository and cannot deploy from this public copy. Supply your own authorized provider configuration to run inference; no API key is included. Inference can incur charges. Local PDF viewing needs no model session.

Only share material you are permitted to process. OpenAI processes approved voice/questions and selected source images; keep confidential content out of conversations. Avatar, motion, model and vendored dependency rights are separate: see `THIRD_PARTY_NOTICES.md`. Public source availability does not grant a licence to third-party character assets.

## Feedback

Please report the prompt, material, browser/device, what you expected and what happened. Particularly useful tests cover response delay, naturalness of speech, interruption, original-source annotations and whether an explanation stays grounded in the selected material. Apple/Quest migration remains future work.
