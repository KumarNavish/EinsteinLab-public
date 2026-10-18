"""Same-origin deployment entry point; no Apple/local-model runtime is imported.

Run one worker: uvicorn lab_backend.public_service:create_app --factory --host 0.0.0.0 --port $PORT
The existing local presence_service remains available for the Mac experience.
"""
from __future__ import annotations

import asyncio
import json
import os
import posixpath
from pathlib import Path
import time

from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .public_sessions import COOKIE, DeploymentConfig, UsageBudget, Visitors, public_origin
from .public_transport import RenewableWebSocket, redact_transport_logs
from .http_body import bounded_body

ROOT = Path(__file__).resolve().parent.parent


def create_app(root=ROOT, *, origin=None, bridge_factory=None, private_qa=False, private_assets=False, lab_knowledge=None):
    redact_transport_logs()
    origin, allowed = public_origin(origin or os.environ.get('EINSTEIN_PUBLIC_ORIGIN', ''), private_qa=private_qa)
    assets_cleared = os.environ.get('EINSTEIN_ASSET_DISTRIBUTION_APPROVED') == 'true'
    health_config = None
    if bridge_factory is None:
        from .knowledge import Knowledge
        from .native_knowledge import NativeKnowledge
        from .native_live import NativeBridge
        from .live_lab import LiveLabLookup
        from .flash_research import FlashResearch
        from .page_vision import PageInspector
        provider = os.environ.get('EINSTEIN_PROVIDER', 'google')
        if provider not in {'google', 'openai'}:
            raise ValueError('Choose an explicitly supported public provider.')
        config_type = DeploymentConfig
        if provider == 'openai':
            from .openai_config import OpenAIDeploymentConfig
            from .openai_live import openai_session
            config_type = OpenAIDeploymentConfig
        health_config = config_type(root)
        index = Knowledge.load(root / 'lab_backend/data/lab.json')
        knowledge = NativeKnowledge(root, index.search)
        knowledge.lookup_current = LiveLabLookup(knowledge).lookup
        lab_knowledge = knowledge

        def bridge_factory():
            config = config_type(root)
            if provider == 'openai':
                researcher = FlashResearch(root, config, knowledge, provider='openai', model='gpt-6.1-sol')
                return NativeBridge(root, knowledge, session_factory=openai_session,
                                    researcher=researcher, config=config, origin_check=allowed,
                                    page_inspector_factory=lambda credential: PageInspector(
                                        credential, provider='openai', model='gpt-6.1-sol'))
            researcher = FlashResearch(root, config, knowledge)
            return NativeBridge(root, knowledge, researcher=researcher, config=config, origin_check=allowed)

    app = FastAPI(title='Einstein', docs_url=None, redoc_url=None, openapi_url=None)
    from .feedback_delivery import configured_feedback
    feedback_delivery = configured_feedback()
    budget = UsageBudget(Path(os.environ.get('EINSTEIN_USAGE_PATH', str(root / '.work/private/public-usage.sqlite3'))))
    visitors = Visitors(bridge_factory, budget)
    app.state.visitors = visitors

    @app.middleware('http')
    async def boundaries(request: Request, call_next):
        if not allowed(request.headers.get('host', ''), request.headers.get('origin')):
            return JSONResponse({'detail': 'This request came from a different site.'}, status_code=403)
        if request.method not in {'GET', 'HEAD'} and request.headers.get('origin') != origin:
            return JSONResponse({'detail': 'Same-origin request required.'}, status_code=403)
        try:
            size = int(request.headers.get('content-length', '0'))
            if size < 0 or size > 8_500_000:
                return JSONResponse({'detail': 'Request too large.'}, status_code=413)
        except ValueError:
            return JSONResponse({'detail': 'Invalid request length.'}, status_code=400)
        normalized_path = posixpath.normpath('/' + request.url.path.lstrip('/')).lower()
        if normalized_path.startswith('/assets/') and normalized_path.endswith(('.glb', '.bin', '.gltf')) and not (private_qa or private_assets or assets_cleared):
            return JSONResponse({'detail': 'Character publication has not been enabled by the operator.'}, status_code=503)
        response = await call_next(request)
        response.headers.update({
            'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
            'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()',
            'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' blob: https://einstein-mobiliar-lab.netlify.app/character/0fdd4280d69169c93e69f3586b8956077223d1178523acc028b46c1b31ba89fc/; worker-src 'self' blob:; font-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        })
        if not private_qa:
            response.headers['Strict-Transport-Security'] = 'max-age=31536000'
        if request.url.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
        elif response.headers.get('content-type', '').startswith('text/html') or request.url.path.startswith('/audio/'):
            response.headers['Cache-Control'] = 'no-cache'
        return response

    def visitor(request, create=False):
        try:
            network = visitors.network(request.client.host if request.client else 'unknown')
            return visitors.get(request.cookies.get(COOKIE), create=create, network=network)
        except ValueError as error:
            raise HTTPException(429 if create else 401, str(error))

    @app.get('/api/health')
    async def health():
        configured = health_config is None or health_config.status()['available']
        return {'status': 'ready', 'mode': 'public-native', 'stt_available': configured,
                'tts_available': configured, 'expressive_voice_available': configured, 'llm_available': configured,
                'voice_configured': configured,
                'local_mode_available': False, 'public_deployment': True,
                'native_audio_default': True, 'maximum_concurrent_sessions': visitors.capacity,
                'daily_session_reservations': budget.daily_sessions,
                'feedback_inline': feedback_delivery is not None,
                'session_max_seconds': 600, 'avatar_distribution_approved': assets_cleared,
                'feedback_url': ('https://einstein-mobiliar-lab.netlify.app/'
                                 if os.getenv('EINSTEIN_FEEDBACK_URL') == 'https://einstein-mobiliar-lab.netlify.app/' else None),
                'usage_storage': 'operator-configured SQLite; free-host filesystem may be ephemeral'}

    @app.get('/api/native/status')
    async def status(request: Request):
        token, bridge = visitor(request, create=True)
        result = await bridge.status(request)
        channel = getattr(bridge, 'public_channel', None)
        if channel is not None:
            result['voice_transport'] = channel.status()
        response = JSONResponse({**result, 'public_deployment': True, 'local_mode_available': False,
                                 **visitors.room_status()})
        response.set_cookie(COOKIE, token, max_age=1800, httponly=True,
                            secure=not private_qa, samesite='strict', path='/')
        return response

    @app.post('/api/native/permit')
    async def permit(request: Request):
        _, bridge = visitor(request)
        return {**(await bridge.permit(request)), 'transport': 'renewable-websocket'}

    @app.post('/api/lab/answer')
    async def lab_answer(request: Request):
        # Public website facts need no visitor session, provider key or budget.
        # Fresh checks and synthesis deliberately stay with the normal route.
        try:
            payload = json.loads(await bounded_body(request, 2500))
            if (not isinstance(payload, dict) or set(payload) != {'question'}
                    or not isinstance(payload['question'], str)
                    or not 1 <= len(payload['question'].strip()) <= 700):
                raise ValueError
        except (ValueError, UnicodeDecodeError):
            raise HTTPException(422, 'Provide one question of up to 700 characters.') from None
        if lab_knowledge is None:
            return {'status': 'model-required'}
        began = time.perf_counter()
        result = await asyncio.to_thread(lab_knowledge.quick_answer, payload['question'])
        if result is None:
            return {'status': 'model-required'}
        return {**result, 'status': 'source-fact',
                'lookup_ms': round((time.perf_counter() - began) * 1000, 2)}

    async def serve_channel(bridge, channel, token, text_only=False):
        previous_receipt = getattr(bridge, 'last_session', None)
        try:
            if text_only: await bridge.text(channel)
            else: await bridge.voice(channel)
        except Exception:
            # Startup acceptance can fail before NativeBridge enters its own
            # cleanup. Never let a detached task log an exception or its input.
            if getattr(bridge, 'last_session', None) is previous_receipt:
                bridge.last_session = {'outcome': 'browser_transport_failure',
                    'error_code': 'browser_transport_failure',
                    'transcripts_saved': False, 'microphone_audio_saved': False}
            else:
                bridge.last_session['transport_error_code'] = 'browser_transport_failure'
        finally:
            bridge.active = False
            bridge.active_voice = bridge.active_accent = None
            try:
                await channel.close()
            finally:
                if getattr(bridge, 'last_session', None) is not None:
                    bridge.last_session['transport'] = channel.status()
                visitors.leave(token)

    @app.websocket('/api/native/voice')
    async def voice(socket: WebSocket):
        await open_channel(socket)

    @app.websocket('/api/native/text')
    async def text(socket: WebSocket):
        await open_channel(socket, text_only=True)

    async def open_channel(socket: WebSocket, text_only=False):
        if socket.headers.get('origin') != origin or not allowed(socket.headers.get('host', ''), socket.headers.get('origin')):
            await socket.close(code=1008)
            return
        token = socket.cookies.get(COOKIE)
        try:
            _, bridge = visitors.get(token)
            pending = bridge.config.permits.get(socket.query_params.get('permit', ''))
            if pending is None or pending <= time.monotonic():
                raise ValueError('The connection permit expired.')
            if getattr(bridge, 'text_permits', {}).get(socket.query_params.get('permit', ''), False) is not text_only:
                raise ValueError('The permit belongs to another conversation mode.')
            network = visitors.network(socket.client.host if socket.client else 'unknown')
            visitors.enter(token, network)
        except ValueError:
            await socket.close(code=1013)
            return
        if socket.query_params.get('carrier') == 'renew-v1':
            channel = RenewableWebSocket(socket)
            bridge.public_channel = channel
            bridge.public_channel_task = asyncio.create_task(serve_channel(bridge, channel, token, text_only))
            await channel.hold(socket)
            return
        try:
            if text_only: await bridge.text(socket)
            else: await bridge.voice(socket)
        finally:
            visitors.leave(token)

    @app.websocket('/api/native/renew')
    async def renew(socket: WebSocket):
        if socket.headers.get('origin') != origin or not allowed(socket.headers.get('host', ''), socket.headers.get('origin')):
            await socket.close(code=1008)
            return
        try:
            _, bridge = visitors.get(socket.cookies.get(COOKIE))
            channel = getattr(bridge, 'public_channel', None)
            after = int(socket.query_params.get('after', ''))
        except (ValueError, TypeError):
            await socket.close(code=1008)
            return
        if channel is None:
            await socket.close(code=1008)
            return
        if await channel.renew(socket, socket.query_params.get('permit'), after):
            await channel.hold(socket)

    # Only a session-authenticated converter is mounted; public configuration,
    # legacy local model/cancel/history endpoints are intentionally absent.
    from .presentation import presentation_router
    app.include_router(presentation_router(authorize=lambda request: visitor(request)))
    from .paper_retrieval import paper_router
    app.include_router(paper_router(authorize=lambda request: visitor(request)))
    from .feedback import feedback_router
    feedback, _ = feedback_router(root, delivery=feedback_delivery, require_delivery=True)
    app.include_router(feedback)

    static = root / 'rehearsal/dist'
    if static.is_dir():
        app.mount('/', StaticFiles(directory=static, html=True), name='website')
    return app


# The ASGI factory validates configuration before serving any requests. Importing
# this module alone never initializes a credential, a model, or a source fetch.
