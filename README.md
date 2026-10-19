# Einstein · Mobiliar Lab

A browser-based research companion with a 3D Einstein portrayal, live voice, a reasoning backend and workspaces for original papers, uploaded slides, video and explanatory diagrams.

[Try the web app](https://einstein-mobiliar-lab.fastapicloud.dev/)

This is an early research prototype. Voice delivery, response latency and the timing of guided source explanations are still being refined. The current live configuration uses GPT-Live 1 and GPT-6.1 Sol. Speech is AI-generated; it is not a historical Einstein recording.

The latest live test completed three marked steps on an original paper and returned the tested cached lab facts in about 0.18 seconds. It failed interruption, and initial source analysis took about 18 seconds. The deployed controls have offline coverage and free browser checks; they have not passed another paid voice run. Voice quality still needs human listening feedback. [Read the final review](docs/OPUS_FINAL_REVIEW.md).

## Source snapshot

This independent public repository contains the webapp source and tests from revision `da5df8198628aefe68e801e80300088788ee0254`. `PUBLIC_SNAPSHOT.json` records the copied files and hashes; supplemental release and review reports reflect the final 19 October evaluation. The private development repository and existing deployment remain separate. This copy contains no production credentials, private owner logs, original Unity assets or private test-session recordings. Historical docs may refer to private development evidence. The application builds on the original Einstein character project by Rayna Ney; no new licence to that character or its motion assets is asserted.

## Run and test

Use Node 24. In `rehearsal/`, run:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run build
```

For local character rendering, supply an authorized model at `rehearsal/public/assets/einstein.glb`. The model binary and original Unity assets are not distributed here. The public deployment uses its existing CDN transfer; `rehearsal/src/character-transfer.json` records its byte/hash pins.

For your own dated public-lab snapshot, run `python -m lab_backend.ingest --limit 120` after installing the locked Python dependencies; this reads public lab HTML and writes `lab_backend/data/lab.json`. Production's private release-asset retrieval is not required to author your own local snapshot.

The Python service and locked dependencies are in `lab_backend/` and `deploy/fastapicloud/`. See `deploy/fastapicloud/README.md` for packaging and `docs/PUBLIC_LAUNCH.md` for configuration. Production deployment tooling is pinned to the private application repository and cannot deploy from this public copy. Supply your own authorized provider configuration to run inference; no API key is included. Inference can incur charges. Local PDF viewing needs no model session.

Only share material you are permitted to process. OpenAI processes approved voice/questions and selected source images; keep confidential content out of conversations. Avatar, motion, model and vendored dependency rights are separate: see `THIRD_PARTY_NOTICES.md`. Public source availability does not grant a licence to third-party character assets.

## Feedback

Please report the prompt, material, browser/device, what you expected and what happened. Particularly useful tests cover response delay, naturalness of speech, interruption, original-source annotations and whether an explanation stays grounded in the selected material. Apple/Quest migration remains future work.
