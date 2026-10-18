Private Einstein feedback collector
=================================

The app submits explicit form fields to its own backend. The backend validates a
short-lived permit, honeypot, payload, request ID and rate limits, then writes
through one fixed HTTPS function using a server-only secret. The browser never
receives that secret. No transcript, recording, document, IP address or email is
attached. Optional visitor-written context is stored as submitted.

`receive-feedback.mjs` accepts authenticated POSTs only. Each request ID creates
one immutable JSON object in the site-wide `einstein-feedback` Blobs store.
Retries cannot overwrite a different payload. There are no shared blob counters,
accounts, transactions or public read routes. The store survives app and Netlify
redeployments. Preview code must not write into this production store; isolated
tests use a local in-memory adapter.

The owner can review/download entries in the existing site's **Data & Storage →
Blobs → einstein-feedback**, or with the authenticated Netlify CLI:

```sh
NETLIFY_SITE_ID=162078b9-2f18-4c0a-9ede-e5f3490ec438 \
  npm exec --yes --package=netlify-cli@27.13.0 -- netlify blobs:list einstein-feedback
NETLIFY_SITE_ID=162078b9-2f18-4c0a-9ede-e5f3490ec438 \
  npm exec --yes --package=netlify-cli@27.13.0 -- netlify blobs:get einstein-feedback REQUEST_ID
```

The existing team is on Free Legacy, with a hard free limit. The documented
included Functions allowance is 125,000 invocations/site/month. The function
configures one request per domain per minute before execution; invalid callers
cannot access Blobs. The app also bounds feedback submissions locally. These
limits trade burst availability for abuse resistance; they do not promise
unlimited traffic. Local counters can reset when free-host storage is replaced.
The Free plan can pause sites at its limits and does not charge overages. No plan,
payment method, add-on or auto-recharge setting is changed by this collector.

Relevant provider documentation: [legacy limits](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-legacy-plans/legacy-pricing-plans/),
[free-tier behavior](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-legacy-plans/billing-faq-for-legacy-plans/#free-tier-limits),
[Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/).

Install and test with `npm ci --prefix feedback-collection --ignore-scripts` and
`npm test --prefix feedback-collection`. The root `netlify.toml` publishes only
`feedback-site/`; function sources remain outside that static directory. Configure
`EINSTEIN_FEEDBACK_RELAY_SECRET` securely in Netlify and the app host, and set
`EINSTEIN_FEEDBACK_FREE_ALLOWANCE_VERIFIED=true` on the app only after checking the
actual plan. Never put an environment file or secret into a publish directory.

Deploy this existing site without a cloud build:

```sh
npm exec --yes --package=netlify-cli@27.13.0 -- netlify deploy --prod --no-build \
  --site 162078b9-2f18-4c0a-9ede-e5f3490ec438 \
  --dir feedback-site --functions feedback-collection/functions
```

The older CAPTCHA form remains available as a separate fallback. A direct server
delivery/readback proves the collection path, not a public app browser flow.
Release acceptance must submit a labelled engineering test through the final
public app and compare it with authenticated owner readback.

The existing site also serves the original character as immutable 4 MiB chunks.
Run `python3 scripts/prepare_character_cdn.py` after verifying the pinned release
inputs, then use the same deployment command above. Generated chunks are ignored
by Git; their sizes and SHA-256 hashes are committed in
`rehearsal/src/character-transfer.json`. The public app checks every chunk and the
assembled model before parsing. Local origins retain the original GLB loader.
No geometry, textures, morph targets, rig or animation bytes are changed.

Character delivery uses the existing shared free bandwidth allowance. A fresh
uncached load transfers 55 MB; browser caching reduces repeat transfers. The
collector's authenticated function and private Blobs store remain separate from
the public static chunks. Do not place feedback records or credentials there.
