"""Small session-local coordinator for verified video operations.

The browser owns the original video; the coordinator sees metadata and only the
explicitly approved decoded frames. No document/video URL or filesystem reader.
"""
from __future__ import annotations
import asyncio
from .selected_video import SelectedVideo


class VideoBridge:
    def __init__(self, inspector, *, timeout=15):
        self.state = SelectedVideo()
        self.inspector = inspector
        self.timeout = timeout
        self.pending = {}
        self.lifetime = 0
        self.metrics = {'video_proposals': 0, 'video_acknowledged': 0, 'video_image_inspections': 0, 'stale_video_receipts': 0}

    def offer(self, metadata):
        result = self.state.offer(metadata)
        self.lifetime += 1
        return result

    def cancel(self):
        self.lifetime += 1
        for future, _ in list(self.pending.values()):
            if not future.done(): future.cancel()
        self.state.cancel_pending()

    def revoke(self):
        self.cancel(); self.state.revoke()

    def acknowledge(self, payload, generation):
        if not isinstance(payload, dict):
            self.metrics['stale_video_receipts'] += 1
            return
        identity = payload.get('action_id')
        pending = self.pending.get(identity) if isinstance(identity, str) else None
        if not pending or type(payload.get('generation')) is not int or pending[1] != generation or payload['generation'] != generation or pending[0].done():
            self.metrics['stale_video_receipts'] += 1
            return
        try:
            checked = self.state.acknowledge(payload)
        except ValueError:
            self.state.abort(identity)
            checked = {'status': 'not-applied', 'answer': 'The browser video receipt failed validation. Do not claim the video action succeeded.'}
        if not pending[0].done(): pending[0].set_result(checked)

    async def run(self, name, arguments, epoch, current_generation, send):
        if epoch != current_generation(): raise asyncio.CancelledError()
        lifetime = self.lifetime
        def current():
            return epoch == current_generation() and lifetime == self.lifetime
        action = self.state.propose(name, arguments)
        identity = action['action_id']
        future = asyncio.get_running_loop().create_future()
        self.pending[identity] = (future, epoch)
        self.metrics['video_proposals'] += 1
        try:
            await send({'event': 'video_action', 'action': action, 'generation': epoch})
            try:
                result = await asyncio.wait_for(future, timeout=self.timeout)
            except TimeoutError:
                self.state.abort(identity)
                await send({'event': 'video_cancel', 'action_id': identity, 'generation': epoch})
                return {'status': 'not-applied', 'answer': 'The original video action did not finish before its deadline. No success was confirmed.'}
            if not current(): raise asyncio.CancelledError()
            if result.get('status') == 'not-applied': return result
            self.metrics['video_acknowledged'] += 1
            image = result.pop('_video_image', None)
            if image is None: return result
            await send({'event': 'video_vision_started', 'time': result['time'], 'generation': epoch})
            try:
                observed = await self.inspector.inspect(image, f"This source image is an original decoded VIDEO FRAME at {result['time']:.3f} seconds, not a document page. No transcript or content labels were supplied. Describe only visible evidence; do not infer motion or sound from a single frame.", [0, 0, 1, 1])
            except asyncio.CancelledError:
                raise
            except Exception:
                observed = {'status': 'unavailable'}
            if not current(): raise asyncio.CancelledError()
            if not self.state.video or self.state.video['id'] != action['video_id']:
                return {'status': 'not-applied', 'answer': 'The visitor removed or replaced the video during inspection. Do not use this late result.'}
            observed = dict(observed) if isinstance(observed, dict) else {'status': 'unavailable'}
            result['visual_observation'] = observed
            if observed.get('status') == 'source-image-inspected':
                if observed.get('image_sha256') != image['sha256']:
                    observed = result['visual_observation'] = {'status': 'unavailable'}
                else:
                    try:
                        observed['regions'] = self.state.register_regions(image['sha256'], observed.get('regions'), action['video_id'], image['frame_id'])
                    except ValueError:
                        observed = result['visual_observation'] = {'status': 'unavailable'}
            if observed.get('status') == 'source-image-inspected':
                observed['scope'] = 'Model observation of this exact selected original video frame, not its audio or intervening frames, and not proof of causality.'
                result['status'] = 'video-frame-inspected'
                result['answer'] = 'The exact original frame was displayed and visually inspected. Ground your account in the returned visible details. Compare separate inspected frames before describing change; never infer sound or causation from a single frame. Use only returned region IDs for annotation.'
                self.metrics['video_image_inspections'] += 1
                await send({'event': 'video_inspected', 'time': result['time'], 'video_id': action['video_id'], 'image_sha256': image['sha256'], 'model': observed.get('model'), 'regions': observed['regions'], 'generation': epoch})
            else:
                result['status'] = 'video-frame-unverified'
                result['answer'] = 'The original frame was displayed but its visual inspection did not complete. You must not invent visible details, use the title as evidence, or place a guessed annotation.'
                await send({'event': 'video_inspection_failed', 'time': result['time'], 'generation': epoch})
            return result
        except asyncio.CancelledError:
            self.state.abort(identity)
            try:
                await send({'event': 'video_cancel', 'action_id': identity, 'generation': epoch})
            except Exception:
                pass
            raise
        finally:
            self.state.abort(identity)
            self.pending.pop(identity, None)
