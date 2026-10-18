"""Bounded, stateless Responses JSON requests; no tools or provider fallback.

Wire format: https://developers.openai.com/api/docs/guides/structured-outputs
Image input: https://developers.openai.com/api/docs/guides/images-vision
Model: https://developers.openai.com/api/docs/models/gpt-6.1-sol
No request/response bodies, authorization values or upstream errors are logged.
"""
from __future__ import annotations
import asyncio
import json
import re
import httpx

OPENAI_MODEL = 'gpt-6.1-sol'
ENDPOINT = 'https://api.openai.com/v1/responses'
MAX_REQUEST_BYTES = 512_000
MAX_RESPONSE_BYTES = 128_000


class EvidenceRequestError(Exception):
    """Only finite local issue labels and an optional HTTP status escape."""
    def __init__(self, issue, code=None):
        super().__init__('The bounded OpenAI evidence request did not complete.')
        self.issue, self.code = issue, code


def strict_schema(value):
    if isinstance(value, list): return [strict_schema(item) for item in value]
    if not isinstance(value, dict): return value
    result = {key: strict_schema(item) for key, item in value.items()}
    if result.get('type') == 'object':
        result['additionalProperties'] = False
        result['required'] = list(result.get('properties', {}))
    return result


async def responses_json(credential, *, model, instructions, content, schema, name,
                         max_output_tokens, timeout_seconds, transport=None):
    """One request; callers still validate every returned observation/claim."""
    if (not isinstance(model, str) or not re.fullmatch(r'[a-zA-Z0-9._-]{1,100}', model)
            or type(max_output_tokens) is not int or not 1 <= max_output_tokens <= 3000
            or type(timeout_seconds) not in (int, float) or not 0 < timeout_seconds <= 30):
        raise EvidenceRequestError('invalid_request')
    payload = {'model': model, 'instructions': instructions,
               'input': [{'role': 'user', 'content': content}],
               'text': {'format': {'type': 'json_schema', 'name': name,
                                   'schema': strict_schema(schema), 'strict': True}},
               'reasoning': {'effort': 'low'}, 'max_output_tokens': max_output_tokens,
               'store': False, 'tools': [], 'tool_choice': 'none', 'service_tier': 'default'}
    try:
        encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode()
        if len(encoded) > MAX_REQUEST_BYTES: raise EvidenceRequestError('request_too_large')
        async with asyncio.timeout(timeout_seconds):
            try: key = credential()
            except Exception: raise EvidenceRequestError('credential_unavailable') from None
            if not isinstance(key, str) or not key or '\n' in key or '\r' in key:
                raise EvidenceRequestError('credential_unavailable')
            async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_seconds, connect=min(5, timeout_seconds)),
                                         trust_env=False, follow_redirects=False, transport=transport) as client:
                async with client.stream('POST', ENDPOINT, content=encoded,
                                         headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'}) as response:
                    if response.status_code != 200:
                        raise EvidenceRequestError('http_status', response.status_code)
                    if response.headers.get('content-type', '').split(';')[0].strip() != 'application/json':
                        raise EvidenceRequestError('response_content_type')
                    chunks = bytearray()
                    async for chunk in response.aiter_bytes():
                        if len(chunks) + len(chunk) > MAX_RESPONSE_BYTES:
                            raise EvidenceRequestError('response_too_large')
                        chunks.extend(chunk)
        result = json.loads(chunks)
        if not isinstance(result, dict) or result.get('status') != 'completed' or result.get('error') or result.get('incomplete_details'):
            raise EvidenceRequestError('response_incomplete')
        actual_model = result.get('model')
        if not isinstance(actual_model, str) or not re.fullmatch(re.escape(model) + r'(?:-\d{4}-\d{2}-\d{2})?', actual_model):
            raise EvidenceRequestError('response_model_mismatch')
        output = result.get('output')
        if not isinstance(output, list) or not 1 <= len(output) <= 8:
            raise EvidenceRequestError('response_output_shape')
        texts = []
        for item in output:
            if not isinstance(item, dict): raise EvidenceRequestError('response_output_shape')
            if item.get('type') == 'reasoning': continue
            if item.get('type') != 'message' or item.get('role') != 'assistant' or item.get('status') != 'completed':
                raise EvidenceRequestError('response_output_shape')
            parts = item.get('content')
            if not isinstance(parts, list): raise EvidenceRequestError('response_output_shape')
            for part in parts:
                if not isinstance(part, dict): raise EvidenceRequestError('response_output_shape')
                if part.get('type') == 'refusal': raise EvidenceRequestError('response_refused')
                if part.get('type') != 'output_text' or not isinstance(part.get('text'), str):
                    raise EvidenceRequestError('response_output_shape')
                texts.append(part['text'])
        if len(texts) != 1 or not 1 <= len(texts[0]) <= 24_000:
            raise EvidenceRequestError('response_output_shape')
        usage = result.get('usage') or {}
        safe_usage = {key: usage[key] for key in ['input_tokens', 'output_tokens', 'total_tokens']
                      if isinstance(usage, dict) and type(usage.get(key)) is int and usage[key] >= 0}
        for parent, keys in [('input_tokens_details', ['cached_tokens', 'cache_write_tokens']),
                             ('output_tokens_details', ['reasoning_tokens'])]:
            details = usage.get(parent) if isinstance(usage, dict) else None
            if isinstance(details, dict):
                safe_usage[parent] = {key: details[key] for key in keys if type(details.get(key)) is int and details[key] >= 0}
        return {'text': texts[0], 'model': actual_model, 'usage': safe_usage}
    except asyncio.CancelledError:
        raise
    except EvidenceRequestError:
        raise
    except TimeoutError:
        raise EvidenceRequestError('request_timeout') from None
    except httpx.HTTPError:
        raise EvidenceRequestError('request_transport') from None
    except Exception:
        raise EvidenceRequestError('response_decode') from None
