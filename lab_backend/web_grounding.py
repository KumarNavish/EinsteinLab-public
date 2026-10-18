"""Provider-grounding metadata, without claiming a model paraphrase is a source quote.

No arbitrary HTTP fetch is performed here. This parser can represent provider
grounding packets, but parsing support does not enable an unavailable Search
route. Local-account/private URLs are never treated as public evidence.
"""
from __future__ import annotations
from datetime import datetime, timezone
import hashlib
import ipaddress
import re
from urllib.parse import urlparse, parse_qsl


def public_reference(value):
    if not isinstance(value, str) or len(value) > 5000 or any(ord(c) < 32 for c in value):
        return None
    try:
        parsed = urlparse(value)
        host = (parsed.hostname or '').lower().rstrip('.')
        if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443):
            return None
        if not host or host in {'localhost', 'metadata.google.internal'} or host.endswith(('.local', '.localhost', '.internal', '.onion')):
            return None
        if host in {'mail.google.com', 'drive.google.com', 'docs.google.com', 'calendar.google.com', 'aistudio.google.com'}:
            return None
        try:
            if not ipaddress.ip_address(host).is_global:
                return None
        except ValueError:
            if '.' not in host or not re.fullmatch(r'[a-z0-9.-]+', host):
                return None
        if any(re.fullmatch(r'api.?key|key|token|access.?token|authorization|password|secret|signature', key, re.I) for key, _ in parse_qsl(parsed.query)):
            return None
        return value
    except ValueError:
        return None


def dictionary(value):
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    return value.model_dump(mode='json', exclude_none=True)


def grounding_packet(value):
    metadata = dictionary(value)
    chunks = metadata.get('grounding_chunks', metadata.get('groundingChunks', []))
    supports = metadata.get('grounding_supports', metadata.get('groundingSupports', []))
    stamp = datetime.now(timezone.utc).isoformat()
    sources, index_map = [], {}
    for i, chunk in enumerate(chunks):
        web = chunk.get('web') or {}
        url = public_reference(web.get('uri'))
        if url is None:
            continue
        passages = []
        for support in supports:
            indices = support.get('grounding_chunk_indices', support.get('groundingChunkIndices', []))
            text = support.get('segment', {}).get('text', '')
            if i in indices and text and text not in passages:
                passages.append(text)
        source_id = 'search-' + hashlib.sha256(url.encode()).hexdigest()[:12]
        index_map[i] = source_id
        sources.append({'id': source_id, 'title': web.get('title') or urlparse(url).hostname,
                        'url': url, 'excerpt': '\n'.join(passages)[:1600], 'fetched_at': stamp,
                        'source_kind': 'google-search-grounding', 'epistemic': 'provider-cited',
                        'excerpt_kind': 'model_claim_linked_by_provider_not_verbatim_quote',
                        'source_scope': 'live-web-search', 'text_sha256': None})
    mapped_supports = []
    for support in supports:
        ids = [index_map[i] for i in support.get('grounding_chunk_indices', support.get('groundingChunkIndices', [])) if i in index_map]
        text = support.get('segment', {}).get('text', '')
        if ids and text:
            mapped_supports.append({'claim': text, 'source_ids': ids})
    entry = metadata.get('search_entry_point', metadata.get('searchEntryPoint', {})) or {}
    return {'sources': sources, 'supports': mapped_supports,
            'queries': metadata.get('web_search_queries', metadata.get('webSearchQueries', [])),
            'search_suggestions_html': entry.get('rendered_content', entry.get('renderedContent', ''))[:80000],
            'checked_at': stamp, 'grounding_limit': 'Provider citation links are provenance, not an independent truth or entailment proof.'}


def _without_freshness_dates(text, sources):
    """Exclude only qualified, cited retrieval dates from study-number checks."""
    dates = set()
    for source in sources:
        stamp = source.get('fetched_at')
        if isinstance(stamp, str):
            try:
                dates.add(datetime.fromisoformat(stamp.replace('Z', '+00:00')).date().isoformat())
            except ValueError:
                pass

    def checked_date(match):
        if match[1] not in dates:
            raise ValueError('Freshness date not in cited source metadata')
        return ''

    return re.sub(r'\b(?:fetched|retrieved|accessed|captured|checked|snapshot)'
                  r'(?:\s+(?:on|at|from|dated|as\s+of))?(?:\s*:\s*|\s+)'
                  r'(\d{4}-\d{2}-\d{2})\b', checked_date, text, flags=re.I)


def validated_flash_answer(value, sources):
    """Bind every returned factual claim to an actually supplied source substring."""
    if not isinstance(value, dict) or not isinstance(value.get('claims'), list) or not 1 <= len(value['claims']) <= 5:
        raise ValueError('No bounded claim list')
    mapping = {source['id']: source for source in sources}
    checked, used = [], []
    norm = lambda text: ' '.join(text.split())
    for claim in value['claims']:
        if not isinstance(claim, dict) or not isinstance(claim.get('text'), str) or not 8 <= len(claim['text']) <= 600:
            raise ValueError('Invalid claim')
        kind = claim.get('kind')
        if kind not in {'documented', 'anticipated', 'interpretation', 'uncertain'}:
            raise ValueError('Unstated evidence level')
        evidence = claim.get('evidence', [])
        if not isinstance(evidence, list) or len(evidence) > 3:
            raise ValueError('Invalid evidence list')
        if kind != 'uncertain' and not evidence:
            raise ValueError('Claim without evidence')
        for item in evidence:
            if not isinstance(item, dict) or item.get('source_id') not in mapping:
                raise ValueError('Unknown source')
            source = mapping[item['source_id']]
            quote = item.get('quote')
            if not isinstance(quote, str) or not 20 <= len(quote) <= 320 or norm(quote) not in norm(source['excerpt']):
                raise ValueError('Quote does not match supplied evidence')
            if source['id'] not in used:
                used.append(source['id'])
        text = claim['text'].strip()
        expected = evidence and all(mapping[item['source_id']].get('epistemic') == 'anticipated' or re.search(r'\b(expect|anticipat|hypothes)\w*', item['quote'], re.I) for item in evidence)
        if expected and re.search(r'\b(improv|enhanc|reduc|outperform|proven|demonstrat|establish)\w*', text, re.I) and not re.search(r'\b(aim|expect|hypothes|anticipat|test|may|might|could|not|no|cannot)\w*', text, re.I):
            raise ValueError('Hypothesis-only evidence does not establish the asserted result')

        if kind == 'anticipated' and not re.search(r'aim|expect|hypothes|anticipat|test|may|might|could|ongoing', text, re.I):
            raise ValueError('Expected outcome lacks qualification')
        if kind == 'interpretation':
            text = 'My interpretation is: ' + text[0].lower() + text[1:]
        if kind == 'uncertain':
            explicit = re.search(r'\b(?:not|unclear|uncertain|cannot|doesn.t|unavailable|insufficient)\b', text, re.I)
            absence = re.search(r'\b(?:no|neither|lack(?:s|ed|ing)?)\b', text, re.I)
            scoped = re.search(r'\b(?:supplied|provided|cited)\s+(?:(?:source|results?)\s+)?'
                               r'(?:excerpts?|sources?|passages?|pages?|documents?|evidence)\b', text, re.I)
            if not (explicit or absence and scoped):
                raise ValueError('Uncertainty must be explicit')
        cited_sources = [mapping[item['source_id']] for item in evidence]
        numeric_text = _without_freshness_dates(text, cited_sources)
        numeric = set(re.findall(r'\b\d+(?:\.\d+)?%?', numeric_text))
        cited = ' '.join(mapping[item['source_id']]['excerpt'] for item in evidence)
        if kind != 'uncertain' and not numeric <= set(re.findall(r'\b\d+(?:\.\d+)?%?', cited)):
            raise ValueError('Number not in cited source')
        checked.append({'text': text, 'kind': kind, 'evidence': evidence})
    return {'answer': ' '.join(claim['text'] for claim in checked), 'claims': checked,
            'sources': [mapping[source_id] for source_id in used],
            'status': 'source-bound', 'grounding_limit': 'Source IDs, exact substrings and selected overclaim checks passed; semantic entailment is not proven.'}
