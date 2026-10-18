import asyncio
import unittest
from unittest.mock import patch

from lab_backend.teaching_runtime import ProgressiveTeaching


def stage(label):
    return {'graph': {'nodes': [{'label': label}]}, 'narration': label + ' is the current idea.'}


class TeachingRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_prewarmed_ready_is_reused_after_analysis_without_another_handshake(self):
        runtime = ProgressiveTeaching()
        events, calls = [], []
        async def send(packet):
            events.append(packet)
            if packet['event'] == 'teaching_step':
                assert runtime.acknowledge({**packet, 'heard': True})
        async def render(_value): calls.append('render'); return {'status': 'focused'}
        async def speak(_text): calls.append('speak')
        with patch('lab_backend.teaching_runtime.monotonic', return_value=0):
            token = await runtime.begin_preparation(send)
            assert not runtime.running and runtime.revision == 0
            assert events == [{'event': 'teaching_prepare', 'sequence_id': token}]
            assert runtime.ready({'sequence_id': token, 'ready': True,
                                  'rendered_quiet_ms': 1000, 'audio_playing': False})
        with patch('lab_backend.teaching_runtime.monotonic', return_value=20):
            result = await runtime.run([stage('Input'), stage('Guard')], render=render,
                                      speak=speak, send=send, prepare=True, preparation=token)
        assert result['status'] == 'presented-progressively'
        assert result['local_speech_boundaries_confirmed'] == 2
        assert [event['event'] for event in events] == [
            'teaching_prepare', 'teaching_started', 'teaching_step', 'teaching_step', 'teaching_finished']
        assert all(event['sequence_id'] == token for event in events)
        assert calls == ['render', 'speak', 'render', 'speak']
        assert runtime.preparing is None and not runtime.cancel_preparation(token)

    async def test_prewarm_deadline_applies_to_receipt_not_a_new_wait_after_analysis(self):
        runtime = ProgressiveTeaching()
        events = []
        async def send(packet): events.append(packet)
        async def forbidden(_value): raise AssertionError('Expired preparation cannot reveal or narrate.')
        with patch('lab_backend.teaching_runtime.monotonic', return_value=0):
            token = await runtime.begin_preparation(send)
        with patch('lab_backend.teaching_runtime.monotonic', return_value=9):
            assert not runtime.ready({'sequence_id': token, 'ready': True,
                                      'rendered_quiet_ms': 1000, 'audio_playing': False})
            result = await runtime.run([stage('Input')], render=forbidden,
                                      speak=forbidden, send=send, prepare=True, preparation=token)
        assert result['status'] == 'paused' and result['rendered_steps'] == 0
        assert [event['event'] for event in events] == ['teaching_prepare', 'teaching_finished']
        assert runtime.preparing is None and not runtime.running

    async def test_cancelled_or_replaced_prewarm_cannot_consume_another_preparation(self):
        runtime = ProgressiveTeaching()
        events = []
        async def send(packet): events.append(packet)
        async def forbidden(_value): raise AssertionError('Retired preparation cannot reveal or narrate.')
        old = await runtime.begin_preparation(send)
        old_future = runtime.preparing
        assert await runtime.begin_preparation(send) is None
        runtime.cancel()
        assert old_future.result() == {'cancelled': True}
        assert runtime.preparing is None and not runtime.cancel_preparation(old)
        new = await runtime.begin_preparation(send)
        new_future = runtime.preparing
        assert new != old and not runtime.running and runtime.revision == 1
        assert not runtime.cancel_preparation(old)
        assert not runtime.ready({'sequence_id': old, 'ready': True,
                                  'rendered_quiet_ms': 1000, 'audio_playing': False})
        result = await runtime.run([stage('Input')], render=forbidden, speak=forbidden,
                                   send=send, prepare=True, preparation=old)
        assert result['status'] == 'paused' and runtime.preparing is new_future
        assert not runtime.running and runtime.revision == 1
        assert runtime.cancel_preparation(new)
        assert new_future.result() == {'cancelled': True}
        assert [event['event'] for event in events] == ['teaching_prepare', 'teaching_prepare']

    async def test_preparation_while_a_run_is_active_cannot_replace_its_sequence(self):
        runtime = ProgressiveTeaching()
        events = asyncio.Queue()
        async def send(packet): await events.put(packet)
        async def render(_value): return {'status': 'focused'}
        async def speak(_text): pass
        task = asyncio.create_task(runtime.run([stage('Input')], render=render, speak=speak, send=send))
        started = await events.get()
        step = await events.get()
        assert await runtime.begin_preparation(send) is None
        assert runtime.sequence_id == started['sequence_id'] == step['sequence_id']
        assert runtime.acknowledge({**step, 'heard': True})
        assert (await task)['status'] == 'presented-progressively'

    async def test_source_mark_receipts_gate_narration_and_keep_source_metadata_without_a_graph(self):
        runtime = ProgressiveTeaching()
        messages, spoken = asyncio.Queue(), []
        stages = [{'mode': 'source', 'title': 'Original figure', 'source_ids': ['inspected-p2'],
                   'source_id': 'inspected-p2', 'page': 2, 'document_id': 'a' * 64,
                   'image_sha256': 'd' * 64, 'view_region': [.1, .2, .8, .6],
                   'focus_label': label, 'region_id': 'region-' + str(index),
                   'narration': label + ' explains the next connection in this actual figure.',
                   'render_status': 'page-annotated'} for index, label in enumerate(['Record trace', 'Side exit'])]
        async def render(value): return {'status': 'page-annotated', 'action_id': value['region_id']}
        async def speak(text): spoken.append(text)
        async def send(packet): await messages.put(packet)
        task = asyncio.create_task(runtime.run(stages, render=render, speak=speak, send=send))
        started = await messages.get()
        assert started['mode'] == 'source' and started['view_region'] == [.1, .2, .8, .6]
        assert started['source_ids'] == ['inspected-p2'] and 'graph' not in started
        for index in range(2):
            step = await messages.get()
            assert step['index'] == index and step['region_id'] == step['action_id'] == 'region-' + str(index)
            assert step['source_id'] == 'inspected-p2' and step['image_sha256'] == 'd' * 64
            assert runtime.acknowledge({**step, 'heard': index == 0, 'manual': index == 1})
        result = await task
        assert result['status'] == 'presented-progressively' and len(spoken) == 2
        assert result['local_speech_boundaries_confirmed'] == result['manual_advances'] == 1

    async def test_conceptual_focus_receipt_cannot_substitute_for_an_original_source_mark(self):
        runtime = ProgressiveTeaching()
        async def render(_value): return {'status': 'focused'}
        async def speak(_text): raise AssertionError('A source mark has not been acknowledged')
        async def send(_packet): pass
        result = await runtime.run([{'mode': 'source', 'title': 'Original', 'focus_label': 'Guard',
                                     'narration': 'Guard checks the original condition.', 'render_status': 'page-annotated'}],
                                   render=render, speak=speak, send=send)
        assert result['rendered_steps'] == 0 and result['status'] == 'paused'

    async def test_next_element_requires_current_render_and_current_speech_receipt(self):
        runtime = ProgressiveTeaching()
        trace = []
        messages = asyncio.Queue()
        async def render(value):
            trace.append(('render', value['narration']))
            return {'status': 'focused'}
        async def speak(text): trace.append(('speak', text))
        async def send(packet):
            trace.append(('event', packet['event']))
            await messages.put(packet)
        task = asyncio.create_task(runtime.run([stage('Input'), stage('Guard')], render=render, speak=speak, send=send))
        assert (await messages.get())['event'] == 'teaching_started'
        first = await messages.get()
        await asyncio.sleep(0)
        assert [x[0] for x in trace] == ['event', 'render', 'event', 'speak']
        assert not runtime.acknowledge({**first, 'sequence_id': 'old', 'heard': True})
        assert not runtime.acknowledge({**first, 'index': 1, 'heard': True})
        assert not runtime.acknowledge({**first, 'heard': False})
        assert len([x for x in trace if x[0] == 'render']) == 1
        assert runtime.acknowledge({**first, 'heard': True})
        second = await messages.get()
        assert second['index'] == 1
        assert not runtime.acknowledge({**first, 'heard': True})
        assert runtime.acknowledge({**second, 'heard': False, 'manual': True})
        result = await task
        assert result['status'] == 'presented-progressively'
        assert result['local_speech_boundaries_confirmed'] == 1
        assert result['manual_advances'] == 1


    async def test_cancel_and_timeout_preserve_the_last_view_without_revealing_next(self):
        for cancelled in (False, True):
            runtime = ProgressiveTeaching(boundary_timeout=.02)
            rendered, spoken = [], []
            async def render(value):
                rendered.append(value)
                return {'status': 'focused'}
            async def speak(text):
                spoken.append(text)
                if cancelled: runtime.cancel()
            async def send(packet): pass
            result = await runtime.run([stage('Input'), stage('Guard')], render=render, speak=speak, send=send)
            assert result['status'] == 'paused'
            assert result['local_speech_boundaries_confirmed'] == 0
            assert len(rendered) == len(spoken) == 1
            assert not runtime.running and runtime.pending is None


    async def test_unacknowledged_render_cannot_start_speech_or_another_stage(self):
        runtime = ProgressiveTeaching()
        async def render(value): return {'status': 'not-displayed'}
        async def speak(text): raise AssertionError('Unacknowledged diagram must not be narrated')
        async def send(packet): assert packet['event'] in {'teaching_started', 'teaching_finished'}
        result = await runtime.run([stage('Input'), stage('Guard')], render=render, speak=speak, send=send)
        assert result['rendered_steps'] == 0

    async def test_cancellation_while_rendering_suppresses_speech_and_later_stages(self):
        runtime = ProgressiveTeaching()
        rendering = asyncio.Event()
        release_render = asyncio.Event()
        rendered = []
        async def render(value):
            rendered.append(value)
            rendering.set()
            await release_render.wait()
            return {'status': 'focused'}
        async def speak(_text):
            raise AssertionError('Cancelled rendering must not begin speech')
        async def send(_packet): pass
        task = asyncio.create_task(runtime.run([stage('Input'), stage('Guard')],
                                               render=render, speak=speak, send=send))
        await rendering.wait()
        runtime.cancel()
        release_render.set()
        result = await asyncio.wait_for(task, 1)
        assert result['status'] == 'paused' and result['rendered_steps'] == 0
        assert len(rendered) == 1 and runtime.pending is None
        assert not runtime.acknowledge({'sequence_id': runtime.sequence_id, 'index': 0, 'heard': True})

    async def test_cancellation_while_step_event_is_sent_prevents_old_narration(self):
        runtime = ProgressiveTeaching()
        events, spoken = [], []
        async def render(_value): return {'status': 'focused'}
        async def speak(text): spoken.append(text)
        async def send(packet):
            events.append(packet['event'])
            if packet['event'] == 'teaching_step':
                runtime.cancel()
                await asyncio.sleep(0)
        result = await runtime.run([stage('Old idea'), stage('Next old idea')],
                                   render=render, speak=speak, send=send)
        assert events == ['teaching_started', 'teaching_step', 'teaching_finished']
        assert spoken == []
        assert result['status'] == 'paused'
        assert result['local_speech_boundaries_confirmed'] == 0

    async def test_previous_sequence_and_boolean_index_cannot_advance_a_new_explanation(self):
        runtime = ProgressiveTeaching()
        messages = asyncio.Queue()
        async def render(_value): return {'status': 'focused'}
        async def speak(_text): pass
        async def send(packet): await messages.put(packet)
        async def start():
            task = asyncio.create_task(runtime.run([stage('Input')], render=render, speak=speak, send=send))
            assert (await messages.get())['event'] == 'teaching_started'
            current = await messages.get()
            assert current['event'] == 'teaching_step'
            return task, current
        first_task, first = await start()
        assert runtime.acknowledge({**first, 'heard': True})
        assert not runtime.acknowledge({**first, 'heard': True})
        assert (await first_task)['status'] == 'presented-progressively'
        assert (await messages.get())['event'] == 'teaching_finished'
        second_task, current = await start()
        assert current['sequence_id'] != first['sequence_id']
        assert not runtime.acknowledge({**first, 'heard': True})
        assert not runtime.acknowledge({**current, 'index': False, 'heard': True})
        assert not runtime.acknowledge({**current, 'heard': 1})
        busy = await runtime.run([stage('Other')], render=render, speak=speak, send=send)
        assert busy['status'] == 'busy'
        assert not second_task.done()
        assert runtime.acknowledge({**current, 'heard': True})
        assert (await second_task)['status'] == 'presented-progressively'


    async def test_initial_playback_preparation_blocks_every_mark_and_narration_until_own_ready(self):
        runtime = ProgressiveTeaching()
        events, calls = asyncio.Queue(), []
        async def send(packet): await events.put(packet)
        async def render(value): calls.append('render'); return {'status': 'focused'}
        async def speak(value): calls.append('speak')
        task = asyncio.create_task(runtime.run([stage('Input'), stage('Guard')],
                    render=render, speak=speak, send=send, prepare=True))
        prep = await events.get()
        assert prep['event'] == 'teaching_prepare' and not calls
        valid = {'sequence_id': prep['sequence_id'], 'ready': True,
                 'rendered_quiet_ms': 900, 'audio_playing': False}
        for change in ({'sequence_id': 'old'}, {'ready': False}, {'audio_playing': True},
                       {'rendered_quiet_ms': 899}, {'rendered_quiet_ms': True},
                       {'rendered_quiet_ms': float('nan')}, {'rendered_quiet_ms': float('inf')}):
            assert not runtime.ready({**valid, **change})
        assert not calls and events.empty()
        assert runtime.ready(valid)
        assert not runtime.ready(valid), 'A duplicate readiness receipt cannot advance a stage.'
        assert (await events.get())['event'] == 'teaching_started'
        first = await events.get()
        assert first['event'] == 'teaching_step' and first['index'] == 0
        assert calls == ['render', 'speak']
        runtime.cancel()
        result = await task
        assert result['status'] == 'paused' and result['rendered_steps'] == 1
        assert result['local_speech_boundaries_confirmed'] == 0
        assert runtime.preparing is None and not runtime.ready(valid)

    async def test_cancel_or_timeout_during_preparation_never_reveals_the_source(self):
        for cancel in (False, True):
            runtime = ProgressiveTeaching(prepare_timeout=.01)
            events, calls = asyncio.Queue(), []
            async def send(packet): await events.put(packet)
            async def render(value): calls.append('render'); return {'status': 'focused'}
            async def speak(value): calls.append('speak')
            task = asyncio.create_task(runtime.run([stage('Input'), stage('Guard')],
                        render=render, speak=speak, send=send, prepare=True))
            prep = await events.get()
            if cancel: runtime.cancel()
            result = await task
            assert result['status'] == 'paused' and not calls
            assert result['rendered_steps'] == result['local_speech_boundaries_confirmed'] == 0
            reason = 'playback-preparation-cancelled' if cancel else 'playback-preparation-timeout'
            assert result['reason'] == reason
            finished = await events.get()
            assert finished['event'] == 'teaching_finished' and finished['reason'] == reason and events.empty()
            assert runtime.preparing is None and not runtime.running
            assert not runtime.ready({'sequence_id': prep['sequence_id'], 'ready': True,
                                     'rendered_quiet_ms': 1000, 'audio_playing': False})
