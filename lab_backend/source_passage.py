"""Display exact passages already retrieved by the existing authorized lab tools.

This is NOT a new reader, URL fetcher, PDF parser or upload route. It accepts only
source objects present in the current conversation's inspected-source ledger.
"""
from __future__ import annotations
import hashlib
from urllib.parse import urlsplit


def source_passage(source, quote=''):
    if not isinstance(source, dict) or not isinstance(source.get('excerpt'), str):
        raise ValueError('The inspected source has no displayable text passage')
    text = source['excerpt']
    if not text.strip() or len(text) > 100000:
        raise ValueError('The inspected source text is absent or exceeds the display budget')
    if not isinstance(quote, str) or len(quote) > 500:
        raise ValueError('Use an exact quotation of at most 500 characters')
    start = text.find(quote) if quote else 0
    if start < 0:
        raise ValueError('That quotation is not present verbatim in the inspected source')
    left = max(0, start - 300) if quote else 0
    if left:
        # A source window begins at a word boundary; the original indices survive.
        next_space = text.find(' ', left, min(start, left + 100))
        if next_space >= 0: left = next_space + 1
    right = min(len(text), left + 1400)
    if quote and start + len(quote) > right:
        right = start + len(quote)
    displayed = text[left:right]
    url = source.get('url')
    parsed = urlsplit(url or '')
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('The inspected source has no safe public attribution URL')
    return {'source_id': source['id'], 'title': str(source.get('title') or 'Inspected source')[:180],
            'url': url, 'fetched_at': source.get('fetched_at'), 'text': displayed,
            'source_excerpt_sha256': hashlib.sha256(text.encode()).hexdigest(),
            'displayed_text_sha256': hashlib.sha256(displayed.encode()).hexdigest(),
            'source_range': [left, right], 'omitted_before': left > 0, 'omitted_after': right < len(text),
            'quote': quote, 'quote_range': [start - left, start - left + len(quote)] if quote else None,
            'scope': 'Verbatim excerpt from an already inspected public source, not the complete webpage or an original paper figure.'}


def focus_passage(current, quote):
    if not current or not isinstance(quote, str) or not 1 <= len(quote) <= 500:
        raise ValueError('Select a short exact phrase from the visible source excerpt')
    index = current['text'].find(quote)
    if index < 0:
        raise ValueError('That exact phrase is not visible in the current excerpt; show the relevant source passage first')
    return {**current, 'quote': quote, 'quote_range': [index, index + len(quote)]}


def passage_declarations():
    return [
        {'name': 'show_source_passage', 'behavior': 'BLOCKING',
         'description': 'Replace the conceptual whiteboard with an EXACT excerpt from an already inspected source. First lookup_lab or another available evidence tool; select its actual source_id. Optionally quote an exact source substring to highlight it. The display preserves source wording and links; it is not the full paper, original figure, PDF or a new source read. Use this to distinguish source evidence from your own conceptual drawings.',
         'parameters': {'type':'OBJECT','properties': {'source_id':{'type':'STRING'},'quote':{'type':'STRING'}},'required':['source_id']}},
        {'name':'focus_source_phrase','behavior':'BLOCKING',
         'description':'Highlight an exact phrase in the current source-excerpt display and point at it while explaining. Copy wording literally. Do not paraphrase inside the quotation. Success requires a rendered acknowledgement.',
         'parameters':{'type':'OBJECT','properties':{'quote':{'type':'STRING'}},'required':['quote']}}
    ]
