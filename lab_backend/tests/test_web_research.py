import asyncio
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import pytest
from lab_backend.web_grounding import public_reference, grounding_packet, validated_flash_answer
from lab_backend.flash_research import FlashResearch, ResearchBudget

@pytest.mark.parametrize('url', ['http://example.com', 'https://127.0.0.1/', 'https://[::1]/', 'https://169.254.169.254/', 'https://localhost/', 'https://a.internal/', 'https://user:password@example.com/', 'file:///etc/passwd', 'https://example.com/?api_key=example', 'https://docs.google.com/document/d/private', 'https://example.com:444/'])
def test_private_or_credential_bearing_urls_not_sent_to_provider(url):
    assert public_reference(url) is None


def test_grounding_only_uses_provider_returned_web_sources():
    value = {'groundingChunks': [{'web': {'uri': 'https://ethz.ch/research', 'title': 'ETH'}}, {'web': {'uri': 'https://127.0.0.1/secret', 'title': 'invalid'}}],
             'groundingSupports': [{'segment': {'text': 'The lab studies responsible AI.'}, 'groundingChunkIndices': [0]}],
             'webSearchQueries': ['ETH lab responsible AI'], 'searchEntryPoint': {'renderedContent': '<span>Google</span>'}}
    packet = grounding_packet(value)
    assert len(packet['sources']) == 1
    assert packet['sources'][0]['excerpt_kind'].endswith('not_verbatim_quote')
    assert packet['supports'][0]['source_ids'] == [packet['sources'][0]['id']]
    assert packet['search_suggestions_html'] == '<span>Google</span>'

SOURCE = {'id': 'lab-1', 'title': 'Project', 'url': 'https://mobililab.ethz.ch/?research-proj-posts=example',
          'excerpt': 'We expect that personalized scenes will improve relaxation. The project is ongoing.', 'fetched_at': '2026-10-14T00:00:00Z'}
def claim(text='The project expects improved relaxation.', kind='anticipated', quote='We expect that personalized scenes will improve relaxation.'):
    return {'claims': [{'text': text, 'kind': kind, 'evidence': [{'source_id': 'lab-1', 'quote': quote}]}]}


def test_exact_source_quote_is_required():
    with pytest.raises(ValueError):
        validated_flash_answer(claim(quote='The intervention was proven to cure stress disorders.'), [SOURCE])


def test_anticipated_claim_requires_qualification():
    with pytest.raises(ValueError):
        validated_flash_answer(claim(text='Personalized scenes improve relaxation.'), [SOURCE])
    assert validated_flash_answer(claim(), [SOURCE])['status'] == 'source-bound'


def test_new_numeric_claim_is_rejected():
    with pytest.raises(ValueError):
        validated_flash_answer(claim(text='The project expects a 48% benefit.'), [SOURCE])


def test_unknown_source_and_missing_evidence_are_rejected():
    value = claim(); value['claims'][0]['evidence'][0]['source_id'] = 'invented'
    with pytest.raises(ValueError): validated_flash_answer(value, [SOURCE])
    value = claim(); value['claims'][0]['evidence'] = []
    with pytest.raises(ValueError): validated_flash_answer(value, [SOURCE])


def test_interpretation_gets_explicit_spoken_label():
    checked = validated_flash_answer(claim(text='Personal control may matter for usability.', kind='interpretation'), [SOURCE])
    assert checked['answer'].startswith('My interpretation is:')


@pytest.mark.parametrize('text', [
    'No expected outcomes are stated in the supplied excerpts.',
    'Neither of the supplied excerpts states an expected outcome.',
    'The provided pages lack a separate statement of expected outcomes.',
    'The cited source passages are lacking an expected-outcome statement.',
])
def test_explicit_source_scoped_absence_is_uncertain(text):
    assert validated_flash_answer(claim(text=text, kind='uncertain'), [SOURCE])['status'] == 'source-bound'


@pytest.mark.parametrize('text', [
    'No expected outcomes have been reported anywhere.',
    'Neither comparator improved relaxation.',
    'The literature lacks evidence of benefit.',
    'Notably, the supplied excerpts establish a benefit.',
    'The supplied excerpts establish a benefit.',
])
def test_unscoped_absence_and_affirmative_claims_cannot_gain_uncertain_label(text):
    with pytest.raises(ValueError):
        validated_flash_answer(claim(text=text, kind='uncertain'), [SOURCE])


@pytest.mark.parametrize('qualification', ['fetched on', 'retrieved', 'accessed at', 'captured on',
                                           'checked as of', 'snapshot dated', 'snapshot:'])
def test_only_qualified_cited_freshness_dates_are_separate_from_study_numbers(qualification):
    text = f'The project expects improved relaxation; source {qualification} 2026-10-14.'
    assert validated_flash_answer(claim(text=text), [SOURCE])['status'] == 'source-bound'


@pytest.mark.parametrize('text', [
    'The project expects a 14% benefit; source fetched on 2026-10-14.',
    'The project expects gains for 10 participants; source fetched on 2026-10-14.',
    'The project expects gains for 2026 participants; source fetched on 2026-10-14.',
    'The project expects benefits in 2026-10-14.',
])
def test_freshness_timestamp_digits_do_not_authorize_study_numbers(text):
    with pytest.raises(ValueError, match='Number not in cited source'):
        validated_flash_answer(claim(text=text), [SOURCE])


@pytest.mark.parametrize('stamp', [None, '', 20261014, '2026-02-30T00:00:00Z', '2026-10-15T00:00:00Z'])
def test_freshness_date_requires_valid_matching_cited_metadata(stamp):
    with pytest.raises(ValueError, match='Freshness date not in cited source metadata'):
        validated_flash_answer(claim(text='The project expects improved relaxation; source fetched on 2026-10-14.'),
                               [{**SOURCE, 'fetched_at': stamp}])


def test_uncited_freshness_metadata_cannot_authorize_a_date():
    other = {**SOURCE, 'id': 'other', 'fetched_at': '2026-10-15T00:00:00Z'}
    with pytest.raises(ValueError, match='Freshness date not in cited source metadata'):
        validated_flash_answer(claim(text='The project expects improved relaxation; source fetched on 2026-10-15.'),
                               [SOURCE, other])


def test_actual_vr_result_allows_its_supplied_retrieval_date_without_changing_claim():
    excerpt = ('A single training session resulted in a reduction of perceived stress, an improvement of mood '
               'and an increase in feelings of relaxation. Moreover, increases in heart rate variability target '
               'parameters were significantly higher in VR than on a classical screen ( Weibel et al. 2023 ).')
    assert hashlib.sha256(excerpt.encode()).hexdigest() == '3a3cdad9e0844b5b679dc918c9ad47f46ec027116f0e4ff23c578a07ab137158'
    source = {**SOURCE, 'id': 'fdf2d533008f5de3', 'excerpt': excerpt,
              'title': 'VR for Relaxation', 'url': 'https://mobililab.ethz.ch/?research-proj-posts=vr-for-relaxation',
              'fetched_at': '2026-10-17T15:24:32.070832+00:00'}
    text = 'These supplied excerpts were fetched on 2026-10-17 and report documented results rather than a separate expected outcome.'
    value = {'claims': [{'text': text, 'kind': 'documented', 'evidence': [{
        'source_id': source['id'], 'quote': excerpt.split('. Moreover')[0] + '.'}]}]}
    checked = validated_flash_answer(value, [source])
    assert checked['answer'] == text and checked['status'] == 'source-bound'


def test_daily_budget_persists_between_instances(tmp_path):
    for _ in range(50): ResearchBudget(tmp_path).reserve()
    with pytest.raises(ValueError): ResearchBudget(tmp_path).reserve()


class Config:
    def approval(self): return {'billing_tier': 'Free tier'}
class Knowledge:
    project_titles = ['Project']
    def lookup(self, args): return {'sources': [SOURCE]}


def test_flash_cache_and_metadata_use_mock_not_provider(tmp_path):
    requests = []
    async def transport(question, sources):
        requests.append(question)
        return json.dumps(claim()), {'total_token_count': 150}
    research = FlashResearch(tmp_path, Config(), Knowledge(), transport=transport)
    async def run():
        first = await research.answer({'question': 'What does Project expect?', 'project_titles': ['Project']})
        second = await research.answer({'question': 'What does Project expect?', 'project_titles': ['Project']})
        assert first['status'] == 'source-bound' and second['cached']
    asyncio.run(run())
    assert len(requests) == 1 and research.successes == 1


def test_flash_failure_is_visible_not_claimed_verified(tmp_path):
    async def transport(question, sources): raise TimeoutError('test fixture')
    research = FlashResearch(tmp_path, Config(), Knowledge(), transport=transport)
    result = asyncio.run(research.answer({'question': 'Explain Project', 'project_titles': ['Project']}))
    assert result['status'] == 'unavailable' and not result['automatic_paid_fallback']
    assert research.successes == 0


def test_private_question_abstains_without_provider_call(tmp_path):
    async def transport(question, sources): raise AssertionError('Must not be reached')
    research = FlashResearch(tmp_path, Config(), Knowledge(), transport=transport)
    result = asyncio.run(research.answer({'question': 'What are the confidential salaries?'}))
    assert result['status'] == 'outside-public-scope'


def test_model_cannot_relable_hypothesis_as_documented_result():
    with pytest.raises(ValueError):
        validated_flash_answer(claim(text="The scenes demonstrably improve relaxation.", kind="documented"), [SOURCE])


def test_only_explicit_temporary_provider_failures_retry_once(tmp_path):
    class Busy(Exception): code=503
    requests=[]
    async def transport(question,sources):
        requests.append(question)
        if len(requests)==1: raise Busy("fixture")
        return json.dumps(claim()), {}
    research=FlashResearch(tmp_path,Config(),Knowledge(),transport=transport)
    result=asyncio.run(research.answer({'question':'Explain Project','project_titles':['Project']}))
    assert result['status']=='source-bound' and result['provider_attempts']==2
    assert json.loads(research.budget.path.read_text())['flash_requests']==2


def test_quota_rejection_is_not_retried(tmp_path):
    class Quota(Exception): code=429
    requests=[]
    async def transport(question,sources):requests.append(question);raise Quota('fixture')
    research=FlashResearch(tmp_path,Config(),Knowledge(),transport=transport)
    result=asyncio.run(research.answer({'question':'Explain Project','project_titles':['Project']}))
    assert result['status']=='unavailable' and len(requests)==1
