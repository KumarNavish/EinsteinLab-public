"""Fail-closed configuration for an optional, explicitly selected free-tier voice.

Keys are supplied by the operator in the local UI. No browser credential scraping,
clipboard reading, billing changes, or paid-model fallback is performed here.
"""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
import json
import os
from pathlib import Path
import re
import secrets
import time

MODEL = "gemini-3.8-live"
PRIVACY = "Native voice sends microphone audio and public lab context to Google. Free-tier content may be used to improve Google products. Local mode does not send audio to Google."


def valid_provider_key(value) -> bool:
    # Google now issues AQ. authentication keys as well as legacy AIza keys.
    # The provider validates actual authentication; this only rejects malformed input.
    return isinstance(value, str) and bool(re.fullmatch(r"(?:AIza[A-Za-z0-9_-]{35}|AQ\.[A-Za-z0-9_-]{32,509})", value.strip()))


class NativeConfig:
    def __init__(self, root: Path):
        self.root = root
        self.directory = root / ".work/private"
        self.proof_path = self.directory / "native-free-tier.json"
        self.key_path = self.directory / "gemini.key"
        self.consent_path = self.directory / "native-consent.json"
        self.permits = {}
        self.provider_verified = False

    def approval(self, *, maximum_age=timedelta(hours=24)):
        proof = self.read_proof()
        timestamp = datetime.fromisoformat(proof["verified_at"])
        now = datetime.now(timezone.utc)
        if timestamp.tzinfo is None or timestamp > now + timedelta(minutes=5) or (maximum_age is not None and now - timestamp > maximum_age):
            raise ValueError("The free-tier verification has expired. Native voice is disabled until it is checked again.")
        if proof.get("billing_tier") != "Free tier" or proof.get("model") != MODEL or proof.get("billing_enabled") is not False:
            raise ValueError("Native voice requires a verified, non-billable free-tier project.")
        suffix = proof.get("existing_key_suffix")
        if not isinstance(suffix, str) or not re.fullmatch(r"[A-Za-z0-9_-]{4}", suffix):
            raise ValueError("The verified key reference is missing.")
        return proof

    def read_proof(self):
        if not self.proof_path.is_file():
            raise ValueError("An operator must verify the selected project is on the free tier before native voice can run.")
        return json.loads(self.proof_path.read_text())

    def store_operator_key(self, key: str, consent: bool):
        proof = self.approval()
        if consent is not True:
            raise ValueError("Explicit approval for Google's external audio processing is required.")
        if not valid_provider_key(key):
            raise ValueError("The supplied credential has an unexpected format.")
        key = key.strip()
        if not key.endswith(proof["existing_key_suffix"]):
            raise ValueError("This is not the existing key associated with the verified free-tier project.")
        self.directory.mkdir(parents=True, exist_ok=True)
        self.directory.chmod(0o700)
        temporary = self.key_path.with_suffix(".new")
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            os.write(descriptor, key.encode())
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        temporary.chmod(0o600)
        temporary.replace(self.key_path)
        self.consent_path.write_text(json.dumps({"external_processing_approved": True,
            "recorded_at": datetime.now(timezone.utc).isoformat(), "privacy_notice": PRIVACY}))
        self.consent_path.chmod(0o600)
        self.provider_verified = False

    def credential(self):
        proof = self.approval()
        if not self.key_path.is_file() or not self.consent_path.is_file():
            raise ValueError("Enter the existing free-tier key in the local settings before starting native voice.")
        if self.key_path.stat().st_mode & 0o077:
            raise ValueError("The credential file is not private to its owner.")
        consent = json.loads(self.consent_path.read_text())
        if not consent.get("external_processing_approved"):
            raise ValueError("External audio processing has not been approved.")
        key = self.key_path.read_text().strip()
        if not valid_provider_key(key) or not key.endswith(proof["existing_key_suffix"]):
            raise ValueError("The local credential does not match the approved free-tier reference.")
        return key

    def status(self):
        try:
            proof = self.approval()
            approved = True
            expires = (datetime.fromisoformat(proof["verified_at"]) + timedelta(hours=24)).isoformat()
        except (ValueError, KeyError, OSError, json.JSONDecodeError) as error:
            return {"available": False, "configured": False, "free_tier_verified": False,
                    "reason": str(error), "provider": "Google Gemini", "privacy": PRIVACY,
                    "model": MODEL, "provider_session_verified": False}
        try:
            self.credential()
            configured, reason = True, None
        except (ValueError, KeyError, OSError, json.JSONDecodeError) as error:
            configured, reason = False, str(error)
        return {"available": configured and approved, "configured": configured,
                "free_tier_verified": approved, "verification_expires": expires,
                "provider": "Google Gemini", "model": MODEL, "privacy": PRIVACY,
                "reason": reason, "provider_session_verified": self.provider_verified,
                "session_max_seconds": 600, "automatic_paid_fallback": False}

    def issue_permit(self):
        self.credential()
        now = time.monotonic()
        self.permits = {token: expiry for token, expiry in self.permits.items() if expiry > now}
        if len(self.permits) >= 4:
            raise ValueError("Too many pending native voice connections.")
        token = secrets.token_urlsafe(32)
        self.permits[token] = now + 30
        return token

    def use_permit(self, token: str):
        expiry = self.permits.pop(token, None)
        if expiry is None or expiry <= time.monotonic():
            raise ValueError("The native voice connection permit is invalid or expired.")
        return self.credential()
