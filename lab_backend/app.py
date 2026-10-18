"""Loopback-only service with validated answers and incremental local voice output."""
from __future__ import annotations
import asyncio
import base64
import binascii
import json
import os
import queue
import threading
import time
from collections import OrderedDict
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from .knowledge import Knowledge, evidence_answer
from .runtime import LocalRuntime, GenerationCancelled

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "lab_backend/data/lab.json"
runtime = LocalRuntime(ROOT)
state_lock = threading.Lock()
session_epochs = {}
active_requests = {}
histories = OrderedDict()
receipts = OrderedDict()
knowledge = None


@asynccontextmanager
async def lifespan(app):
    get_knowledge()
    if os.getenv("EINSTEIN_PRELOAD", "1") == "1":
        await run_in_threadpool(runtime.warmup)
        started = time.perf_counter()
        # The authored opening is explicitly labelled prepared. It is not disguised as live reasoning.
        await run_in_threadpool(runtime.synthesize_reply, prepared_opening(get_knowledge())["answer"], "expressive")
        runtime.warmup_info["prepared_opening_seconds"] = round(time.perf_counter() - started, 3)
    yield


app = FastAPI(title="Einstein Lab — local rehearsal", docs_url="/api/docs", redoc_url=None,
              lifespan=lifespan)


def get_knowledge():
    global knowledge
    if knowledge is None:
        if not DATA.is_file():
            raise HTTPException(503, "Knowledge snapshot missing. Run the ingestion command.")
        knowledge = Knowledge.load(DATA)
    return knowledge


class Turn(BaseModel):
    session_id: str = Field(min_length=8, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    request_id: str = Field(min_length=8, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    question: str = Field(default="", max_length=700)
    audio_base64: str = Field(default="", max_length=8_400_000)
    speak: bool = True
    evidence_only: bool = False
    voice_mode: Literal["expressive", "fast"] = "expressive"
    opening: bool = False


class Cancel(BaseModel):
    session_id: str = Field(min_length=8, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    request_id: str | None = Field(default=None, min_length=8, max_length=80,
                                    pattern=r"^[a-zA-Z0-9_-]+$")


@app.middleware("http")
async def safety_headers(request: Request, call_next):
    if request.headers.get("origin"):
        from urllib.parse import urlparse
        if urlparse(request.headers["origin"]).netloc != request.headers.get("host"):
            return JSONResponse({"detail": "Cross-origin request refused"}, status_code=403)
    try:
        if int(request.headers.get("content-length", "0")) > 8_500_000:
            return JSONResponse({"detail": "Request too large"}, status_code=413)
    except ValueError:
        return JSONResponse({"detail": "Invalid content length"}, status_code=400)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "microphone=(self), camera=(), geolocation=()"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/health")
def health():
    k = get_knowledge()
    return {"status": "ready", "mode": "local-only", **runtime.capabilities(),
            "pages": len(k.snapshot["pages"]), "chunks": len(k.chunks),
            "snapshot_at": k.snapshot.get("fetched_at"), "coverage": k.snapshot.get("coverage"),
            "avatar_hardware_verified": False}


@app.get("/api/sources")
def sources():
    k = get_knowledge()
    return {"pages": [{key: p.get(key) for key in ("url", "title", "fetched_at", "text_sha256")}
                      for p in k.snapshot["pages"]],
            "skipped": k.snapshot.get("skipped", []), "queued_remaining": k.snapshot.get("queued_remaining", 0)}


@app.post("/api/cancel")
def cancel(body: Cancel):
    with state_lock:
        if body.request_id is not None and active_requests.get(body.session_id) != body.request_id:
            return {"cancelled": False, "scope": "That request is no longer active; newer requests are unchanged."}
        session_epochs[body.session_id] = session_epochs.get(body.session_id, 0) + 1
    return {"cancelled": True, "scope": "Playback stops immediately in the client; local generation checks cancellation between tokens and speech segments."}


def prepared_opening(k: Knowledge) -> dict:
    page = next((p for p in k.snapshot["pages"] if p["url"].rstrip("/") in
                 ("https://mobililab.ethz.ch", "https://mobiliarlab.ethz.ch")), None)
    if page is None:
        raise HTTPException(503, "The prepared introduction needs the official lab home-page snapshot")
    import hashlib
    source = {"id": hashlib.sha256(page["text"].encode()).hexdigest()[:12], "url": page["url"],
              "title": page["title"], "excerpt": page["text"], "fetched_at": page.get("fetched_at"),
              "text_sha256": page.get("text_sha256")}
    return {"answer": "Good evening. I am a digital interpretation of Albert Einstein. The questions in this lab, however, are very real. How do we use AI without exhausting the people it serves? When should a machine act for us, and when should we insist on thinking for ourselves? The Mobiliar Lab brings computing together with behavioural and cognitive science to study responsible AI and mixed reality. Let us begin with a question: what should tomorrow's technology make better for people?",
            "sources": [source], "mode": "prepared-introduction",
            "disclosure": "Authored opening, not spontaneous language-model output or a historical quotation."}


def run_turn(body: Turn, emit=None, disconnected=None):
    started = time.perf_counter()
    key = (body.session_id, body.request_id)
    with state_lock:
        if key in receipts:
            result = receipts[key]
            if emit:
                emit({"event": "replay", **result})
            return result
        epoch = session_epochs.setdefault(body.session_id, 0)
        history = list(histories.get(body.session_id, []))
    if not runtime.lock.acquire(blocking=False):
        raise HTTPException(429, "The local runtime is finishing another turn; please retry shortly.")

    def cancelled():
        if disconnected is not None and disconnected.is_set():
            return True
        with state_lock:
            return session_epochs.get(body.session_id) != epoch

    def event(value):
        if emit:
            emit({**value, "request_id": body.request_id,
                  "elapsed_ms": round((time.perf_counter() - started) * 1000, 1)})

    try:
        with state_lock:
            epoch = session_epochs.setdefault(body.session_id, 0)
            active_requests[body.session_id] = body.request_id
        question = body.question.strip()
        timings = {}
        if body.audio_base64:
            try:
                audio = base64.b64decode(body.audio_base64, validate=True)
            except binascii.Error:
                raise HTTPException(400, "Invalid base64 audio")
            if len(audio) > 6_000_000:
                raise HTTPException(413, "Audio too large")
            event({"event": "state", "state": "transcribing"})
            t = time.perf_counter()
            try:
                question = runtime.transcribe(audio)
            except ValueError as error:
                raise HTTPException(400, str(error))
            except Exception as error:
                raise HTTPException(503, "Local transcription unavailable: " + type(error).__name__)
            timings["stt_ms"] = round((time.perf_counter() - t) * 1000, 1)
            event({"event": "transcript", "question": question})
        if body.opening:
            question = "Prepared introduction"
        if not question:
            raise HTTPException(400, "No speech or question was detected")
        if cancelled():
            raise GenerationCancelled()
        k = get_knowledge()
        t = time.perf_counter()
        retrieved = [] if body.opening else k.search(question, history[-1]["question"] if history else "")
        timings["retrieval_ms"] = round((time.perf_counter() - t) * 1000, 1)
        event({"event": "state", "state": "answering"})
        t = time.perf_counter()
        result = (prepared_opening(k) if body.opening else
                  evidence_answer(question, retrieved) if body.evidence_only else
                  runtime.answer(question, retrieved, history, cancelled=cancelled))
        timings["answer_ms"] = round((time.perf_counter() - t) * 1000, 1)
        if cancelled():
            raise GenerationCancelled()
        result.update(question=question, request_id=body.request_id, session_id=body.session_id)
        event({"event": "answer", **result})
        t = time.perf_counter()
        wav, cues, engine, kind = b"", [], None, None
        audio_error = None
        first_audio = None

        def audio_event(value):
            nonlocal first_audio
            if first_audio is None:
                first_audio = round((time.perf_counter() - started) * 1000, 1)
            event(value)

        if body.speak:
            try:
                wav, cues, engine, kind = runtime.synthesize_reply(result["answer"], body.voice_mode,
                                                                  emit=audio_event, cancelled=cancelled)
            except GenerationCancelled:
                raise
            except Exception as error:
                audio_error = type(error).__name__
        timings["tts_ms"] = round((time.perf_counter() - t) * 1000, 1)
        timings["server_first_audio_ms"] = first_audio
        timings["server_total_ms"] = round((time.perf_counter() - started) * 1000, 1)
        if cancelled():
            raise GenerationCancelled()
        result.update(audio_base64=base64.b64encode(wav).decode(), audio_mime="audio/wav",
                      audio_error=audio_error, timings=timings, voice_engine=engine,
                      lipsync_kind=kind, mouthCues=cues, visemes_json=json.dumps({"mouthCues": cues}),
                      additional_api_cost_usd=0,
                      persona_disclosure="Synthetic Einstein-inspired portrayal, not historical speech or personal endorsement.")
        with state_lock:
            histories[body.session_id] = (history + [{"question": question, "answer": result["answer"]}])[-6:]
            histories.move_to_end(body.session_id)
            while len(histories) > 32:
                old, _ = histories.popitem(last=False)
                session_epochs.pop(old, None)
            receipts[key] = result
            while len(receipts) > 16:
                receipts.popitem(last=False)
        event({"event": "done", "timings": timings, "audio_error": audio_error,
               "voice_engine": engine, "lipsync_kind": kind})
        return result
    except GenerationCancelled:
        raise HTTPException(409, "Turn interrupted")
    finally:
        with state_lock:
            if active_requests.get(body.session_id) == body.request_id:
                active_requests.pop(body.session_id, None)
        runtime.lock.release()


@app.post("/api/turn")
async def turn(body: Turn):
    return await run_in_threadpool(run_turn, body)


@app.post("/api/turn/stream")
async def stream_turn(body: Turn, request: Request):
    events = queue.Queue()
    disconnected = threading.Event()

    def produce():
        try:
            run_turn(body, emit=events.put, disconnected=disconnected)
        except HTTPException as error:
            events.put({"event": "error", "status": error.status_code, "detail": error.detail})
        except Exception as error:
            events.put({"event": "error", "status": 500, "detail": type(error).__name__})
        finally:
            events.put(None)

    async def deliver():
        task = asyncio.create_task(run_in_threadpool(produce))
        try:
            while True:
                if await request.is_disconnected():
                    disconnected.set()
                    break
                try:
                    value = await run_in_threadpool(events.get, True, .2)
                except queue.Empty:
                    continue
                if value is None:
                    break
                yield json.dumps(value, ensure_ascii=False) + "\n"
        finally:
            disconnected.set()
            # The producer observes cancellation; retain its task until it releases ownership.
            await asyncio.shield(task)

    return StreamingResponse(deliver(), media_type="application/x-ndjson",
                              headers={"X-Accel-Buffering": "no"})


web = ROOT / "rehearsal/dist"
if web.is_dir():
    app.mount("/", StaticFiles(directory=web, html=True), name="rehearsal")
else:
    @app.get("/")
    def root():
        return {"message": "Build rehearsal/ to enable the browser interface.", "docs": "/api/docs"}
