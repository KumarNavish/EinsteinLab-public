FROM node:24-bookworm-slim AS frontend
WORKDIR /build/rehearsal
COPY rehearsal/package.json rehearsal/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY rehearsal/ ./
# The private derivative is intentionally absent from Git until rights are clear.
# Fail the build rather than deploying a missing/replacement character.
RUN test -s public/assets/einstein.glb && npm run build

FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-impress libreoffice-calc poppler-utils bubblewrap \
    fonts-dejavu-core fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY lab_backend/requirements-public.lock ./requirements-public.lock
RUN pip install --no-cache-dir --require-hashes -r requirements-public.lock
COPY lab_backend/ ./lab_backend/
# Fetch only the established official public HTML crawler, respecting robots.
# No account, model, user upload or credential is involved in this build step.
RUN python -m lab_backend.ingest --limit 120
COPY --from=frontend /build/rehearsal/dist ./rehearsal/dist
RUN useradd --create-home --uid 10001 einstein && chown -R einstein:einstein /app
USER einstein
EXPOSE 7860
# One worker is required for in-memory visitor ownership and the global room cap.
CMD ["sh", "-c", "exec uvicorn lab_backend.public_service:create_app --factory --host 0.0.0.0 --port ${PORT:-7860} --workers 1 --ws-max-size 524288 --ws-max-queue 4 --no-access-log"]
