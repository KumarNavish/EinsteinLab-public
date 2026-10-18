"""Operator-only prepaid OpenAI configuration for the public application."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import math
import os
import re
import secrets

from .native_config import NativeConfig

MODEL = 'gpt-live-1'


def operator_voice_id():
    """Only the host operator may pin a saved, non-secret GPT-Live voice ID."""
    value = os.environ.get('EINSTEIN_OPENAI_VOICE_ID')
    if value is not None and not re.fullmatch(r'voice_[A-Za-z0-9_-]{1,128}', value):
        raise ValueError('The configured OpenAI voice ID needs an operator check.')
    return value


PRIVACY = ('Your voice, questions, and page images or video frames you choose to share are processed by OpenAI. '
           'OpenAI normally retains abuse-monitoring logs for up to 30 days and may retain backend response state. '
           'Einstein does not save microphone audio or conversation transcripts. Please keep confidential material out of this conversation.')


class OpenAIDeploymentConfig(NativeConfig):
    provider = 'OpenAI'
    model = MODEL
    privacy = PRIVACY
    continuous_audio = True
    # Official Live stock voice: German, masculine, natural. Performance and
    # English pronunciation still require a listening evaluation.
    # https://developers.openai.com/api/docs/guides/live-conversations#voice-options
    default_voice = 'flitz'
    voices = {
        'flitz': {'label': 'Flitz · German', 'description': 'Natural German masculine voice, directed to speak English.'},
        'cedar': {'label': 'Cedar', 'description': 'Alternative OpenAI stock voice with the selected performance direction.'},
        'marin': {'label': 'Marin', 'description': 'Alternative OpenAI stock voice with the selected performance direction.'},
    }
    billing_basis = 'Prepaid API credit with an enforced project spending limit.'

    def __init__(self, root):
        super().__init__(root)
        self.voices = dict(self.voices)
        if voice := operator_voice_id():
            self.default_voice = voice
            self.voices[voice] = {
                'label': 'Elder German · designed',
                'description': 'AI-designed elderly masculine voice with strong German-accented English.',
            }

    def read_proof(self):
        try:
            value = json.loads(os.environ.get('EINSTEIN_OPENAI_APPROVAL', ''))
        except (ValueError, TypeError):
            raise ValueError('OpenAI conversations are awaiting operator setup.') from None
        if not isinstance(value, dict):
            raise ValueError('OpenAI conversations are awaiting operator setup.')
        return value

    def approval(self):
        proof = self.read_proof()
        now = datetime.now(timezone.utc)
        try:
            expires = datetime.fromisoformat(proof['expires_at'])
            verified = datetime.fromisoformat(proof['verified_at'])
            limit = proof['monthly_limit_usd']
            credit = proof['confirmed_credit_usd']
            valid = (
                proof.get('model') == MODEL
                and proof.get('external_processing_approved') is True
                and proof.get('hard_limit_enforced') is True
                and proof.get('automatic_reload') is False
                and proof.get('model_access_verified') is True
                and proof.get('budget_period') == now.strftime('%Y-%m')
                and expires.tzinfo is not None and verified.tzinfo is not None
                and verified <= now < expires
                and type(limit) in (int, float) and math.isfinite(limit) and 0 < limit <= 75
                and type(credit) in (int, float) and math.isfinite(credit) and credit > 0
                and isinstance(proof.get('project_id'), str)
                and re.fullmatch(r'proj_[A-Za-z0-9]{10,80}', proof['project_id'])
                and isinstance(proof.get('key_sha256'), str)
                and re.fullmatch(r'[0-9a-f]{64}', proof['key_sha256'])
            )
        except (ValueError, TypeError, KeyError):
            valid = False
        if not valid:
            raise ValueError('The OpenAI funding or spending-limit approval needs an operator check.')
        return proof

    def credential(self):
        proof = self.approval()
        key = os.environ.get('OPENAI_API_KEY', '')
        if (not re.fullmatch(r'sk-[A-Za-z0-9_-]{16,1000}', key)
                or not secrets.compare_digest(hashlib.sha256(key.encode()).hexdigest(), proof['key_sha256'])):
            raise ValueError('The host credential does not match the approved Einstein key.')
        return key

    def status(self):
        try:
            proof = self.approval()
            self.credential()
            configured, reason = True, None
        except (ValueError, OSError) as error:
            proof, configured, reason = {}, False, str(error)
        return {
            'available': configured, 'configured': configured, 'provider': self.provider,
            'model': self.model, 'privacy': self.privacy, 'reason': reason,
            'free_tier_verified': False, 'funding_verified': configured,
            'provider_session_verified': self.provider_verified,
            'session_max_seconds': 600, 'automatic_paid_fallback': False,
            'billing_basis': self.billing_basis, 'monthly_limit_usd': proof.get('monthly_limit_usd'),
            'approval_expires': proof.get('expires_at'), 'continuous_audio': True,
        }

    def store_operator_key(self, *_):
        raise ValueError('Public credential configuration is disabled. Use the host secret store.')
