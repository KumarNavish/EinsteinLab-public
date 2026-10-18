"""Freshness/caching tests with injected page fixtures; no network calls."""
from __future__ import annotations
import copy
import hashlib
from lab_backend.live_lab import LiveLabLookup
from lab_backend.atlas import blocks

URL='https://mobililab.ethz.ch/?research-proj-posts=example'

def page(text, date):
    return {'url':URL,'title':'Example','text':text,'text_sha256':hashlib.sha256(text.encode()).hexdigest(),'fetched_at':date}

class Knowledge:
    def __init__(self):
        self.pages=[page('Approach\n\nThis is the earlier project description from the snapshot.', '2026-10-13T00:00:00+00:00')]
        self.notes=object();self.search=None
    def lookup(self,args):
        return {'answer':'Read the source.','sources':blocks(self.pages[0]),'snapshot_at':'2026-10-13'}


def test_new_source_text_and_date_are_returned_without_mutating_snapshot():
    original=Knowledge();before=copy.deepcopy(original.pages)
    fresh=page('Approach\n\nThis official webpage now describes a different experiment.', '2026-10-14T12:00:00+00:00')
    reader=LiveLabLookup(original, fetcher=lambda url:fresh)
    result=reader.lookup({'question':'Explain Example','project_titles':['Example'], 'refresh': True})
    assert result['freshness']=='live-official-pages'
    assert result['sources'][0]['excerpt'].startswith('This official webpage now')
    assert result['sources'][0]['source_kind']=='live-official-lab'
    assert result['sources'][0]['fetched_at']==fresh['fetched_at']
    assert original.pages==before


def test_cached_read_does_not_fabricate_new_fetch_time():
    calls=[]
    def fetch(url):
        calls.append(url);return page('Results\n\nThe published source gives these results, with uncertainty.', '2026-10-14T12:00:00+00:00')
    reader=LiveLabLookup(Knowledge(),fetcher=fetch)
    a=reader.lookup({'question':'Example', 'refresh': True});b=reader.lookup({'question':'Example', 'refresh': True})
    assert len(calls)==1 and reader.live_reads==1
    assert a['sources'][0]['fetched_at']==b['sources'][0]['fetched_at']
    assert a['freshness'] == 'live-official-pages'
    assert b['freshness'] == 'cached-official-pages'
    assert b['sources'][0]['source_kind'] == 'cached-official-lab'
    assert b['network_pages_read'] == 0


def test_failed_live_read_preserves_old_date_and_declares_fallback():
    def failure(url):raise TimeoutError('fixture')
    knowledge=Knowledge();reader=LiveLabLookup(knowledge,fetcher=failure)
    result=reader.lookup({'question':'Example', 'refresh': True})
    assert result['freshness']=='cached-official-fallback'
    assert 'dated cached' in result['warning']
    assert result['sources'][0]['fetched_at']=='2026-10-13T00:00:00+00:00'
    assert result['sources'][0].get('source_kind')!='live-official-lab'


def test_no_page_is_fetched_when_no_public_lab_source_is_selected():
    knowledge=Knowledge();knowledge.lookup=lambda args:{'answer':'Not documented','sources':[]}
    def forbidden(url):raise AssertionError('No fetch should occur')
    result=LiveLabLookup(knowledge,fetcher=forbidden).lookup({'question':'Unknown'})
    assert result['freshness']=='no-live-page-selected'


def test_first_and_later_normal_questions_use_dated_seed_without_any_http():
    def forbidden(url):raise AssertionError('A normal cached question must not fetch')
    knowledge = Knowledge()
    reader = LiveLabLookup(knowledge, fetcher=forbidden)
    for _ in range(2):
        result = reader.lookup({'question': 'Explain Example'})
        assert result['freshness'] == 'cached-official-pages'
        assert result['network_pages_read'] == 0 and not result['refresh_requested']
        assert result['sources'][0]['excerpt'] == blocks(knowledge.pages[0])[0]['excerpt']
        assert result['sources'][0]['fetched_at'] == knowledge.pages[0]['fetched_at']
        assert result['sources'][0]['text_sha256'] == knowledge.pages[0]['text_sha256']
    assert reader.live_reads == 0 and reader.last_checked_at is None


def test_current_wording_revalidates_but_does_not_rename_cached_time():
    reader = LiveLabLookup(Knowledge(), fetcher=lambda url: page(
        'Approach\n\nAn updated method described on the official website.', '2026-10-18T01:00:00Z'))
    first = reader.lookup({'question': 'What is the current Example approach?'})
    second = reader.lookup({'question': 'Explain Example'})
    assert first['refresh_requested'] and first['network_pages_read'] == 1
    assert second['sources'][0]['excerpt'] == first['sources'][0]['excerpt']
    assert second['sources'][0]['fetched_at'] == '2026-10-18T01:00:00Z'
    assert second['freshness'] == 'cached-official-pages'


def test_expired_live_entry_can_answer_immediately_but_current_check_revalidates(monkeypatch):
    reads = []
    reader = LiveLabLookup(Knowledge(), fetcher=lambda url: reads.append(url) or page(
        'Approach\n\nAn updated official description.', '2026-10-18T01:00:00Z'))
    monkeypatch.setattr('lab_backend.live_lab.time.monotonic', lambda: 1000)
    reader.lookup({'question': 'Example', 'refresh': True})
    monkeypatch.setattr('lab_backend.live_lab.time.monotonic', lambda: 1200)
    reader.lookup({'question': 'Example'})
    assert len(reads) == 1
    reader.lookup({'question': 'Example', 'refresh': True})
    assert len(reads) == 2


def test_revalidation_rejects_a_different_or_undated_page():
    for update in ({'url': 'https://example.com/private'}, {'fetched_at': None}):
        foreign = {**page('Approach\n\nUnrelated fetched passage.', '2026-10-18'), **update}
        reader = LiveLabLookup(Knowledge(), fetcher=lambda url: foreign)
        result = reader.lookup({'question': 'Example', 'refresh': True})
        assert result['freshness'] == 'cached-official-fallback'
        assert reader.live_reads == 0
        assert result['sources'][0]['fetched_at'] == '2026-10-13T00:00:00+00:00'
