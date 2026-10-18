"""Conservative release host: reviewed source facts plus the existing generator.

The faster experimental Narrator is deliberately not the default: its recovery
checks exposed an accepted fragment and an irrelevant answer. This release keeps
its evaluated source atlas but not its unaccepted generation/pruning policy.
"""
from __future__ import annotations
import json
import time
from pathlib import Path
from .runtime import LocalRuntime
from .directory_facts import directory_answer
from .research_notes import ResearchNotes


class ReleaseHost(LocalRuntime):
    def __init__(self, root: Path):
        super().__init__(root)
        self.pages = json.loads((root / 'lab_backend/data/lab.json').read_text()).get('pages', [])
        self.notes = ResearchNotes(root, self.pages)

    def capabilities(self):
        return {**super().capabilities(), 'local_answer_policy': 'reviewed-notes-and-legacy-generated-fallback',
                'reviewed_project_notes': len(self.notes.notes),
                'experimental_narrator_promoted': False,
                'native_audio_default': False,
                'source_backend': getattr(self, 'source_backend', None)}

    def warmup(self):
        started = time.perf_counter()
        checks = {}
        if self.capabilities()['stt_available']:
            self.ensure_stt(); checks['speech_recognition'] = True
        if self.expressive.available:
            audio, cues, _ = self.expressive.synthesize('Good evening.')
            checks['expressive_voice'] = bool(audio)
            checks['phoneme_cues'] = bool(cues)
        if self.voice_path.is_file():
            checks['fast_voice'] = bool(self.synthesize('Good evening.'))
        checks['reviewed_project_sources'] = bool(self.notes.notes)
        self.warmup_info = {'seconds': round(time.perf_counter() - started, 3), 'checks': checks,
                            'language_model': 'Loaded only when a non-reviewed local question needs it.'}
        return self.warmup_info

    def answer(self, question, sources, history, cancelled=None):
        role = directory_answer(question, self.pages)
        if role is not None:
            return role
        note = self.notes.answer(question, sources, history)
        if note is not None:
            return note
        return super().answer(question, sources, history, cancelled=cancelled)
