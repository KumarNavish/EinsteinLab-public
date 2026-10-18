"""Reveal an explanation only after each acknowledged view and local speech boundary.

A local rendered-audio receipt is not a provider completion or a human listening
verdict. Silence, a timeout, and an old receipt never advance the explanation.
"""
from __future__ import annotations

import asyncio
import math
import secrets
from time import monotonic


class ProgressiveTeaching:
    def __init__(self, *, boundary_timeout=45, prepare_timeout=8):
        self.boundary_timeout = boundary_timeout
        self.prepare_timeout = prepare_timeout
        self.preparing = None
        self._preparation = None
        self.sequence_id = None
        self.index = None
        self.pending = None
        self.cancelled = False
        self.running = False
        self.revision = 0

    def cancel(self):
        self.revision += 1
        self.cancelled = True
        for pending in (self.pending, self.preparing):
            if pending is not None and not pending.done():
                pending.set_result({'cancelled': True})
        if not self.running:
            self._preparation = self.preparing = None

    async def begin_preparation(self, send):
        """Overlap the existing playback-drain handshake with source analysis."""
        if self.running or self._preparation is not None:
            return None
        token = secrets.token_urlsafe(18)
        self.sequence_id = token
        self.preparing = asyncio.get_running_loop().create_future()
        self._preparation = {'token': token, 'revision': self.revision,
                             'future': self.preparing, 'deadline': monotonic() + self.prepare_timeout}
        try:
            await send({'event': 'teaching_prepare', 'sequence_id': token})
        except BaseException:
            self.cancel_preparation(token)
            raise
        return token

    def cancel_preparation(self, token):
        """Retire only this caller's unused handshake; never touch another run."""
        if self.running or self._preparation is None or self._preparation['token'] != token:
            return False
        if not self.preparing.done():
            self.preparing.set_result({'cancelled': True})
        self._preparation = self.preparing = None
        return True

    def ready(self, packet):
        """A drained prior playback epoch is not a heard teaching stage."""
        quiet = packet.get('rendered_quiet_ms')
        preparation = self._preparation
        if (preparation is None or preparation['revision'] != self.revision
                or monotonic() > preparation['deadline']
                or self.preparing is None or self.preparing.done()
                or packet.get('sequence_id') != self.sequence_id
                or packet.get('ready') is not True or packet.get('audio_playing') is not False
                or type(quiet) not in (int, float) or not math.isfinite(quiet)
                or not 900 <= quiet <= 600000):
            return False
        self.preparing.set_result({'ready': True})
        return True

    def acknowledge(self, packet):
        if (not self.running or self.pending is None or self.pending.done()
                or packet.get('sequence_id') != self.sequence_id
                or type(packet.get('index')) is not int or packet['index'] != self.index
                or type(packet.get('heard')) is not bool
                or (not packet['heard'] and packet.get('manual') is not True)):
            return False
        self.pending.set_result({'heard': packet['heard'], 'manual': not packet['heard']})
        return True

    async def run(self, stages, *, render, speak, send, prepare=False, preparation=None):
        if self.running:
            return {'status': 'busy', 'answer': 'An explanation is already developing. Do not start another one.'}
        not_prepared = {'status': 'paused', 'reason': 'playback-preparation-unavailable', 'rendered_steps': 0,
                        'local_speech_boundaries_confirmed': 0, 'manual_advances': 0,
                        'total_steps': len(stages),
                        'answer': 'The prior speech did not finish safely. No teaching mark or step was shown. Wait for the visitor; do not resume this walkthrough automatically.'}
        if prepare:
            if preparation is None:
                preparation = await self.begin_preparation(send)
            prepared = self._preparation
            if (preparation is None or prepared is None or prepared['token'] != preparation
                    or prepared['revision'] != self.revision):
                return not_prepared
        elif preparation is not None or self._preparation is not None:
            return not_prepared
        self.running = True
        self.revision += 1
        self.cancelled = False
        self.sequence_id = preparation if prepare else secrets.token_urlsafe(18)
        if prepare:
            prepared['revision'] = self.revision
        heard = rendered = manual = 0
        status = 'paused'
        pause_reason = None
        try:
            if prepare:
                try:
                    # A receipt received within the deadline stays valid while
                    # source analysis finishes; analysis time is not playback.
                    ready = (self.preparing.result() if self.preparing.done() else
                             await asyncio.wait_for(asyncio.shield(self.preparing),
                                                    max(0, prepared['deadline'] - monotonic())))
                except TimeoutError:
                    ready = {}
                    pause_reason = 'playback-preparation-timeout'
                if self.cancelled or ready.get('ready') is not True:
                    pause_reason = pause_reason or ('playback-preparation-cancelled'
                        if self.cancelled or ready.get('cancelled') is True else 'playback-not-ready')
                    return {**not_prepared, 'reason': pause_reason}
            first = stages[0]
            graph = first.get('graph', {})
            source_metadata = {key: first[key] for key in ('mode', 'source_id', 'document_id', 'page', 'image_sha256', 'view_region') if key in first}
            await send({'event': 'teaching_started', 'sequence_id': self.sequence_id,
                        'count': len(stages), 'title': first.get('title', graph.get('title', '')),
                        'source_ids': first.get('source_ids', graph.get('source_ids', [])), **source_metadata})
            for index, stage in enumerate(stages):
                self.index = index
                if self.cancelled:
                    break
                receipt = await render(stage)
                if self.cancelled or receipt.get('status') != stage.get('render_status', 'focused'):
                    break
                rendered += 1
                self.pending = asyncio.get_running_loop().create_future()
                await send({'event': 'teaching_step', 'sequence_id': self.sequence_id,
                            'index': index, 'count': len(stages),
                            'focus_label': stage['focus_label'] if 'focus_label' in stage else stage['graph']['nodes'][-1]['label'],
                            'narration': stage['narration'], **source_metadata,
                            **({'region_id': stage['region_id']} if 'region_id' in stage else {}),
                            **({'action_id': receipt['action_id']} if 'action_id' in receipt else {})})
                if self.cancelled:
                    break
                await speak(stage['narration'])
                try:
                    boundary = await asyncio.wait_for(asyncio.shield(self.pending), self.boundary_timeout)
                except TimeoutError:
                    break
                if boundary.get('cancelled') or self.cancelled:
                    break
                heard += int(boundary.get('heard') is True)
                manual += int(boundary.get('manual') is True)
            else:
                status = 'presented-progressively'
            return {'status': status, 'rendered_steps': rendered,
                    'local_speech_boundaries_confirmed': heard, 'manual_advances': manual,
                    'total_steps': len(stages),
                    'answer': ('The explanation was developed one acknowledged element at a time. '
                               'Its short step explanations have already been sent to the voice. '
                               'Do not repeat the whole presentation. Listen for the visitor’s question.'
                               if status == 'presented-progressively' else
                               'The explanation paused. Keep the last acknowledged view; do not reveal remaining steps or resume without the visitor asking.')}
        finally:
            if self.pending is not None and not self.pending.done():
                self.pending.cancel()
            self.pending = None
            if self.preparing is not None and not self.preparing.done():
                self.preparing.cancel()
            self.preparing = None
            self._preparation = None
            self.running = False
            await send({'event': 'teaching_finished', 'sequence_id': self.sequence_id,
                        'status': status, 'rendered_steps': rendered,
                        'local_speech_boundaries_confirmed': heard, 'manual_advances': manual,
                        **({'reason': pause_reason or 'teaching-stopped-before-completion'} if status == 'paused' else {})})
