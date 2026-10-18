"""Deterministic tool tests; provider requests are mocked, never represented as live browsing."""
from __future__ import annotations
import asyncio
from decimal import Decimal
import json
import pytest
from lab_backend.reasoning_tools import arithmetic, ReasoningSession
from lab_backend.public_research import PublicResearch, parse_sources, decode_rpc, admitted_url, safe_query


@pytest.mark.parametrize('expression,expected', [
    ('(250-200)/250*100','20'),('0.1+0.2','0.3'),('sqrt(144)+abs(-3)','15'),
    ('min(2,8)+max(4,7)','9'),('2**10','1024'),('-4/2','-2')])
def test_calculation_result(expression,expected):
    assert Decimal(arithmetic(expression)['result']) == Decimal(expected)


@pytest.mark.parametrize('expression', ['__import__("os").system("id")', '(1).__class__', '[x for x in [1]]',
    '2**1000000','1/0','sqrt(-1)','1e999','open("/tmp/file")'])
def test_calculator_is_not_a_code_execution_tool(expression):
    with pytest.raises((ValueError,SyntaxError)):
        arithmetic(expression)


def test_plan_is_not_claimed_as_execution_and_draft_does_not_write(tmp_path,monkeypatch):
    monkeypatch.chdir(tmp_path)
    session=ReasoningSession()
    result=session.run('plan_work',{'goal':'Compare two public projects','steps':['Read the project sources','Identify uncertainty','Draft a note']})
    assert result['plan']['status']=='planned-not-executed'
    assert session.events==[]
    source={'id':'actual-source','title':'Project evidence','url':'https://mobililab.ethz.ch/','excerpt':'Actual returned public text.'}
    session.observe('lookup_lab',{'sources':[source]})
    note=session.run('deliver_note',{'title':'Reviewable comparison','markdown':'This draft preserves the source limits.','source_ids':['actual-source']})
    assert note['status']=='draft-ready' and 'https://mobililab.ethz.ch/' in note['markdown']
    assert len(note['tool_receipts'])==1 and note['tool_receipts'][0]['tool']=='lookup_lab'
    assert list(tmp_path.iterdir())==[]


def test_draft_cannot_invent_source_ids():
    with pytest.raises(ValueError):
        ReasoningSession().run('deliver_note',{'title':'Invented','markdown':'Here is a claimed research result.','source_ids':['fabricated-source']})


def test_unavailable_external_actions_are_not_tools():
    with pytest.raises(ValueError):
        ReasoningSession().run('send_email',{'to':'nobody@example.com','body':'test'})


@pytest.mark.parametrize('url',['http://example.org/','https://127.0.0.1/','https://localhost/',
    'https://192.168.1.10/','https://docs.google.com/document/d/private','https://example.org/?token=secret',
    'https://user:password@example.org/','https://machine.lan/','file:///etc/passwd','javascript:alert(1)'])
def test_nonpublic_and_credentialled_urls_rejected(url):
    with pytest.raises(ValueError):admitted_url(url)


def test_query_does_not_admit_credentials():
    with pytest.raises(ValueError):safe_query('Please search for AQ.'+'x'*40)


def test_observed_search_formatter_preserves_provenance():
    response={'content':[{'type':'text','text':'Title: Official example\nURL: https://www.esa.int/\nPublished: 2026-10-01\nAuthor: ESA\nHighlights:\nThis is a bounded public source excerpt.\n\n---\n\nTitle: Not public\nURL: https://localhost/\nHighlights:\nThis must not be admitted.'}]}
    sources=parse_sources(response,'search')
    assert len(sources)==1 and sources[0]['url']=='https://www.esa.int/'
    assert sources[0]['excerpt']=='This is a bounded public source excerpt.'
    assert sources[0]['source_scope']=='provider-search-highlights'


def test_observed_fetch_formatter_is_distinct_from_search_highlight():
    response={'content':[{'type':'text','text':'# An official page\nURL: https://www.esa.int/Science_Exploration\nPublished: 2026-10-01\n\nActual extracted content, not a model summary.'}]}
    sources=parse_sources(response,'read')
    assert sources[0]['source_scope']=='provider-page-extraction'
    assert sources[0]['excerpt']=='Actual extracted content, not a model summary.'


def test_rpc_error_never_becomes_fake_evidence():
    with pytest.raises(ValueError):decode_rpc('data: '+json.dumps({'jsonrpc':'2.0','id':1,'result':{'isError':True,'content':[{'type':'text','text':'quota'}]}}))


def test_unapproved_public_search_makes_no_provider_call():
    calls=[]
    async def transport(name,args):calls.append((name,args));return {'content':[]}
    async def run():
        adapter=PublicResearch(transport=transport)
        result=await adapter.run('search',{'query':'public research'},approved=False)
        assert result['status']=='approval-required' and adapter.calls==0 and calls==[]
    asyncio.run(run())


def test_mock_search_uses_only_documented_keyless_tools_and_no_auth():
    observed=[]
    async def transport(name,args):
        observed.append((name,args))
        return {'content':[{'type':'text','text':'Title: Test primary source\nURL: https://www.esa.int/\nHighlights:\nThe result supplied by the isolated test fixture.'}]}
    async def run():
        adapter=PublicResearch(transport=transport)
        result=await adapter.run('search',{'query':'official space mission evidence','objective':'Prefer official sources'},approved=True)
        assert result['status']=='sources-found'
        assert observed[0][0]=='web_search_exa'
        assert set(observed[0][1])=={'query','objective','numResults'}
        assert result['sources'][0]['source_kind']=='exa-public-search'
    asyncio.run(run())


def test_decimal_literals_are_not_rounded_through_binary_float():
    assert Decimal(arithmetic('0.100000000000000001-0.1')['result']) == Decimal('0.000000000000000001')


def test_extreme_small_literal_is_rejected_not_silently_rounded_to_zero():
    with pytest.raises(ValueError): arithmetic('1e-999999')


@pytest.mark.parametrize('url',['https://bucket.s3.amazonaws.com/object?X-Amz-Signature=private','https://storage.googleapis.com/object?X-Goog-Credential=private','https://example.org/file?sig=private'])
def test_signed_public_host_links_are_not_sent_to_external_fetcher(url):
    with pytest.raises(ValueError):admitted_url(url)
