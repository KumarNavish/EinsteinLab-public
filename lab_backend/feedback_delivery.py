"""Private durable feedback delivery through the owner's existing free site.

Configure only after verifying the site's actual free allowance and hard limit.
Owner readback, rather than this HTTP acknowledgement, is the release evidence.
"""
import os
import re
from urllib.parse import urlsplit
import httpx


class PrivateFeedbackRelay:
    """Write immutable private feedback through one authenticated server endpoint."""
    url = 'https://einstein-mobiliar-lab.netlify.app/.netlify/functions/receive-feedback'
    collection = 'private-netlify-blobs'
    idempotent = True

    def __init__(self, secret, *, transport=None):
        if not isinstance(secret, str) or not re.fullmatch(r'[a-f0-9]{64}', secret):
            raise ValueError('The private feedback relay secret is invalid.')
        self.secret, self.transport = secret, transport

    async def submit(self, value):
        async with httpx.AsyncClient(timeout=8, follow_redirects=False, trust_env=False, transport=self.transport) as client:
            response = await client.post(self.url, json=value, headers={'Authorization': 'Bearer ' + self.secret})
            try: result = response.json()
            except ValueError: result = {}
            if response.status_code != 200 or result.get('received') is not True or result.get('id') != value.get('request_id'):
                raise ValueError('The private collection did not confirm this submission.')


def configured_feedback():
    secret = os.environ.get('EINSTEIN_FEEDBACK_RELAY_SECRET')
    if secret and os.environ.get('EINSTEIN_FEEDBACK_FREE_ALLOWANCE_VERIFIED') == 'true':
        return PrivateFeedbackRelay(secret)
    return NetlifyFeedback.configured()


class NetlifyFeedback:
    def __init__(self, url, *, transport=None):
        parsed = urlsplit(url)
        if parsed.scheme != 'https' or not parsed.hostname or not parsed.hostname.endswith('.netlify.app') or parsed.username or parsed.port or parsed.query or parsed.fragment:
            raise ValueError('Feedback needs an exact HTTPS Netlify site URL.')
        self.url, self.transport = url, transport

    async def submit(self, value):
        fields = {key: str(item) for key, item in value.items() if item is not None}
        fields['form-name'] = 'einstein-feedback'
        async with httpx.AsyncClient(timeout=8, follow_redirects=False, trust_env=False, transport=self.transport) as client:
            response = await client.post(self.url, data=fields)
            # A redirect can also be a CAPTCHA rejection, not a stored response.
            if response.status_code not in {200, 201}:
                raise ValueError('The collection provider did not accept the submission.')

    @classmethod
    def configured(cls):
        url = os.environ.get('EINSTEIN_FEEDBACK_FORM_URL')
        if url and os.environ.get('EINSTEIN_FEEDBACK_FREE_ALLOWANCE_VERIFIED') == 'true':
            return cls(url)
        return None
