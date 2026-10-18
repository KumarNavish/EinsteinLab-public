The manual deployment workflow builds a fresh public bundle from one exact commit already in `KumarNavish/EinsteinLab`'s `main` history. It runs only through `workflow_dispatch` on that repository's `main` workflow. The SHA must be 40 lowercase hexadecimal characters; a detached checkout and ancestry check run before any project code. There is no PR, push or arbitrary branch deployment path.

The operator supplies an app-scoped `FASTAPI_CLOUD_TOKEN` GitHub Actions secret for app `f0faed3c-f408-4423-85bd-e33589d42314`. That secret is available only to the final upload step. Provider keys, billing attestation and runtime feedback configuration stay in the host environment. This preparation does not create or configure any token. A read-only Actions query requires the latest completed push/manual run of the existing Offline Einstein quality workflow for that exact SHA to have succeeded; packaging and frontend tests alone cannot admit backend source.

The workflow retrieves two exact private Release assets from `deploy/release-inputs.json`: the approved optimized GLB and frozen public lab snapshot. Their publication receipt is `evidence/2026-10-16-ci/release-input-assets.json`. The installed GitHub CLI handles authenticated metadata retrieval and release downloads into a fresh temporary directory. The small verifier checks fixed repository/release/asset IDs, names, sizes, publication state and GitHub digests, then exact downloaded byte counts and SHA256 before copying either file. Existing differing files and symlink destinations fail. Permissions are `contents:read` for those assets and `actions:read` for the existing quality receipt. A local byte check needs no credential or network:

    python deploy/fetch_release_inputs.py --verify-only

The current pins reproduce the already-reviewed bytes. They do not promise that a fresh Blender export or a new live crawl produces the same asset. Updating them requires publishing separately reviewed bytes, reading back the Release metadata and committing the new pins and provenance. Release assets remain outside Git history and Actions artifact storage. GitHub documents the per-asset limit and separate Release storage/bandwidth policy in [About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases); the read-only API contract is [Get a release asset](https://docs.github.com/en/rest/releases/assets#get-a-release-asset).

The frontend uses its `package-lock.json`; the host runtime uses the canonical public hash lock plus `deploy/fastapicloud/uv.lock`. This directory's separate frozen environment provides FastAPI `0.143.0`, cloud CLI `0.26.0` and pytest `9.1.1` for CI only. Its lock contains exact versions and public PyPI artifact hashes. The host bundle excludes this account/deployment tooling. The uv bootstrap is pinned by version and the official Linux x86_64 wheel hash. Intentional CI-tool updates use:

    uv lock --project deploy/ci-tools --python /path/to/python3.13 \
      --no-python-downloads --default-index https://pypi.org/simple --keyring-provider disabled --no-build

After focused offline checks and frontend build, the workflow calls the canonical native builder and `--verify-only`, then creates a fresh staging directory under runner temporary storage. The promoted runtime and confined Linux conversion evidence are recorded in `evidence/2026-10-15-presentation/linux-canonical-integration.json`. Its actual fresh-cache local rebuild took 232.762 seconds, including 158,595,648 downloaded bytes and verification of 9,267 regular files totaling 552,947,803 bytes, with native digest `1bf859f031264b8525830a13f3952ad870b0dd39b75b028e72cd7979f40d09c1`. This is a Mac measurement. Missing canonical inputs stop the workflow; no probe artifact is substituted. The whole job has a 15-minute hard limit and no shared caches or artifact uploads. A fresh native rebuild has not yet been timed on a GitHub runner; this limit is a cost bound, not an established release-duration claim.

Immediately before upload, the builder verifies the complete staged inventory against current source hashes, execution modes and symlink targets. Upload targets only that stage and the fixed app. The manifest hash, source commit and sanitized deployment ID are written to the job summary. A failed or interrupted upload is not retried automatically; inspect the host dashboard first because a deployment may already exist.

CLI JSON deployment mode returns after submission. A green workflow means validated input was submitted, not that the host is healthy or visitors passed acceptance. Authenticated deployment readback and the separately approved bounded public acceptance harness must establish those results. The prepared harness at `.work/public-acceptance/` remains unrun until `PUBLIC READY`; it is not dispatched by this workflow. See the hosting [deploy contract](https://fastapicloud.com/docs/fastapi-cloud-cli/deploy/) and [deploy-token guidance](https://fastapicloud.com/docs/advanced-features/deploy-tokens/).

Once the workflow and selected source are merged to `main`, the operator can request a manual run with the exact merged SHA:

    gh workflow run manual-deploy.yml --repo KumarNavish/EinsteinLab --ref main \
      -f commit=EXACT_40_CHARACTER_MERGED_COMMIT_SHA

Local isolated validation, without a provider or release download:

    python -m pytest deploy/test_release_inputs.py deploy/fastapicloud/test_bundle.py -q
    actionlint -no-color .github/workflows/manual-deploy.yml
