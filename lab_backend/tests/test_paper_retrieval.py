"""Deterministic public-URL adversarial fixtures. Never reach the Internet."""
import asyncio
import io
import socket
import ssl
import threading
import time

import httpx
import pytest
from fastapi import FastAPI, HTTPException

from lab_backend import paper_retrieval as paper

PDF = b'%PDF-1.7\ncontrolled offline fixture\n%%EOF\n'


@pytest.mark.parametrize('url', ['http://example.org/p.pdf', 'file:///etc/passwd', 'https://u:p@example.org/p.pdf', 'https://example.org:444/p.pdf', 'https://example.org/\nHost:bad', 'https://example.org\\@127.0.0.1/a', 'https://[fe80::1%25en0]/a', 'https://example.org./a', 'https://example.org/' + 'a' * 2050, None])
def test_only_bounded_credential_free_https_urls(url):
    with pytest.raises(paper.PaperError): paper.checked_url(url)


@pytest.mark.parametrize('address', ['127.0.0.1', '0.0.0.0', '10.2.3.4', '172.17.0.2', '192.168.3.1', '169.254.169.254', '100.100.100.200', '168.63.129.16', '192.0.0.9', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:8.8.8.8', '64:ff9b::7f00:1', '2002:7f00:1::1', '2001:db8::1'])
def test_private_metadata_multicast_and_mapped_addresses_are_rejected(address):
    with pytest.raises(paper.PaperError): paper.public_address(address)


def test_every_dns_answer_must_be_public(monkeypatch):
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *args, **kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('93.184.216.34', 443)), (socket.AF_INET, socket.SOCK_STREAM, 6, '', ('127.0.0.1', 443))])
    with pytest.raises(paper.PaperError): paper.resolve_public('fixture.example')
    assert paper.resolve_public('93.184.216.34') == '93.184.216.34'


def test_pinned_connect_has_no_dns_lookup_and_preserves_tls_hostname(monkeypatch):
    events = []
    class Raw:
        def settimeout(self, value): assert 0 < value <= 15
        def connect(self, endpoint): events.append(('connect', endpoint))
        def do_handshake(self): events.append(('handshake',))
        def close(self): pass
    raw = Raw()
    monkeypatch.setattr(socket, 'socket', lambda *args: raw)
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *args, **kwargs: pytest.fail('Second DNS lookup is forbidden'))
    connection = paper.PinnedHTTPSConnection('fixture.example', '93.184.216.34', time.monotonic() + 15)
    assert connection._context.check_hostname and connection._context.verify_mode == ssl.CERT_REQUIRED
    class Context:
        def wrap_socket(self, sock, **kwargs):
            assert sock is raw and kwargs == {'server_hostname': 'fixture.example', 'do_handshake_on_connect': False}
            return raw
    connection._context = Context()
    connection.connect(); connection.close()
    assert events == [('connect', ('93.184.216.34', 443)), ('handshake',)]


class RawResponse:
    def __init__(self, data): self.data = data
    def makefile(self, mode): return io.BytesIO(self.data)


def response(body=PDF, *, status=200, headers=None):
    headers = headers if headers is not None else [('Content-Type', 'application/pdf'), ('Content-Length', str(len(body)))]
    raw = f'HTTP/1.1 {status} Fixture\r\n'.encode() + b''.join(f'{key}: {value}\r\n'.encode() for key, value in headers) + b'\r\n' + body
    result = paper._BoundedResponse(RawResponse(raw)); result.begin()
    return result


def network(monkeypatch, replies, *, addresses=None):
    requests, resolutions = [], []
    def resolve(host):
        resolutions.append(host)
        return paper.public_address((addresses or {}).get(host, '93.184.216.34')).compressed
    class Connection:
        def __init__(self, hostname, address, deadline):
            requests.append({'host': hostname, 'address': address})
        def request(self, method, target, *, headers):
            assert method == 'GET' and headers['Accept-Encoding'] == 'identity'
            assert not {'Cookie', 'Authorization', 'Proxy-Authorization'} & set(headers)
            requests[-1]['target'] = target
        def getresponse(self): return replies.pop(0)()
        def close(self): pass
        def abort(self): pass
    monkeypatch.setattr(paper, 'resolve_public', resolve)
    monkeypatch.setattr(paper, 'PinnedHTTPSConnection', Connection)
    return requests, resolutions


def test_real_http_parser_and_exact_pdf_bytes_are_preserved(monkeypatch):
    requests, resolutions = network(monkeypatch, [response])
    data, source = paper.retrieve_pdf('https://fixture.example/a.pdf?x=1#page=2')
    assert data == PDF and source == 'https://fixture.example/a.pdf?x=1'
    assert requests == [{'host': 'fixture.example', 'address': '93.184.216.34', 'target': '/a.pdf?x=1'}]
    assert resolutions == ['fixture.example']


def test_redirect_to_private_address_never_connects(monkeypatch):
    requests, resolutions = network(monkeypatch, [lambda: response(b'', status=302, headers=[('Location', 'https://internal.example/secret')])], addresses={'internal.example': '169.254.169.254'})
    with pytest.raises(paper.PaperError): paper.retrieve_pdf('https://fixture.example/p.pdf')
    assert len(requests) == 1 and resolutions == ['fixture.example', 'internal.example']


def test_redirects_are_rechecked_and_limited_to_three(monkeypatch):
    replies = [lambda: response(b'', status=302, headers=[('Location', '/next.pdf')])] * 4
    requests, resolutions = network(monkeypatch, replies)
    with pytest.raises(paper.PaperError): paper.retrieve_pdf('https://fixture.example/p.pdf')
    assert len(requests) == len(resolutions) == 4


@pytest.mark.parametrize('location', ['http://fixture.example/p.pdf', 'https://user:pass@fixture.example/p.pdf', 'file:///etc/passwd', 'https://fixture.example:8443/p.pdf'])
def test_redirect_cannot_weaken_original_url_policy(monkeypatch, location):
    requests, _ = network(monkeypatch, [lambda: response(b'', status=302, headers=[('Location', location)])])
    with pytest.raises(paper.PaperError): paper.retrieve_pdf('https://fixture.example/p.pdf')
    assert len(requests) == 1


@pytest.mark.parametrize('body,headers,status', [
    (b'<html>paywall</html>', [('Content-Type', 'text/html')], 200),
    (b'not a PDF', [('Content-Type', 'application/pdf')], 200),
    (PDF, [('Content-Type', 'application/pdf'), ('Content-Encoding', 'gzip')], 200),
    (PDF, [('Content-Type', 'application/pdf'), ('Content-Length', str(paper.MAX_BYTES + 1))], 200),
    (PDF, [('Content-Type', 'application/pdf'), ('Content-Length', '3'), ('Content-Length', '4')], 200),
    (PDF, [('Content-Type', 'application/pdf'), ('Content-Length', str(len(PDF) + 1))], 200),
    (PDF, [('Content-Type', 'application/pdf'), ('Transfer-Encoding', 'gzip')], 200),
    (PDF, [('Content-Type', 'application/pdf')], 403),
])
def test_paywalls_incorrect_magic_encoding_size_and_framing_fail_closed(monkeypatch, body, headers, status):
    network(monkeypatch, [lambda: response(body, status=status, headers=headers)])
    with pytest.raises(paper.PaperError): paper.retrieve_pdf('https://fixture.example/p.pdf')


def test_body_limit_applies_without_content_length(monkeypatch):
    monkeypatch.setattr(paper, 'MAX_BYTES', 20)
    network(monkeypatch, [lambda: response(headers=[('Content-Type', 'application/pdf')])])
    with pytest.raises(paper.PaperError) as error: paper.retrieve_pdf('https://fixture.example/p.pdf')
    assert error.value.status == 413


@pytest.mark.parametrize('headers', [[('X-Large', 'x' * 8193)], [('X-Fill', 'x' * 4000)] * 9, [('X-Many', 'x')] * 67])
def test_response_header_memory_is_bounded(headers):
    with pytest.raises(paper.PaperError): response(headers=headers)


def test_chunked_pdf_is_bounded_and_preserved(monkeypatch):
    encoded = f'{len(PDF):x}\r\n'.encode() + PDF + b'\r\n0\r\n\r\n'
    network(monkeypatch, [lambda: response(encoded, headers=[('Content-Type', 'application/pdf'), ('Transfer-Encoding', 'chunked')])])
    assert paper.retrieve_pdf('https://fixture.example/p.pdf')[0] == PDF


def test_deadline_stops_dripping_responses_and_sanitizes_network_faults(monkeypatch):
    stopped = threading.Event()
    monkeypatch.setattr(paper, 'MAX_SECONDS', .02)
    monkeypatch.setattr(paper, 'resolve_public', lambda host: '93.184.216.34')
    class Connection:
        def __init__(self, *args): pass
        def request(self, *args, **kwargs):
            assert stopped.wait(1)
            raise OSError('DO NOT EXPOSE remote detail')
        def abort(self): stopped.set()
        def close(self): pass
    monkeypatch.setattr(paper, 'PinnedHTTPSConnection', Connection)
    with pytest.raises(paper.PaperError) as error: paper.retrieve_pdf('https://fixture.example/p.pdf')
    assert 'DO NOT EXPOSE' not in str(error.value)
    with pytest.raises(paper.PaperError): paper.retrieve_pdf('https://fixture.example/p.pdf', deadline=time.monotonic() - 1)


def app(authorize=lambda request: True):
    application = FastAPI(); application.include_router(paper.paper_router(authorize=authorize)); return application


def test_route_auth_origin_body_and_safe_pdf_response(monkeypatch):
    calls = []
    def fetch(url, *, deadline): calls.append(url); return PDF, url
    monkeypatch.setattr(paper, 'retrieve_pdf', fetch)
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app()), base_url='http://testserver') as client:
            assert (await client.post('/api/paper/retrieve', json={'url': 'https://fixture.example/p.pdf'}, headers={'Origin': 'https://evil.example'})).status_code == 403
            assert (await client.post('/api/paper/retrieve', content=b'{}', headers={'Content-Type': 'text/plain'})).status_code == 415
            assert (await client.post('/api/paper/retrieve', content=b'x' * 4097, headers={'Content-Type': 'application/json'})).status_code == 413
            assert (await client.post('/api/paper/retrieve', json={'url': 'file:///etc/passwd'})).status_code == 422
            result = await client.post('/api/paper/retrieve', json={'url': 'https://fixture.example/p.pdf'})
            assert result.status_code == 200 and result.content == PDF
            assert result.headers['cache-control'] == 'no-store' and result.headers['content-disposition'] == 'inline; filename="public-paper.pdf"'
            assert result.headers['x-paper-source-url'] == 'https://fixture.example/p.pdf'
        def denied(request): raise HTTPException(401, 'Visitor required')
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app(denied)), base_url='http://testserver') as client:
            assert (await client.post('/api/paper/retrieve', json={'url': 'https://fixture.example/p.pdf'})).status_code == 401
    asyncio.run(scenario()); assert calls == ['https://fixture.example/p.pdf']


def test_timeout_retains_worker_slots_until_blocked_dns_actually_finishes(monkeypatch):
    started = threading.Barrier(3); finish = threading.Event()
    def blocked(url, *, deadline): started.wait(timeout=2); finish.wait(timeout=2); return PDF, url
    monkeypatch.setattr(paper, 'retrieve_pdf', blocked)
    monkeypatch.setattr(paper, 'MAX_SECONDS', .1)
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app()), base_url='http://testserver') as client:
            tasks = [asyncio.create_task(client.post('/api/paper/retrieve', json={'url': 'https://fixture.example/p.pdf'})) for _ in range(2)]
            await asyncio.to_thread(started.wait, 2)
            results = await asyncio.gather(*tasks)
            assert all(result.status_code == 504 for result in results)
            assert (await client.post('/api/paper/retrieve', json={'url': 'https://fixture.example/p.pdf'})).status_code == 429
            finish.set()
    try: asyncio.run(scenario())
    finally: finish.set()
