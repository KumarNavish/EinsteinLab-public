"""Explicit Linux CI conversion of the authored public walkthrough fixture.

Not part of ordinary offline unit tests. Requires the reviewed native closure
and executes the same confined converter as production, without provider calls.
"""
import hashlib
import json
import os
from pathlib import Path
import sys
import time

import pytest

from lab_backend import presentation


@pytest.mark.skipif(os.environ.get('EINSTEIN_TEST_NATIVE_RUNTIME') != '1', reason='Explicit native Linux runtime check only')
def test_authored_two_slide_chart_walkthrough_converts_in_production_sandbox():
    assert sys.platform == 'linux', 'The native runtime check must execute on Linux'
    fixture = Path(__file__).resolve().parents[2] / 'qa/public-acceptance/fixtures/steering-walkthrough.pptx'
    data = fixture.read_bytes()
    assert hashlib.sha256(data).hexdigest() == 'd979e97fad001a8ab06a6461e8033b523937193009bc19db891ee7d39b8878ca'
    assert presentation.validate_pptx(data) == 2
    runtime = presentation.installed_runtime()
    assert runtime.system == 'linux-native'
    started = time.monotonic()
    pdf = presentation.PresentationConverter().convert(data)
    assert pdf.startswith(b'%PDF-') and 8 <= len(pdf) <= presentation.MAX_PDF
    # convert() additionally checks the native pdfinfo page count equals two
    # and removes the temporary directory before it returns.
    print(json.dumps({'native_two_slide_chart_conversion': 'passed', 'pages': 2,
                      'seconds': round(time.monotonic() - started, 3), 'pdf_bytes': len(pdf),
                      'pdf_sha256': hashlib.sha256(pdf).hexdigest(), 'provider_calls': 0}))
