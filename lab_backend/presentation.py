"""Bounded, ephemeral PPTX-to-PDF conversion for explicitly selected decks.

LibreOffice and pdfinfo are optional system runtimes. Conversion fails closed
without an OS sandbox; no document or converter diagnostics are logged.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
import io
import inspect
import logging
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time
from xml.etree import ElementTree
from urllib.parse import urlsplit
import zipfile

from fastapi import APIRouter, Depends, HTTPException, Request, Response


MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
MAX_UPLOAD = 8 * 1024 * 1024
MAX_PDF = 20 * 1024 * 1024
MAX_EXPANDED = 80 * 1024 * 1024
MAX_XML = 4 * 1024 * 1024
MAX_SLIDES = 120
MAX_SECONDS = 40
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
SLIDE_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"
PRESENTATION_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"
OFFICE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/"
WORKBOOK_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
MAX_WORKBOOK_BYTES = 4 * 1024 * 1024
MAX_WORKBOOK_EXPANDED = 8 * 1024 * 1024


class PresentationError(Exception):
    def __init__(self, status: int, message: str):
        self.status, self.message = status, message
        super().__init__(message)


def reject(message="Choose an unencrypted PPTX without macros, OLE objects or linked external content. HTTPS citation hyperlinks and inspected chart data workbooks are supported."):
    raise PresentationError(422, message)


def _xml(data: bytes):
    if len(data) > MAX_XML:
        reject("A presentation XML part exceeds the size limit.")
    try:
        text = data.decode("utf-8-sig")
        if re.search(r"<!\s*(?:DOCTYPE|ENTITY)", text, re.I):
            reject()
        return ElementTree.fromstring(text)
    except (UnicodeError, ElementTree.ParseError):
        reject("The presentation contains an unsupported or invalid XML part.")


def _package_parts(archive, budget):
    parts = archive.infolist()
    budget["parts"] += len(parts)
    budget["expanded"] += sum(p.file_size for p in parts)
    if len(parts) < 4 or budget["parts"] > 1600 or budget["expanded"] > MAX_EXPANDED:
        reject("The expanded presentation exceeds the conversion limit.")
    names = {p.filename for p in parts}
    if len(names) != len(parts) or len({name.lower() for name in names}) != len(names):
        reject()
    for part in parts:
        name = part.filename
        if (not name or len(name) > 240 or "\\" in name or ":" in name or "\x00" in name
                or PurePosixPath(name).is_absolute() or any(p in {".", ".."} for p in name.split("/"))
                or part.flag_bits & 1 or stat.S_ISLNK(part.external_attr >> 16)
                or part.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}
                or part.file_size > 20 * 1024 * 1024
                or part.file_size > max(1024 * 1024, part.compress_size * 150)
                or any(token in name.lower() for token in ("vbaproject", "/activex/", "oleobject", "macrosheet"))):
            reject()
    xml = {part.filename: _xml(archive.read(part)) for part in parts
           if part.filename.lower().endswith((".xml", ".rels", ".svg"))}
    if not {"[Content_Types].xml", "_rels/.rels"} <= names:
        reject()
    types = xml["[Content_Types].xml"]
    if any(any(token in entry.get("ContentType", "").lower() for token in ("macro", "vbaproject", "activex", "oleobject")) for entry in types):
        reject()
    declared = {entry.get("PartName", "").lstrip("/"): entry.get("ContentType", "") for entry in types}
    return parts, names, xml, declared


def _https_hyperlink(target):
    if not 1 <= len(target) <= 2048 or re.search(r"[\s\\\x00-\x1f\x7f]", target):
        return False
    try:
        url = urlsplit(target)
        return url.scheme == "https" and bool(url.hostname) and url.username is None and url.password is None and url.port in {None, 443}
    except ValueError:
        return False


def _relationships(xml, names, *, workbook=False):
    chart_workbooks, hyperlinks = set(), 0
    for name, root in xml.items():
        if not name.lower().endswith(".rels"):
            continue
        if root.tag != f"{{{REL_NS}}}Relationships":
            reject()
        base = "" if name == "_rels/.rels" else posixpath.dirname(posixpath.dirname(name))
        for rel in root:
            target, kind = rel.get("Target", ""), rel.get("Type", "")
            if any(token in kind.lower() for token in ("oleobject", "activex", "vba", "attachedtemplate")):
                reject()
            if rel.get("TargetMode", "Internal").lower() == "external":
                hyperlinks += 1
                if workbook or hyperlinks > 256 or kind != OFFICE_REL + "hyperlink" or not _https_hyperlink(target):
                    reject()
                # A hyperlink is retained as inert source metadata. No fetch;
                # the converter has no network and the PDF viewer disables links.
                continue
            if (rel.get("TargetMode", "Internal").lower() != "internal" or not target
                    or re.search(r"[:\\%?#]", target) or target.startswith("//")):
                reject()
            destination = posixpath.normpath(posixpath.join(base, target)) if not target.startswith("/") else target[1:]
            if destination.startswith("../") or destination not in names:
                reject()
            if kind == OFFICE_REL + "package" and not destination.lower().startswith("ppt/embeddings/"):
                reject()
            if destination.lower().startswith("ppt/embeddings/"):
                if not (name.startswith("ppt/charts/_rels/") and kind == OFFICE_REL + "package" and destination.lower().endswith(".xlsx")):
                    reject()
                chart_workbooks.add(destination)
    return chart_workbooks


def _chart_workbook(data, budget):
    if len(data) > MAX_WORKBOOK_BYTES:
        reject("An embedded chart data workbook exceeds 4 MB. Export the deck to PDF.")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if sum(p.file_size for p in archive.infolist()) > MAX_WORKBOOK_EXPANDED:
            reject("An expanded chart data workbook exceeds 8 MB. Export the deck to PDF.")
        _, names, xml, declared = _package_parts(archive, budget)
        # Only ordinary chart data parts are supported. In particular, there is
        # no recursive package/OLE, executable, connection or linked-data part.
        allowed = r"(?:\[Content_Types\]\.xml|_rels/\.rels|docProps/(?:app|core|custom)\.xml|xl/(?:workbook|styles|sharedStrings|calcChain|metadata)\.xml|xl/_rels/workbook\.xml\.rels|xl/worksheets/sheet[0-9]+\.xml|xl/theme/theme[0-9]+\.xml)"
        if any(not re.fullmatch(allowed, name) for name in names if not name.endswith("/")) or declared.get("xl/workbook.xml") != WORKBOOK_TYPE:
            reject("Only simple, macro-free embedded chart data workbooks are supported. Export the deck to PDF.")
        _relationships(xml, names, workbook=True)
        for root in xml.values():
            for element in root.iter():
                if element.tag.rsplit("}", 1)[-1] in {"f", "definedName", "externalReference", "hyperlink", "oleObject", "ddeLink"}:
                    reject("Embedded chart data must contain values without formulas, links or external data. Export the deck to PDF.")


def validate_pptx(data: bytes) -> int:
    """Inspect ZIPs in memory, including chart XLSX. Never extract paths."""
    if not 100 <= len(data) <= MAX_UPLOAD:
        raise PresentationError(413, "Choose a PPTX of at most 8 MB.")
    try:
        budget = {"expanded": 0, "parts": 0}
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            _, names, xml, declared = _package_parts(archive, budget)
            if not {"ppt/presentation.xml", "ppt/_rels/presentation.xml.rels"} <= names or declared.get("ppt/presentation.xml") != PRESENTATION_TYPE:
                reject("This file is not a supported PPTX presentation.")
            for name, root in xml.items():
                if name.lower().endswith(".svg"):
                    for element in root.iter():
                        if element.tag.rsplit("}", 1)[-1].lower() in {"script", "foreignobject"}:
                            reject()
                        for key, value in element.attrib.items():
                            if (key.rsplit("}", 1)[-1].lower() in {"href", "src"} and not value.startswith("#")) or re.search(r"url\s*\(", value, re.I):
                                reject()
            chart_workbooks = _relationships(xml, names)
            embeddings = {name for name in names if name.lower().startswith("ppt/embeddings/") and not name.endswith("/")}
            if embeddings != chart_workbooks or len(embeddings) > 32:
                reject()
            for name in embeddings:
                _chart_workbook(archive.read(name), budget)
            slide_ids = xml["ppt/presentation.xml"].findall("{*}sldIdLst/{*}sldId")
            slides = [name for name in names if re.fullmatch(r"ppt/slides/slide[0-9]+\.xml", name)]
            if not 1 <= len(slide_ids) <= MAX_SLIDES or len(slides) != len(slide_ids):
                reject("Choose a presentation with 1 to 120 slides.")
            if any(declared.get(name) != SLIDE_TYPE for name in slides):
                reject()
            return len(slide_ids)
    except (zipfile.BadZipFile, RuntimeError, NotImplementedError, OSError, EOFError):
        reject("The selected PPTX is damaged or unsupported.")


@dataclass(frozen=True)
class Runtime:
    office: str
    pdfinfo: str
    sandbox: str
    system: str
    native: str | None = None


def installed_runtime() -> Runtime:
    if sys.platform == "linux":
        from .presentation_linux import ConversionError, configured_native
        try:
            native = configured_native(Path(__file__).resolve().parents[1])
        except ConversionError:
            raise PresentationError(503, "Presentation conversion is unavailable. Export your deck to PDF and open that file.") from None
        if native:
            return Runtime(str(native / "usr/bin/lloconv"), str(native / "usr/bin/pdfinfo"), "", "linux-native", str(native))
    office, pdfinfo = shutil.which("soffice"), shutil.which("pdfinfo")
    sandbox = shutil.which("sandbox-exec" if sys.platform == "darwin" else "bwrap")
    if not office or not pdfinfo or not sandbox or sys.platform not in {"darwin", "linux"}:
        raise PresentationError(503, "Presentation conversion is unavailable. Export your deck to PDF and open that file.")
    return Runtime(str(Path(office).resolve()), str(Path(pdfinfo).resolve()), str(Path(sandbox).resolve()), sys.platform)


def _runtime_roots(executable: str):
    path = Path(executable)
    # Bundled Codex wrappers only read binaries/libraries in their runtime.
    bundled = path.parent.parent.parent / "native"
    if bundled.is_dir():
        return [path.parent, bundled]
    if path.name == "soffice" and path.parent.name == "MacOS":
        return [path.parent.parent.parent]
    return [path.parent]


def _sandbox_command(runtime: Runtime, work: Path, command: list[str]):
    roots = [*_runtime_roots(runtime.office), *_runtime_roots(runtime.pdfinfo)]
    if runtime.system == "darwin":
        # No network, user documents, credentials or unrelated home-directory reads.
        import json
        read_roots = [Path(p) for p in ("/System", "/usr", "/bin", "/sbin", "/Library/Fonts", "/Library/Preferences", "/private/var/db/dyld")]
        profile = '(version 1) (deny default) (allow process-exec) (allow process-fork) (allow sysctl-read) (allow mach-lookup) (allow file-read-metadata) (allow file-read* (literal "/"))\n'
        for path in [work, *read_roots, *roots]:
            profile += f'(allow file-read* (subpath {json.dumps(str(path))}))\n'
        profile += f'(allow file-write* (subpath {json.dumps(str(work))}))\n'
        for path in ("/dev/null", "/dev/random", "/dev/urandom"):
            profile += f'(allow file-read* file-write* (literal "{path}"))\n'
        profile_file = work / "sandbox.sb"
        profile_file.write_text(profile)
        return [runtime.sandbox, "-f", str(profile_file), *command]
    args = [runtime.sandbox, "--unshare-all", "--die-with-parent", "--new-session", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp"]
    for path in [Path(p) for p in ("/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc/fonts", "/etc/ld.so.cache") if Path(p).exists()] + roots:
        args += ["--ro-bind", str(path), str(path)]
    return [*args, "--bind", str(work), str(work), "--chdir", str(work), "--", *command]


# Set resource limits in a fresh Python process, avoiding preexec_fn in a server
# thread. It only execs a fixed, OS-sandboxed command; no shell is involved.
_LIMITED_EXEC = """import os,resource,sys
resource.setrlimit(resource.RLIMIT_CPU, (30,30))
resource.setrlimit(resource.RLIMIT_FSIZE, (20971520,20971520))
resource.setrlimit(resource.RLIMIT_NOFILE, (256,256))
if sys.platform == 'linux': resource.setrlimit(resource.RLIMIT_AS, (1610612736,1610612736))
os.execv(sys.argv[1],sys.argv[1:])
"""


def _run(runtime: Runtime, work: Path, command: list[str], deadline: float, *, capture=False):
    args = _sandbox_command(runtime, work, command)
    environment = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "HOME": str(work), "CFFIXED_USER_HOME": str(work),
                   "XDG_CACHE_HOME": str(work / "cache"), "XDG_CONFIG_HOME": str(work / "config"), "TMPDIR": str(work),
                   "LANG": "C.UTF-8", "SAL_USE_VCLPLUGIN": "svp"}
    result = b""
    descriptor = (os.open(work / "inspection.txt", os.O_CREAT | os.O_EXCL | os.O_RDWR | os.O_NOFOLLOW, 0o600)
                  if capture else os.open(os.devnull, os.O_WRONLY))
    with os.fdopen(descriptor, "w+b" if capture else "wb") as stdout:
        process = subprocess.Popen([sys.executable, "-I", "-S", "-c", _LIMITED_EXEC, *args], cwd=work,
                                   env=environment, stdin=subprocess.DEVNULL, stdout=stdout,
                                   stderr=subprocess.DEVNULL, start_new_session=True)
        try:
            while process.poll() is None:
                size = 0
                for path in work.rglob("*"):
                    try:
                        info = path.lstat()
                    except FileNotFoundError:
                        continue
                    if stat.S_ISREG(info.st_mode):
                        size += info.st_size
                if time.monotonic() > deadline or size > MAX_EXPANDED + MAX_UPLOAD:
                    raise PresentationError(422, "Presentation conversion exceeded its time or size limit. Export the deck to PDF.")
                time.sleep(.1)
            if process.returncode:
                raise PresentationError(422, "This deck could not be converted safely. Export it to PDF and open that file.")
            if capture:
                stdout.seek(0)
                result = stdout.read(4096)
        finally:
            # LibreOffice can fork; kill the whole process group before cleanup.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
    return result


def _native_run(runtime: Runtime, work: Path, mode: str, deadline: float):
    from .presentation_linux import ConversionError, run
    try:
        return run(Path(runtime.native), work, mode, deadline)
    except ConversionError as error:
        logging.getLogger("uvicorn.error").warning(
            "Presentation worker rejected; mode=%s code=%s metrics=%s signatures=%s",
            mode, error.code, error.metrics, error.signatures)
        if error.unavailable:
            raise PresentationError(503, "Presentation conversion is unavailable. Export your deck to PDF and open that file.") from None
        raise PresentationError(422, "This deck could not be converted safely. Export it to PDF and open that file.") from None


def _pdf_output(output: Path):
    """Read only a bounded regular file; never follow a converter-created link."""
    try:
        descriptor = os.open(output, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, "rb") as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or not 8 <= info.st_size <= MAX_PDF:
                reject("The converted deck exceeds the PDF size limit or could not be rendered.")
            result = source.read(MAX_PDF + 1)
        if not 8 <= len(result) <= MAX_PDF or not result.startswith(b"%PDF-"):
            reject("The converted deck exceeds the PDF size limit or could not be rendered.")
        return result
    except OSError:
        reject("This deck could not be converted safely. Export it to PDF and open that file.")


class PresentationConverter:
    def __init__(self):
        # ponytail: one process-wide conversion; use a bounded external worker
        # queue only if measured multi-instance demand justifies it.
        self.lock = threading.Lock()

    def convert(self, data: bytes) -> bytes:
        if not self.lock.acquire(blocking=False):
            raise PresentationError(429, "Another presentation is converting. Please try again shortly.")
        try:
            slides = validate_pptx(data)
            runtime = installed_runtime()
            deadline = time.monotonic() + MAX_SECONDS
            with tempfile.TemporaryDirectory(prefix="einstein-presentation-") as directory:
                work = Path(directory).resolve()
                if not runtime.native:
                    try:
                        _run(runtime, work, ["/usr/bin/true"], deadline)
                    except PresentationError:
                        raise PresentationError(503, "Presentation conversion is unavailable. Export your deck to PDF and open that file.") from None
                source = work / "selected.pptx"
                source.write_bytes(data)
                profile = work / "profile"
                profile.mkdir()
                # Disable all macros and link updates even after preflight.
                (profile / "user").mkdir()
                (profile / "user/registrymodifications.xcu").write_text('''<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Common/Load"><prop oor:name="UpdateLinks" oor:op="fuse"><value>0</value></prop></item></oor:items>''')
                if runtime.native:
                    _native_run(runtime, work, "proof", deadline)
                    _native_run(runtime, work, "office", deadline)
                else:
                    _run(runtime, work, [runtime.office, f"-env:UserInstallation={profile.as_uri()}", "--headless",
                        "--nologo", "--nodefault", "--norestore", "--nolockcheck", "--convert-to",
                        'pdf:impress_pdf_Export:{"ExportNotesPages":{"type":"boolean","value":"false"},"ExportHiddenSlides":{"type":"boolean","value":"true"}}',
                        "--outdir", str(work), str(source)], deadline)
                output = work / "selected.pdf"
                try:
                    output_info = output.lstat()
                except OSError:
                    reject("The converted deck exceeds the PDF size limit or could not be rendered.")
                if not stat.S_ISREG(output_info.st_mode) or not 8 <= output_info.st_size <= MAX_PDF:
                    reject("The converted deck exceeds the PDF size limit or could not be rendered.")
                info = (_native_run(runtime, work, "pdfinfo", deadline) if runtime.native else
                        _run(runtime, work, [runtime.pdfinfo, str(output)], deadline, capture=True))
                pages = re.search(rb"(?m)^Pages:\s*(\d+)\s*$", info)
                if not pages or int(pages[1]) != slides or int(pages[1]) > MAX_SLIDES:
                    reject("The converted deck did not preserve the expected slide count. Export it to PDF.")
                result = _pdf_output(output)
            if work.exists():
                raise PresentationError(503, "Presentation conversion is unavailable. Export your deck to PDF and open that file.")
            logging.getLogger("uvicorn.error").info("Presentation converted; temporary work removed")
            return result
        except PresentationError:
            raise
        except (OSError, ValueError, subprocess.SubprocessError):
            raise PresentationError(503, "Presentation conversion is unavailable. Export your deck to PDF and open that file.") from None
        finally:
            self.lock.release()


def presentation_router(authorize, *, converter=None) -> APIRouter:
    """The host must supply its existing authenticated-session dependency."""
    if not callable(authorize):
        raise TypeError("An authenticated-session dependency is required")
    async def authenticated(request: Request):
        result = authorize(request)
        return await result if inspect.isawaitable(result) else result
    router = APIRouter(prefix="/api/presentation", dependencies=[Depends(authenticated)])
    converter = converter or PresentationConverter()
    upload_lock = asyncio.Lock()

    @router.post("/convert")
    async def convert(request: Request):
        if request.headers.get("content-type", "").split(";", 1)[0] != MIME:
            raise HTTPException(415, "Choose a PPTX presentation.")
        if upload_lock.locked():
            raise HTTPException(429, "Another presentation is converting. Please try again shortly.")
        async with upload_lock:
            try:
                data = bytearray()
                async with asyncio.timeout(15):
                    async for chunk in request.stream():
                        if len(data) + len(chunk) > MAX_UPLOAD:
                            raise PresentationError(413, "Choose a PPTX of at most 8 MB.")
                        data.extend(chunk)
                pdf = await asyncio.to_thread(converter.convert, bytes(data))
                return Response(pdf, media_type="application/pdf", headers={
                    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
                    "Content-Disposition": 'inline; filename="converted-slides.pdf"'})
            except TimeoutError:
                raise HTTPException(408, "Presentation upload took too long.") from None
            except PresentationError as error:
                raise HTTPException(error.status, error.message) from None

    return router
