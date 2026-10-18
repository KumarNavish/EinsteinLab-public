"""Hugging Face's documented custom-Python frontend on Gradio SDK port 7860.

No GPU function or paid HF inference endpoint is used. The app archive contains
only reviewed code, built frontend and the private character; never credentials.
"""
import hashlib
import os
from pathlib import Path
import sys
import tarfile

import uvicorn

base = Path(__file__).resolve().parent
archive = base / 'einstein-app.tar.gz'
expected = (base / 'bundle.sha256').read_text().split()[0]
if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
    raise RuntimeError('The application artifact failed its integrity check.')
runtime = base / '.runtime'
runtime.mkdir(exist_ok=True)
with tarfile.open(archive, 'r:gz') as bundle:
    members = bundle.getmembers()
    if sum(item.size for item in members) > 200_000_000 or len(members) > 256:
        raise RuntimeError('Application archive exceeds its build budget.')
    if any(not item.isfile() or item.name.startswith('/') or '..' in Path(item.name).parts for item in members):
        raise RuntimeError('Application archive contains an unexpected entry.')
    bundle.extractall(runtime, members=members, filter='data')
sys.path.insert(0, str(runtime))

# Check the actual native-tool import path before the longer public crawl.
# This imports code only; no credential or provider connection is initialized.
from lab_backend import native_live

# Generated source cache stays in the runtime filesystem, outside the repository.
# This is the established official-lab HTML reader, not an inference call.
snapshot = runtime / 'lab_backend/data/lab.json'
if not snapshot.exists():
    from lab_backend.ingest import crawl
    crawl(snapshot, limit=120)

if not os.environ.get('EINSTEIN_PUBLIC_ORIGIN'):
    os.environ['EINSTEIN_PUBLIC_ORIGIN'] = 'https://' + os.environ['SPACE_HOST']

from lab_backend.public_service import create_app
app = create_app(runtime, private_assets=os.environ.get('EINSTEIN_PRIVATE_STAGING') == 'true')
uvicorn.run(app, host='0.0.0.0', port=7860, workers=1, ws_max_size=524288,
            ws_max_queue=4, access_log=False)
