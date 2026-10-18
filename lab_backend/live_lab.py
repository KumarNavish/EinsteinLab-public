"""Serve dated public lab evidence immediately; refresh only on a current check.

This is not general internet search. Only the same two public ETH lab hosts and
WordPress routes already admitted by ingest.py are fetched. No account pages,
private network, credentials, new external fetcher, or source-memory rewriting.
"""
from __future__ import annotations
import copy
from datetime import datetime, timezone
import re
import threading
import time
from urllib.parse import urljoin
from urllib.robotparser import RobotFileParser
import httpx
from .ingest import canonical, get_same_origin, extract, USER_AGENT
from .knowledge import Knowledge


class LiveLabLookup:
    def __init__(self, knowledge, fetcher=None):
        self.knowledge = knowledge
        self.fetcher = fetcher or self.fetch
        # Public release input only. No visitor PDF, microphone or private data
        # enters this process-wide cache; a restart retains the dated seed.
        self.cache = {canonical(page['url']): (None, page) for page in knowledge.pages
                      if canonical(page['url'])}
        self.lock = threading.Lock()
        self.live_reads = 0
        self.failures = 0
        self.last_checked_at = None

    def fetch(self, url):
        target = canonical(url)
        if target is None:
            raise ValueError('Only the existing public lab crawl scope is available')
        with httpx.Client(timeout=10, headers={'User-Agent': USER_AGENT}, trust_env=False) as client:
            robots_response = client.get(urljoin(target, '/robots.txt'), follow_redirects=False)
            robots = RobotFileParser()
            if robots_response.status_code == 404:
                robots.parse([])
            else:
                robots_response.raise_for_status(); robots.parse(robots_response.text.splitlines())
            if not robots.can_fetch(USER_AGENT, target):
                raise ValueError('This public page disallows this reader')
            response = get_same_origin(client, target)
            if len(response.content) > 2_000_000 or 'text/html' not in response.headers.get('content-type', ''):
                raise ValueError('Not a supported bounded lab HTML page')
            page = extract(response.text, str(response.url))
            page['fetched_at'] = datetime.now(timezone.utc).isoformat()
            return page

    def lookup(self, arguments):
        original = self.knowledge.lookup(arguments)
        urls = list(dict.fromkeys(canonical(source['url']) for source in original.get('sources', [])
                                  if canonical(source['url'])))[:3]
        if not urls:
            return {**original, 'freshness': 'no-live-page-selected'}
        refresh = arguments.get('refresh', bool(re.search(
            r'\b(latest|current|currently|today|now|recent|refresh|recheck|updated|changed|verify|up.to.date)\b',
            arguments.get('question', ''), re.I)))
        replacements = {}
        failures = []
        fetched = set()
        for url in urls:
            with self.lock:
                entry = self.cache.get(url)
            try:
                if entry and (not refresh or entry[0] is not None and time.monotonic() - entry[0] < 180):
                    page = entry[1]
                else:
                    page = self.fetcher(url)
                    if canonical(page['url']) != url or not page.get('fetched_at'):
                        raise ValueError('Refreshed evidence must identify the selected official page and its read date')
                    with self.lock:
                        self.cache[url] = (time.monotonic(), page)
                        self.live_reads += 1
                        self.last_checked_at = page['fetched_at']
                    fetched.add(url)
                replacements[url] = page
            except Exception as error:
                with self.lock:
                    self.failures += 1
                failures.append({'url': url, 'error_type': type(error).__name__})
                if entry:
                    replacements[url] = entry[1]
        if not replacements:
            return {**original, 'freshness': 'snapshot-fallback', 'live_read_failures': failures,
                    'warning': 'The live refresh failed. These are dated snapshot passages, not newly fetched evidence.'}
        # General lookup must rank the exact pages already selected, not silently
        # return old pre-indexed excerpts after the HTTP refresh.
        if all(page is next((original_page for original_page in self.knowledge.pages
                            if canonical(original_page['url']) == url), None)
               for url, page in replacements.items()):
            result = original
        else:
            temporary = copy.copy(self.knowledge)
            temporary.pages = [replacements.get(canonical(page['url']), page) for page in self.knowledge.pages]
            temporary.search = Knowledge({'pages': list(replacements.values())}).search
            result = temporary.lookup(arguments)
        for source in result.get('sources', []):
            url = canonical(source['url'])
            if url in replacements:
                source['source_kind'] = 'live-official-lab' if url in fetched else 'cached-official-lab'
                source['source_scope'] = 'official-page-read' if url in fetched else 'dated-official-page-cache'
                source['excerpt_kind'] = 'source_text'
        return {**result, 'freshness': ('cached-official-fallback' if failures else
                                       'live-official-pages' if fetched else 'cached-official-pages'),
                'refresh_requested': refresh, 'network_pages_read': len(fetched),
                'live_read_failures': failures,
                **({'warning': 'The requested live refresh failed for the listed pages. Their dated cached passages are not newly fetched evidence.'} if failures else {}),
                'scope': 'Exact public official-lab passages with original fetched_at dates. Cached passages are not a new HTTP read. Not a full-paper review or general internet search.'}
