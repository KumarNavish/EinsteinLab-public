"""Character-first service with an explicitly gated optional native audio route.

Run explicitly with: uvicorn lab_backend.presence_service:app --host 127.0.0.1 --port 8766
The legacy app source, network policy and turn-ownership implementation are unchanged.
"""
from . import app as service
from .source_loader import load_sources
from .release_host import ReleaseHost

service.runtime = ReleaseHost(service.ROOT)
service.knowledge, service.runtime.source_backend = load_sources(service.ROOT)
app = service.app

# Install explicit optional native routes before the static catch-all route.
from starlette.routing import Mount
from .native_knowledge import NativeKnowledge
from .native_live import NativeBridge
from .flash_research import FlashResearch
from .live_lab import LiveLabLookup
from .native_config import NativeConfig

native_knowledge = NativeKnowledge(service.ROOT, service.knowledge.search)
live_lab = LiveLabLookup(native_knowledge)
native_knowledge.lookup_current = live_lab.lookup
flash_research = FlashResearch(service.ROOT, NativeConfig(service.ROOT), native_knowledge)
native_bridge = NativeBridge(service.ROOT, native_knowledge, researcher=flash_research)
static_routes = [route for route in app.router.routes if isinstance(route, Mount) and route.path == ""]
for route in static_routes:
    app.router.routes.remove(route)
app.include_router(native_bridge.router)
from .feedback import feedback_router
feedback_api, feedback_store = feedback_router(service.ROOT)
app.include_router(feedback_api)
app.router.routes.extend(static_routes)
