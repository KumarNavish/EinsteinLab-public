"""Explicit public PDF retrieval. No credentials, proxy, URL logging or storage.

Every redirect is independently screened. TCP connects to the screened numeric
address, while TLS authenticates the original hostname with the system CA store.
"""
from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
import http.client
import inspect
import ipaddress
import json
import re
import socket
import ssl
import threading
import time
from urllib.parse import quote, urljoin, urlsplit, urlunsplit

from fastapi import APIRouter, HTTPException, Request, Response

MAX_BYTES = 20 * 1024 * 1024
MAX_SECONDS = 15
MAX_HEADERS = 32 * 1024
UNAVAILABLE = 'This public PDF could not be retrieved. Use a direct, accessible HTTPS PDF link or open a local PDF.'


class PaperError(Exception):
    def __init__(self, status=422, message=UNAVAILABLE):
        self.status, self.message = status, message
        super().__init__(message)


def checked_url(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 2048 or any(ord(c) < 33 or ord(c) == 127 for c in value) or '\\' in value:
        raise PaperError()
    try:
        parsed = urlsplit(value)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username is not None or parsed.password is not None or parsed.port not in (None, 443):
            raise ValueError()
        hostname = parsed.hostname.encode('idna').decode('ascii').lower()
        if '%' in hostname or len(hostname) > 253 or hostname.endswith('.'):
            raise ValueError()
        try:
            ipaddress.ip_address(hostname)
        except ValueError:
            if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', hostname) or '..' in hostname:
                raise ValueError()
        authority = '[' + hostname + ']' if ':' in hostname else hostname
        path = quote(parsed.path or '/', safe="/%:@!$&'()*+,;=-._~")
        query = quote(parsed.query, safe="/%?:@!$&'()*+,;=-._~")
        normalized = urlunsplit(('https', authority, path, query, ''))
        if len(normalized) > 2048: raise ValueError()
        return normalized, hostname, path + ('?' + query if query else '')
    except (ValueError, UnicodeError):
        raise PaperError() from None


def public_address(value):
    try:
        if '%' in str(value): raise ValueError()
        address = ipaddress.ip_address(value)
        if not address.is_global or address.is_multicast or address.is_reserved or str(address) == '168.63.129.16' or (address.version == 4 and address in ipaddress.ip_network('192.0.0.0/24')):
            raise ValueError()
        if address.version == 6 and (address.ipv4_mapped is not None or any(address in ipaddress.ip_network(network) for network in ['::/96', '64:ff9b::/96', '64:ff9b:1::/48', '2001::/32', '2002::/16'])):
            raise ValueError()
        return address
    except ValueError:
        raise PaperError() from None


def resolve_public(hostname):
    try:
        literal = ipaddress.ip_address(hostname)
    except ValueError:
        records = socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)
        addresses = [public_address(record[4][0]) for record in records]
        if not addresses: raise PaperError()
        return str(addresses[0])
    return str(public_address(literal))


def remaining(deadline):
    seconds = deadline - time.monotonic()
    if seconds <= 0: raise PaperError(504, UNAVAILABLE)
    return seconds


class _HeaderReader:
    def __init__(self, source): self.source, self.bytes, self.lines = source, 0, 0
    def readline(self, limit=-1):
        line = self.source.readline(min(8193, limit) if limit >= 0 else 8193)
        self.bytes += len(line); self.lines += 1
        if len(line) > 8192 or self.bytes > MAX_HEADERS or self.lines > 66:
            raise PaperError()
        return line
    def __getattr__(self, name): return getattr(self.source, name)


class _BoundedResponse(http.client.HTTPResponse):
    def begin(self):
        source = self.fp
        self.fp = _HeaderReader(source)
        try: super().begin()
        finally: self.fp = source


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    response_class = _BoundedResponse

    def __init__(self, hostname, address, deadline):
        super().__init__(hostname, port=443, timeout=remaining(deadline), context=ssl.create_default_context())
        self.address, self.deadline, self.transport = address, deadline, None

    def connect(self):
        # Numeric socket.connect avoids a second getaddrinfo lookup entirely.
        address = public_address(self.address)
        raw = socket.socket(socket.AF_INET6 if address.version == 6 else socket.AF_INET, socket.SOCK_STREAM)
        self.sock = self.transport = raw
        raw.settimeout(remaining(self.deadline))
        raw.connect((str(address), 443))
        self.sock = self.transport = self._context.wrap_socket(raw, server_hostname=self.host, do_handshake_on_connect=False)
        self.sock.settimeout(remaining(self.deadline))
        self.sock.do_handshake()

    def abort(self):
        # A wall-clock watchdog interrupts servers that indefinitely drip bytes.
        transport = self.transport
        if transport:
            try: transport.shutdown(socket.SHUT_RDWR)
            except OSError: pass
            try: transport.close()
            except OSError: pass


def retrieve_pdf(value, *, deadline=None):
    deadline = deadline if deadline is not None else time.monotonic() + MAX_SECONDS
    try:
        url, hostname, target = checked_url(value)
        for hop in range(4):
            remaining(deadline)
            address = resolve_public(hostname)
            connection = PinnedHTTPSConnection(hostname, address, deadline)
            watchdog = threading.Timer(remaining(deadline), connection.abort)
            watchdog.daemon = True
            watchdog.start()
            response = None
            try:
                connection.request('GET', target, headers={'Accept': 'application/pdf', 'Accept-Encoding': 'identity', 'User-Agent': 'Einstein-Public-PDF/1.0', 'Connection': 'close'})
                response = connection.getresponse()
                remaining(deadline)
                if response.status in {301, 302, 303, 307, 308}:
                    locations = response.headers.get_all('Location', [])
                    if hop == 3 or len(locations) != 1: raise PaperError()
                    url, hostname, target = checked_url(urljoin(url, locations[0]))
                    continue
                if response.status != 200 or response.headers.get_content_type() != 'application/pdf': raise PaperError()
                if response.headers.get('Content-Encoding', 'identity').lower() != 'identity': raise PaperError()
                lengths = response.headers.get_all('Content-Length', [])
                transfer = response.headers.get_all('Transfer-Encoding', [])
                if len(lengths) > 1 or len(transfer) > 1 or (lengths and transfer) or (transfer and transfer[0].lower() != 'chunked'):
                    raise PaperError()
                expected = None
                if lengths:
                    if not re.fullmatch(r'[0-9]{1,10}', lengths[0]): raise PaperError()
                    expected = int(lengths[0])
                    if expected > MAX_BYTES: raise PaperError(413, 'The public PDF exceeds 20 MB.')
                output = bytearray()
                while True:
                    remaining(deadline)
                    chunk = response.read1(min(65536, MAX_BYTES + 1 - len(output)))
                    if not chunk: break
                    output.extend(chunk)
                    if len(output) > MAX_BYTES: raise PaperError(413, 'The public PDF exceeds 20 MB.')
                    if len(output) >= 5 and not output.startswith(b'%PDF-'): raise PaperError()
                remaining(deadline)
                if len(output) < 8 or not output.startswith(b'%PDF-') or (expected is not None and len(output) != expected): raise PaperError()
                return bytes(output), url
            finally:
                watchdog.cancel()
                if response is not None: response.close()
                connection.close()
        raise PaperError()
    except PaperError:
        raise
    except (OSError, http.client.HTTPException, UnicodeError, ValueError):
        raise PaperError() from None


def paper_router(*, authorize):
    router = APIRouter(prefix='/api/paper')
    workers = ThreadPoolExecutor(max_workers=2, thread_name_prefix='public-pdf')
    slots = threading.BoundedSemaphore(2)

    @router.post('/retrieve')
    async def retrieve(request: Request):
        deadline = time.monotonic() + MAX_SECONDS
        try:
            async with asyncio.timeout(MAX_SECONDS):
                permission = authorize(request)
                if inspect.isawaitable(permission): await permission
                origin = request.headers.get('origin')
                try:
                    if origin and (urlsplit(origin).netloc != request.headers.get('host') or urlsplit(origin).scheme not in {'http', 'https'}): raise ValueError()
                except ValueError:
                    raise HTTPException(403, 'Same-origin request required.') from None
                if request.headers.get('content-type', '').split(';')[0].strip().lower() != 'application/json':
                    raise HTTPException(415, 'Submit a public PDF URL as JSON.')
                body = bytearray()
                async for chunk in request.stream():
                    if len(body) + len(chunk) > 4096: raise HTTPException(413, 'The PDF URL request is too large.')
                    body.extend(chunk)
                try:
                    payload = json.loads(body)
                    if not isinstance(payload, dict) or set(payload) != {'url'}: raise ValueError()
                    url, _, _ = checked_url(payload['url'])
                except (ValueError, TypeError, PaperError):
                    raise HTTPException(422, UNAVAILABLE) from None
                if not slots.acquire(blocking=False): raise HTTPException(429, 'Paper retrieval is busy. Please try again shortly.')
                try:
                    future = workers.submit(retrieve_pdf, url, deadline=deadline)
                except Exception:
                    slots.release()
                    raise
                future.add_done_callback(lambda completed: slots.release())
                data, source = await asyncio.wrap_future(future)
                return Response(data, media_type='application/pdf', headers={'Content-Disposition': 'inline; filename="public-paper.pdf"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Paper-Source-URL': source})
        except TimeoutError:
            raise HTTPException(504, UNAVAILABLE) from None
        except PaperError as error:
            raise HTTPException(error.status, error.message) from None

    return router
