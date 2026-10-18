"""Keyless public ASGI entrypoint. All operator values come from host environment."""
import os
from pathlib import Path

from lab_backend.public_service import create_app

origin = os.environ.get('EINSTEIN_PUBLIC_ORIGIN')
if not origin:
    raise RuntimeError('Set the exact public HTTPS EINSTEIN_PUBLIC_ORIGIN on the host.')

# The existing converter discovers deploy/native itself. This entrypoint neither
# downloads a runtime nor enables a private-asset or provider-consent bypass.
app = create_app(Path(__file__).resolve().parent, origin=origin)
