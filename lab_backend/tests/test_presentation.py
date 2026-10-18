"""Offline safety checks. The deck is an authored synthetic vector/chart fixture."""
import io
from pathlib import Path
import zipfile
from xml.sax.saxutils import quoteattr

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
import pytest

from lab_backend import presentation as module


def fixture_deck(extra=None, *, slide_count=1):
    parts = {
        "[Content_Types].xml": f'''<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="{module.PRESENTATION_TYPE}"/><Override PartName="/ppt/slides/slide1.xml" ContentType="{module.SLIDE_TYPE}"/><Override PartName="/ppt/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>''',
        "_rels/.rels": f'''<Relationships xmlns="{module.REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>''',
        "ppt/presentation.xml": f'''<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>{''.join(f'<p:sldId id="{256+i}" r:id="rId{i+1}"/>' for i in range(slide_count))}</p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>''',
        "ppt/_rels/presentation.xml.rels": f'''<Relationships xmlns="{module.REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>''',
        "ppt/slides/slide1.xml": '''<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Synthetic title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="450000" y="300000"/><a:ext cx="8000000" cy="800000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="3000"><a:solidFill><a:srgbClr val="253F37"/></a:solidFill></a:rPr><a:t>Synthetic deck: mechanism and chart</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Mechanism input"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="450000" y="1800000"/><a:ext cx="1800000" cy="900000"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="3F5C48"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="2200"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>Input</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="4" name="Mechanism arrow"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="2400000" y="2050000"/><a:ext cx="1200000" cy="400000"/></a:xfrm><a:prstGeom prst="rightArrow"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="B66B37"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="5" name="Mechanism output"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="3750000" y="1800000"/><a:ext cx="1800000" cy="900000"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="416C91"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="2200"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>Outcome</a:t></a:r></a:p></p:txBody></p:sp>
<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="Native cached bar chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="5800000" y="1300000"/><a:ext cx="2800000" cy="3000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rIdChart"/></a:graphicData></a:graphic></p:graphicFrame>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>''',
        "ppt/slides/_rels/slide1.xml.rels": f'''<Relationships xmlns="{module.REL_NS}"><Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>''',
        "ppt/charts/chart1.xml": '''<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Synthetic values</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="416C91"/></a:solidFill></c:spPr><c:cat><c:strLit><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strLit></c:cat><c:val><c:numLit><c:formatCode>0</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>2</c:v></c:pt><c:pt idx="1"><c:v>5</c:v></c:pt></c:numLit></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:crossAx val="2"/><c:crosses val="autoZero"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:numFmt formatCode="0" sourceLinked="0"/><c:crossAx val="1"/><c:crosses val="autoZero"/></c:valAx></c:plotArea><c:plotVisOnly val="1"/></c:chart></c:chartSpace>''',
    }
    parts.update(extra or {})
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in parts.items():
            archive.writestr(name, data)
    return output.getvalue()


def test_native_chart_and_diagram_deck_passes_preflight():
    assert module.validate_pptx(fixture_deck()) == 1


def workbook_fixture(extra=None, *, formula=False):
    parts = {
        "[Content_Types].xml": f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="{module.WORKBOOK_TYPE}"/></Types>',
        "_rels/.rels": f'<Relationships xmlns="{module.REL_NS}"><Relationship Id="rId1" Type="{module.OFFICE_REL}officeDocument" Target="xl/workbook.xml"/></Relationships>',
        "xl/workbook.xml": '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>',
        "xl/_rels/workbook.xml.rels": f'<Relationships xmlns="{module.REL_NS}"><Relationship Id="rId1" Type="{module.OFFICE_REL}worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
        "xl/worksheets/sheet1.xml": '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1">' + ('<f>SUM(A2:A3)</f>' if formula else '') + '<v>2</v></c></row></sheetData></worksheet>',
    }
    parts.update(extra or {})
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in parts.items():
            archive.writestr(name, data)
    return output.getvalue()


def chart_workbook_deck(workbook=None):
    return fixture_deck({
        "ppt/embeddings/chart-data.xlsx": workbook if workbook is not None else workbook_fixture(),
        "ppt/charts/_rels/chart1.xml.rels": f'<Relationships xmlns="{module.REL_NS}"><Relationship Id="rIdData" Type="{module.OFFICE_REL}package" Target="../embeddings/chart-data.xlsx"/></Relationships>',
    })


def test_chart_values_workbook_is_recursively_inspected_and_accepted():
    assert module.validate_pptx(chart_workbook_deck()) == 1


@pytest.mark.parametrize("workbook", [
    workbook_fixture({"xl/vbaProject.bin": b"macro"}),
    workbook_fixture({"../outside.xml": b"<x/>"}),
    workbook_fixture({"xl/embeddings/next.xlsx": b"nested"}),
    workbook_fixture({"xl/externalLinks/link1.xml": b"<x/>"}),
    workbook_fixture(formula=True),
    workbook_fixture({"xl/_rels/workbook.xml.rels": f'<Relationships xmlns="{module.REL_NS}"><Relationship Id="rId1" Type="{module.OFFICE_REL}hyperlink" Target="https://example.test/" TargetMode="External"/></Relationships>'}),
    b"not a workbook ZIP",
])
def test_unsafe_or_complex_chart_workbook_is_rejected(workbook):
    with pytest.raises(module.PresentationError):
        module.validate_pptx(chart_workbook_deck(workbook))


def test_nested_expansion_uses_the_outer_package_budget(monkeypatch):
    workbook = workbook_fixture()
    deck = chart_workbook_deck(workbook)
    def expanded(data):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            return sum(part.file_size for part in archive.infolist())
    monkeypatch.setattr(module, "MAX_EXPANDED", expanded(deck) + expanded(workbook) - 1)
    with pytest.raises(module.PresentationError, match="expanded presentation"):
        module.validate_pptx(deck)


@pytest.mark.parametrize("url,accepted", [
    ("https://example.test/paper?q=1#figure", True),
    ("https://example.test:443/paper", True),
    ("http://example.test/paper", False),
    ("https://user:secret@example.test/", False),
    ("https://example.test:invalid/", False),
    ("file:///etc/passwd", False),
    ("javascript:alert(1)", False),
    ("https://example.test/" + "x" * 2048, False),
])
def test_only_bounded_https_citation_hyperlinks_are_allowed(url, accepted):
    deck = fixture_deck({"ppt/slides/_rels/slide1.xml.rels": f'<Relationships xmlns="{module.REL_NS}"><Relationship Id="rIdCitation" Type="{module.OFFICE_REL}hyperlink" Target={quoteattr(url)} TargetMode="External"/></Relationships>'})
    if accepted:
        assert module.validate_pptx(deck) == 1
    else:
        with pytest.raises(module.PresentationError):
            module.validate_pptx(deck)


def test_hyperlinks_do_not_authorize_images_or_other_external_content():
    deck = fixture_deck({"ppt/slides/_rels/slide1.xml.rels": f'<Relationships xmlns="{module.REL_NS}"><Relationship Id="rIdImage" Type="{module.OFFICE_REL}image" Target="https://example.test/image.png" TargetMode="External"/></Relationships>'})
    with pytest.raises(module.PresentationError):
        module.validate_pptx(deck)


@pytest.mark.parametrize("extra", [
    {"../outside.txt": "no"}, {"/tmp/outside.txt": "no"}, {"ppt\\outside.txt": "no"},
    {"ppt/activeX/activeX1.xml": "<x/>"}, {"ppt/vbaProject.bin": "macro"},
    {"ppt/embeddings/object.bin": "embedded"},
    {"ppt/slides/_rels/slide1.xml.rels": f'<Relationships xmlns="{module.REL_NS}"><Relationship Target="https://example.test/track" TargetMode="External"/></Relationships>'},
    {"ppt/slides/_rels/slide1.xml.rels": f'<Relationships xmlns="{module.REL_NS}"><Relationship Target="file:///etc/passwd"/></Relationships>'},
    {"ppt/slides/slide1.xml": '<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]><x>&secret;</x>'},
    {"ppt/media/bomb.bin": b"0" * 1_100_000},
    {"ppt/big.xml": b"<x>" + b"a" * (module.MAX_XML + 1) + b"</x>"},
    {"ppt/media/linked.svg": '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.test/image.png"/></svg>'},
    {"ppt/media/script.svg": '<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>'},
])
def test_unsafe_decks_are_rejected_before_conversion(extra):
    with pytest.raises(module.PresentationError) as raised:
        module.validate_pptx(fixture_deck(extra))
    assert raised.value.status == 422


def test_slide_and_upload_limits():
    for deck in [fixture_deck(slide_count=0), fixture_deck(slide_count=121)]:
        with pytest.raises(module.PresentationError):
            module.validate_pptx(deck)
    with pytest.raises(module.PresentationError) as raised:
        module.validate_pptx(b"x" * (module.MAX_UPLOAD + 1))
    assert raised.value.status == 413


def test_converter_requires_isolation(monkeypatch):
    monkeypatch.setattr(module.shutil, "which", lambda _: None)
    with pytest.raises(module.PresentationError) as raised:
        module.PresentationConverter().convert(fixture_deck())
    assert raised.value.status == 503
    assert "/Users" not in raised.value.message


def test_conversion_cleanup_and_slide_count_guard(monkeypatch):
    workspaces = []
    pages = 1
    runtime = module.Runtime("/synthetic/soffice", "/synthetic/pdfinfo", "/synthetic/sandbox", "darwin")
    monkeypatch.setattr(module, "installed_runtime", lambda: runtime)
    def run(runtime, work, command, deadline, *, capture=False):
        workspaces.append(work)
        if capture:
            return f"Pages: {pages}\n".encode()
        (work / "selected.pdf").write_bytes(b"%PDF-synthetic-test-only")
    monkeypatch.setattr(module, "_run", run)
    converter = module.PresentationConverter()
    assert converter.convert(fixture_deck()).startswith(b"%PDF-")
    assert all(not path.exists() for path in workspaces)
    pages = 2
    with pytest.raises(module.PresentationError, match="expected slide count"):
        converter.convert(fixture_deck())
    assert all(not path.exists() for path in workspaces)
    def failed(*args, **kwargs):
        workspaces.append(args[1])
        raise module.PresentationError(422, "Synthetic failure")
    monkeypatch.setattr(module, "_run", failed)
    with pytest.raises(module.PresentationError):
        converter.convert(fixture_deck())
    assert all(not path.exists() for path in workspaces)
    assert not converter.lock.locked()


def test_one_conversion_at_a_time():
    converter = module.PresentationConverter()
    converter.lock.acquire()
    try:
        with pytest.raises(module.PresentationError) as raised:
            converter.convert(fixture_deck())
        assert raised.value.status == 429
    finally:
        converter.lock.release()


def test_router_requires_session_and_returns_only_pdf():
    class SyntheticConverter:
        def convert(self, data):
            assert data == b"selected-bytes"
            return b"%PDF-synthetic-test-only"
    def authorize(request: Request):
        if request.headers.get("x-test-session") != "allowed":
            raise HTTPException(401, "Authentication required")
    app = FastAPI()
    app.include_router(module.presentation_router(authorize, converter=SyntheticConverter()))
    client = TestClient(app)
    assert client.post("/api/presentation/convert", content=b"x", headers={"content-type": module.MIME}).status_code == 401
    headers = {"content-type": module.MIME, "x-test-session": "allowed"}
    result = client.post("/api/presentation/convert", content=b"selected-bytes", headers=headers)
    assert result.status_code == 200 and result.headers["content-type"] == "application/pdf"
    assert result.headers["cache-control"] == "no-store"
    assert client.post("/api/presentation/convert", content=b"x", headers={**headers, "content-type": "application/json"}).status_code == 415


def test_router_bounds_body_even_without_content_length():
    app = FastAPI()
    app.include_router(module.presentation_router(lambda request: True))
    result = TestClient(app).post("/api/presentation/convert", content=b"x" * (module.MAX_UPLOAD + 1), headers={"content-type": module.MIME})
    assert result.status_code == 413


def test_router_cannot_be_registered_without_authentication():
    with pytest.raises(TypeError):
        module.presentation_router(None)


def test_pdf_output_cannot_follow_converter_symlink(tmp_path):
    private = tmp_path / 'outside-private.pdf'
    private.write_bytes(b'%PDF-private-outside-test-data')
    output = tmp_path / 'selected.pdf'; output.symlink_to(private)
    with pytest.raises(module.PresentationError) as raised:
        module._pdf_output(output)
    assert raised.value.status == 422
    assert private.read_bytes() == b'%PDF-private-outside-test-data'


def test_legacy_capture_rejects_outside_symlink(tmp_path, monkeypatch):
    private = tmp_path / 'outside-private-file'; private.write_bytes(b'protected bytes')
    work = tmp_path / 'work'; work.mkdir()
    (work / 'inspection.txt').symlink_to(private)
    runtime = module.Runtime('/synthetic/soffice', '/synthetic/pdfinfo', '/synthetic/sandbox', 'darwin')
    monkeypatch.setattr(module, '_sandbox_command', lambda runtime, work, command: command)
    monkeypatch.setattr(module.subprocess, 'Popen', lambda *a, **kw: pytest.fail('No child may launch with a planted capture link'))
    with pytest.raises(OSError):
        module._run(runtime, work, ['/synthetic/pdfinfo'], float('inf'), capture=True)
    assert private.read_bytes() == b'protected bytes'


def test_legacy_capture_holds_fd_and_uses_isolated_python(tmp_path, monkeypatch):
    private = tmp_path / 'outside-private-file'; private.write_bytes(b'protected bytes')
    work = tmp_path / 'work'; work.mkdir()
    runtime = module.Runtime('/synthetic/soffice', '/synthetic/pdfinfo', '/synthetic/sandbox', 'darwin')
    class SyntheticChild:
        pid = 19999997
        returncode = 0
        def poll(self): return 0
        def wait(self): return 0
    def launch(command, **kwargs):
        assert command[1:4] == ['-I', '-S', '-c']
        kwargs['stdout'].write(b'Pages: 1\n'); kwargs['stdout'].flush()
        (work / 'inspection.txt').unlink(); (work / 'inspection.txt').symlink_to(private)
        return SyntheticChild()
    monkeypatch.setattr(module, '_sandbox_command', lambda runtime, work, command: command)
    monkeypatch.setattr(module.subprocess, 'Popen', launch)
    monkeypatch.setattr(module.os, 'killpg', lambda *args: None)
    assert module._run(runtime, work, ['/synthetic/pdfinfo'], float('inf'), capture=True) == b'Pages: 1\n'
    assert private.read_bytes() == b'protected bytes'


def test_native_conversion_cleans_work_and_logs_no_document_data(monkeypatch, caplog):
    from lab_backend import presentation_linux as worker
    runtime = module.Runtime('/synthetic/lloconv', '/synthetic/pdfinfo', '', 'linux-native', '/synthetic/native')
    monkeypatch.setattr(module, 'installed_runtime', lambda: runtime)
    calls, workspaces = [], []
    def run(native, work, mode, deadline):
        calls.append(mode); workspaces.append(work)
        if mode == 'office': (work / 'selected.pdf').write_bytes(b'%PDF-synthetic-test-only')
        return b'Pages: 1\n' if mode == 'pdfinfo' else b''
    monkeypatch.setattr(worker, 'run', run)
    caplog.set_level('INFO', logger='uvicorn.error')
    assert module.PresentationConverter().convert(fixture_deck()) == b'%PDF-synthetic-test-only'
    assert calls == ['proof', 'office', 'pdfinfo']
    assert all(not work.exists() for work in workspaces)
    assert [record.getMessage() for record in caplog.records] == ['Presentation converted; temporary work removed']


def test_native_failure_logs_only_static_cause_and_supervisor_numbers(monkeypatch, tmp_path, caplog):
    from lab_backend import presentation_linux as worker
    runtime = module.Runtime('/synthetic/lloconv', '/synthetic/pdfinfo', '', 'linux-native', '/synthetic/native')
    def reject(*args):
        error = worker.ConversionError(code='thread_limit')
        error.metrics = {'elapsed_ms': 2024, 'peak_rss_bytes': 200000000, 'peak_threads': 33,
                         'peak_work_bytes': 120000, 'exit_code': None}
        raise error
    monkeypatch.setattr(worker, 'run', reject)
    caplog.set_level('WARNING', logger='uvicorn.error')
    with pytest.raises(module.PresentationError) as raised:
        module._native_run(runtime, tmp_path, 'office', float('inf'))
    assert raised.value.status == 422
    assert str(tmp_path) not in caplog.text and '/synthetic' not in caplog.text
    assert [record.getMessage() for record in caplog.records] == [
        "Presentation worker rejected; mode=office code=thread_limit metrics={'elapsed_ms': 2024, 'peak_rss_bytes': 200000000, 'peak_threads': 33, 'peak_work_bytes': 120000, 'exit_code': None} signatures=()"]


def test_legacy_supervisor_counts_regular_files_without_following_links(tmp_path, monkeypatch):
    work = tmp_path / 'work'; work.mkdir()
    private = tmp_path / 'outside-private-file'; private.write_bytes(b'protected bytes')
    link = work / 'outside-link'; link.symlink_to(private)
    vanished = work / 'removed-temp'; vanished.write_bytes(b'temporary')
    real_lstat = module.Path.lstat
    real_stat = module.Path.stat
    class SyntheticChild:
        pid = 19999994
        returncode = 0
        polls = iter([None, 0])
        def poll(self): return next(self.polls)
        def wait(self): return 0
    def raced_lstat(path, *args, **kwargs):
        if path == vanished:
            raise FileNotFoundError
        return real_lstat(path, *args, **kwargs)
    def no_follow(path, *args, **kwargs):
        assert path != link or kwargs.get('follow_symlinks') is False, 'Supervisor must not follow a converter-created link'
        return real_stat(path, *args, **kwargs)
    runtime = module.Runtime('/synthetic/soffice', '/synthetic/pdfinfo', '/synthetic/sandbox', 'darwin')
    monkeypatch.setattr(module, '_sandbox_command', lambda runtime, work, command: command)
    monkeypatch.setattr(module.subprocess, 'Popen', lambda *args, **kwargs: SyntheticChild())
    monkeypatch.setattr(module.os, 'killpg', lambda *args: None)
    monkeypatch.setattr(module.time, 'sleep', lambda _: None)
    monkeypatch.setattr(module.Path, 'lstat', raced_lstat)
    monkeypatch.setattr(module.Path, 'stat', no_follow)
    assert module._run(runtime, work, ['/synthetic/pdfinfo'], float('inf')) == b''
