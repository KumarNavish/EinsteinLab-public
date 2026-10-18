"""Offline ownership/receipt tests. Synthetic pixels, no credentials or providers."""
import asyncio
import base64
import hashlib
import io

import pytest
from PIL import Image

from lab_backend.selected_video import SelectedVideo
from lab_backend.video_bridge import VideoBridge


METADATA = {'id': 'a' * 64, 'name': 'controlled-fixture.webm', 'bytes': 1000,
            'duration': 8.0, 'width': 320, 'height': 240, 'approved': True}
output = io.BytesIO()
Image.new('RGB', (320, 240), '#346f55').save(output, format='JPEG')
JPEG = base64.b64encode(output.getvalue()).decode()
HASH = hashlib.sha256(output.getvalue()).hexdigest()


def selected():
    state = SelectedVideo()
    state.offer(METADATA)
    return state


def receipt(action, **changes):
    return {'action_id': action['action_id'], 'video_id': action['video_id'],
            'revision': action['revision'], 'ok': True, 'time': action.get('seconds', 0),
            'paused': action['kind'] != 'play', 'rate': 1,
            'image': {'mime_type': 'image/jpeg', 'data': JPEG}, **changes}


@pytest.mark.parametrize('changes', [
    {'approved': False}, {'id': 'file:///private/key'}, {'name': 'bad\nname.webm'},
    {'bytes': True}, {'bytes': 80 * 1024 * 1024 + 1}, {'duration': float('nan')},
    {'duration': 601}, {'width': 5000}, {'height': False}, {'url': 'https://example.com/video'},
])
def test_metadata_requires_bounded_explicit_selection(changes):
    with pytest.raises(ValueError): SelectedVideo().offer({**METADATA, **changes})


@pytest.mark.parametrize('tool,args', [
    ('control_selected_video', {'action': 'seek', 'seconds': -1}),
    ('control_selected_video', {'action': 'seek', 'seconds': True}),
    ('control_selected_video', {'action': 'seek', 'seconds': 1, 'rate': 1}),
    ('control_selected_video', {'action': 'rate', 'rate': True}),
    ('control_selected_video', {'action': 'rate', 'rate': 1, 'seconds': 0}),
    ('control_selected_video', {'action': 'pause', 'url': 'file:///etc/passwd'}),
    ('control_selected_video', {'action': ['pause']}),
    ('inspect_selected_video_frame', {'seconds': 8}),
    ('inspect_selected_video_frame', {'seconds': float('inf')}),
    ('inspect_selected_video_frame', {'path': '/etc/passwd'}),
    ('mark_selected_video_frame', {'region_id': 'made-up', 'region': [0, 0, 1, 1]}),
])
def test_actions_reject_unsafe_or_ambiguous_input(tool, args):
    with pytest.raises(ValueError): selected().propose(tool, args)


def test_only_successfully_inspected_source_pixels_authorize_region_marks():
    state = selected()
    with pytest.raises(ValueError): state.propose('mark_selected_video_frame', {'region_id': 'made-up'})
    action = state.propose('inspect_selected_video_frame', {'seconds': 2})
    result = state.acknowledge(receipt(action))
    assert result['status'] == 'video-inspect' and not state.regions
    image = result['_video_image']
    regions = state.register_regions(image['sha256'], [{'label': 'Synthetic green field', 'region': [.1, .1, .3, .4]}], METADATA['id'], image['frame_id'])
    mark = state.propose('mark_selected_video_frame', {'region_id': regions[0]['id']})
    assert mark['time'] == 2 and mark['frame_hash'] == HASH
    with pytest.raises(ValueError): state.acknowledge(receipt(mark, frame_hash='b' * 64))
    assert state.acknowledge(receipt(mark, time=2, frame_hash=HASH))['status'] == 'video-mark'


@pytest.mark.parametrize('changes', [{'video_id': 'b' * 64}, {'action_id': 'missing'}, {'revision': True}, {'paused': 1}, {'rate': True}, {'time': -1}, {'time': float('nan')}])
def test_stale_or_malformed_receipts_do_not_establish_success(changes):
    state = selected()
    action = state.propose('inspect_selected_video_frame', {})
    with pytest.raises(ValueError): state.acknowledge(receipt(action, **changes))
    assert not state.frames and not state.regions


@pytest.mark.parametrize('image', [None, {'mime_type': 'image/jpeg', 'data': base64.b64encode(b'x' * 64).decode()}, {'mime_type': 'image/png', 'data': JPEG}])
def test_fake_or_wrong_image_cannot_be_registered(image):
    state = selected(); action = state.propose('inspect_selected_video_frame', {})
    with pytest.raises(ValueError): state.acknowledge(receipt(action, image=image))
    assert not state.frames


def test_control_receipts_validate_the_requested_state():
    state = selected()
    action = state.propose('control_selected_video', {'action': 'rewind', 'seconds': 2})
    with pytest.raises(ValueError): state.acknowledge(receipt(action, previous_time=5, time=4))
    assert state.acknowledge(receipt(action, previous_time=5, time=3))['time'] == 3
    action = state.propose('control_selected_video', {'action': 'play'})
    with pytest.raises(ValueError): state.acknowledge(receipt(action, paused=True))
    state.acknowledge(receipt(action))
    action = state.propose('control_selected_video', {'action': 'rate', 'rate': .5})
    with pytest.raises(ValueError): state.acknowledge(receipt(action))
    state.acknowledge(receipt(action, rate=.5))


def test_identical_pixels_at_different_times_have_distinct_frame_provenance():
    state = selected(); regions = []
    for stamp in (1, 4):
        action = state.propose('inspect_selected_video_frame', {'seconds': stamp})
        image = state.acknowledge(receipt(action))['_video_image']
        regions += state.register_regions(HASH, [{'label': 'Static field', 'region': [.1, .1, .5, .5]}], METADATA['id'], image['frame_id'])
    assert regions[0]['id'] != regions[1]['id']
    action = state.propose('mark_selected_video_frame', {'region_id': regions[0]['id']})
    assert action['time'] == 1
    state.revoke(); state.offer(METADATA)
    with pytest.raises(ValueError): state.propose('mark_selected_video_frame', {'region_id': regions[0]['id']})
    assert not state.frames and not state.regions and not state.pending


def test_region_registration_is_atomic_and_belongs_to_exact_read():
    state = selected(); action = state.propose('inspect_selected_video_frame', {})
    image = state.acknowledge(receipt(action))['_video_image']
    for rows in [[{'label': 'Valid', 'region': [.1, .1, .3, .3]}, None], [{'label': 'Bad\nlabel', 'region': [.1, .1, .3, .3]}]]:
        with pytest.raises(ValueError): state.register_regions(HASH, rows, METADATA['id'], image['frame_id'])
        assert not state.regions
    with pytest.raises(ValueError): state.register_regions('b' * 64, [], METADATA['id'], image['frame_id'])


class Inspector:
    def __init__(self, changes=None): self.calls = 0; self.changes = changes or {}
    async def inspect(self, image, text, crop):
        self.calls += 1
        assert 'VIDEO FRAME' in text and crop == [0, 0, 1, 1]
        return {'status': 'source-image-inspected', 'model': 'offline-fixture', 'image_sha256': HASH,
                'summary': 'A synthetic green field.', 'regions': [{'label': 'Field', 'region': [.1, .1, .3, .4]}], **self.changes}


def test_bridge_waits_for_exact_receipt_before_inspection_and_annotation():
    async def scenario():
        inspector = Inspector(); bridge = VideoBridge(inspector); bridge.offer(METADATA); events = []
        async def send(event):
            events.append(event)
            if event['event'] == 'video_action':
                assert inspector.calls == 0
                bridge.acknowledge({**receipt(event['action']), 'generation': 0}, 0)
        result = await bridge.run('inspect_selected_video_frame', {'seconds': 2}, 0, lambda: 0, send)
        assert result['status'] == 'video-frame-inspected'
        assert result['visual_observation']['regions'][0]['time'] == 2
        assert bridge.metrics['video_image_inspections'] == 1 and not bridge.pending and not bridge.state.pending
        assert events[-1]['event'] == 'video_inspected'
    asyncio.run(scenario())


@pytest.mark.parametrize('changes', [{'status': 'unavailable'}, {'image_sha256': 'b' * 64}, {'regions': [None]}])
def test_bridge_never_promotes_unverified_observations(changes):
    async def scenario():
        bridge = VideoBridge(Inspector(changes)); bridge.offer(METADATA)
        async def send(event):
            if event['event'] == 'video_action': bridge.acknowledge({**receipt(event['action']), 'generation': 0}, 0)
        result = await bridge.run('inspect_selected_video_frame', {}, 0, lambda: 0, send)
        assert result['status'] == 'video-frame-unverified' and not bridge.state.regions
    asyncio.run(scenario())


def test_late_inspection_cannot_rebind_to_same_file_after_reapproval():
    async def scenario():
        started = asyncio.Event(); finish = asyncio.Event()
        class DelayedInspector(Inspector):
            async def inspect(self, image, text, crop):
                started.set(); await finish.wait()
                return await super().inspect(image, text, crop)
        bridge = VideoBridge(DelayedInspector()); bridge.offer(METADATA); events = []
        async def send(event):
            events.append(event)
            if event['event'] == 'video_action': bridge.acknowledge({**receipt(event['action']), 'generation': 0}, 0)
        task = asyncio.create_task(bridge.run('inspect_selected_video_frame', {}, 0, lambda: 0, send))
        await started.wait(); bridge.revoke(); bridge.offer(METADATA); finish.set()
        with pytest.raises(asyncio.CancelledError): await task
        assert not bridge.state.frames and not bridge.state.regions and not bridge.pending
        assert not any(event['event'] == 'video_inspected' for event in events)
    asyncio.run(scenario())


def test_timeout_cross_session_receipts_and_cancellation_clean_up():
    async def scenario():
        bridge = VideoBridge(Inspector(), timeout=.01); bridge.offer(METADATA); events = []
        other = VideoBridge(Inspector()); other.offer(METADATA)
        async def send(event):
            events.append(event)
            if event['event'] == 'video_action':
                other.acknowledge({**receipt(event['action']), 'generation': 0}, 0)
                bridge.acknowledge({**receipt(event['action']), 'generation': True}, 0)
        result = await bridge.run('inspect_selected_video_frame', {}, 0, lambda: 0, send)
        assert result['status'] == 'not-applied' and events[-1]['event'] == 'video_cancel'
        assert other.metrics['stale_video_receipts'] == bridge.metrics['stale_video_receipts'] == 1
        assert not bridge.pending and not bridge.state.pending
        async def disconnected(event): raise ConnectionError('offline fixture')
        with pytest.raises(ConnectionError): await bridge.run('control_selected_video', {'action': 'pause'}, 0, lambda: 0, disconnected)
        assert not bridge.pending and not bridge.state.pending
        task = asyncio.create_task(bridge.run('control_selected_video', {'action': 'pause'}, 0, lambda: 0, send))
        await asyncio.sleep(0); bridge.cancel()
        with pytest.raises(asyncio.CancelledError): await task
        assert not bridge.pending and not bridge.state.pending
    asyncio.run(scenario())
