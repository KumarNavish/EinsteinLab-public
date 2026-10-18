"""Connection-owned controls for a visitor-selected video; no file/URL access.

Every operation requires the exact browser acknowledgement. Pixel inspection is
performed separately by the configured bounded image inspector. Metadata is never
considered visual evidence, and annotations require an inspected region ID.
"""
from __future__ import annotations
import base64
import hashlib
import io
import math
import re
import secrets
from PIL import Image

VIDEO_TOOLS = frozenset({'control_selected_video', 'inspect_selected_video_frame', 'mark_selected_video_frame'})


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


class SelectedVideo:
    def __init__(self):
        self.video = None
        self.pending = {}
        self.regions = {}
        self.frames = {}
        self.revision = 0
        self.operations = 0

    def offer(self, value):
        if self.pending:
            raise ValueError('Cancel the pending operation before replacing the video')
        if not isinstance(value, dict) or set(value) - {'id', 'name', 'bytes', 'duration', 'width', 'height', 'approved'}:
            raise ValueError('Unexpected video metadata')
        if value.get('approved') is not True or not isinstance(value.get('id'), str) or not re.fullmatch(r'[a-f0-9]{64}', value['id']):
            raise ValueError('An explicitly approved video fingerprint is required')
        if not isinstance(value.get('name'), str) or not 1 <= len(value['name']) <= 180 or any(ord(c) < 32 for c in value['name']):
            raise ValueError('Invalid video name')
        if type(value.get('bytes')) is not int or not 32 <= value['bytes'] <= 80 * 1024 * 1024:
            raise ValueError('The selected video exceeds its byte budget')
        if not finite(value.get('duration')) or not 0 < value['duration'] <= 600:
            raise ValueError('The selected video exceeds its duration budget')
        if any(type(value.get(k)) is not int or not 1 <= value[k] <= 4096 for k in ['width', 'height']) or value['width'] * value['height'] > 8_294_400:
            raise ValueError('Invalid video dimensions')
        self.video = {k: value[k] for k in ['id', 'name', 'bytes', 'duration', 'width', 'height']}
        self.regions.clear(); self.frames.clear(); self.revision += 1
        return {'selected_video': self.video, 'scope': 'Visitor-approved browser-local video. Only inspected frames are evidence; the filename, duration and controls do not establish content.'}

    def revoke(self):
        self.video = None; self.pending.clear(); self.frames.clear(); self.regions.clear(); self.revision += 1

    def propose(self, name, arguments):
        if not self.video: raise ValueError('No visitor-selected video is approved')
        if self.pending: raise ValueError('Wait for the preceding video action')
        if self.operations >= 40: raise ValueError('The video action budget is exhausted')
        if not isinstance(arguments, dict): raise ValueError('Invalid video action')
        action = {'action_id': secrets.token_hex(16), 'video_id': self.video['id'], 'revision': self.revision + 1}
        if name == 'control_selected_video':
            if set(arguments) - {'action', 'seconds', 'rate'}: raise ValueError('Unexpected video control fields')
            kind = arguments.get('action')
            if not isinstance(kind, str) or kind not in {'play', 'pause', 'seek', 'rewind', 'rate', 'hide'}: raise ValueError('Unsupported video control')
            action['kind'] = kind
            if kind in {'seek', 'rewind'}:
                if set(arguments) != {'action', 'seconds'}: raise ValueError('This control requires only seconds')
                seconds = arguments.get('seconds')
                if not finite(seconds) or not 0 <= seconds <= self.video['duration']: raise ValueError('Video position is outside the selected file')
                action['seconds'] = float(seconds)
            elif kind == 'rate':
                if set(arguments) != {'action', 'rate'}: raise ValueError('This control requires only rate')
                if arguments.get('rate') not in [.5, .75, 1, 1.25, 1.5] or not finite(arguments.get('rate')): raise ValueError('Unsupported playback rate')
                action['rate'] = arguments['rate']
            elif len(arguments) != 1: raise ValueError('This control takes no extra fields')
        elif name == 'inspect_selected_video_frame':
            if set(arguments) - {'seconds'}: raise ValueError('Unexpected frame-reading fields')
            action['kind'] = 'inspect'
            if 'seconds' in arguments:
                if not finite(arguments['seconds']) or not 0 <= arguments['seconds'] < self.video['duration']: raise ValueError('Requested frame is outside the selected video')
                action['seconds'] = float(arguments['seconds'])
        elif name == 'mark_selected_video_frame':
            if set(arguments) - {'region_id', 'label'}: raise ValueError('Annotations require an inspected region identifier')
            value = self.regions.get(arguments.get('region_id')) if isinstance(arguments.get('region_id'), str) else None
            if value is None: raise ValueError('Select a region ID from a successfully inspected frame')
            label = arguments.get('label', value['label'])
            if not isinstance(label, str) or len(label) > 100 or any(ord(c) < 32 for c in label): raise ValueError('Invalid annotation label')
            action.update(kind='mark', region=value['region'], time=value['time'], frame_hash=value['frame_hash'], label=label)
        else:
            raise ValueError('Unsupported selected-video tool')
        self.operations += 1
        self.pending[action['action_id']] = action
        return action

    def acknowledge(self, value):
        if not isinstance(value, dict): raise ValueError('Invalid video receipt')
        action = self.pending.get(value.get('action_id')) if isinstance(value.get('action_id'), str) else None
        if not action or value.get('video_id') != action['video_id'] or type(value.get('revision')) is not int or value['revision'] != action['revision']:
            raise ValueError('Video receipt belongs to a stale action or another file')
        if value.get('ok') is not True:
            self.pending.pop(action['action_id'])
            return {'status': 'not-applied', 'answer': 'The browser did not complete the requested video operation. Do not claim it happened.'}
        stamp = value.get('time')
        if not finite(stamp) or not 0 <= stamp <= self.video['duration'] + .05: raise ValueError('Invalid video position in receipt')
        if type(value.get('paused')) is not bool or not finite(value.get('rate')) or value['rate'] not in [.5, .75, 1, 1.25, 1.5]:
            raise ValueError('Invalid browser playback state')
        kind = action['kind']
        if kind == 'play' and value.get('paused') is not False: raise ValueError('Playback did not start')
        if kind in {'pause', 'seek', 'rewind', 'inspect', 'mark', 'hide'} and value.get('paused') is not True: raise ValueError('The requested paused frame was not preserved')
        if kind == 'seek' and abs(stamp - action['seconds']) > .15: raise ValueError('The browser reached a different frame')
        if kind == 'rewind':
            before = value.get('previous_time')
            if not finite(before) or not 0 <= before <= self.video['duration'] or abs(stamp - max(0, before - action['seconds'])) > .15:
                raise ValueError('Rewind receipt does not match the requested interval')
        if kind == 'rate' and value.get('rate') != action['rate']: raise ValueError('Playback speed did not change')
        result = {'status': 'video-' + kind, 'time': stamp, 'video_id': self.video['id'], 'name': self.video['name'], 'paused': value.get('paused'), 'rate': value.get('rate'),
                  'scope': 'A browser-acknowledged control of the selected original video. This action alone is not evidence of its content.'}
        if kind == 'inspect':
            if 'seconds' in action and abs(stamp - action['seconds']) > .15: raise ValueError('Inspected image is from the wrong time')
            image = value.get('image')
            if not isinstance(image, dict) or image.get('mime_type') != 'image/jpeg' or not isinstance(image.get('data'), str) or not 32 <= len(image['data']) <= 350000:
                raise ValueError('A bounded original video-frame image is required')
            try:
                raw = base64.b64decode(image['data'], validate=True)
                with Image.open(io.BytesIO(raw)) as bitmap:
                    if bitmap.format != 'JPEG' or not 1 <= bitmap.width <= 1024 or not 1 <= bitmap.height <= 768: raise ValueError()
                    bitmap.verify()
            except Exception:
                raise ValueError('The browser frame is not a valid bounded JPEG')
            digest = hashlib.sha256(raw).hexdigest()
            self.frames[action['action_id']] = {'time': stamp, 'video_id': self.video['id'], 'sha256': digest}
            result['_video_image'] = {'data': image['data'], 'mime_type': 'image/jpeg', 'sha256': digest, 'frame_id': action['action_id']}
            result['answer'] = 'The original frame is displayed. Wait for the source-pixel inspection before describing its visible contents.'
        elif kind == 'mark':
            if abs(stamp - action['time']) > .05 or value.get('frame_hash') != action['frame_hash']: raise ValueError('The annotation did not target its inspected frame')
            result['answer'] = 'An explanatory overlay is visible on the inspected original frame; the video source was not edited.'
            result['region'] = action['region']
        self.pending.pop(action['action_id']); self.revision = action['revision']
        return result

    def register_regions(self, digest, observations, video_id, frame_id):
        frame = self.frames.get(frame_id)
        if not self.video or self.video['id'] != video_id or not frame or frame['video_id'] != video_id or frame['sha256'] != digest:
            raise ValueError('The video was removed or replaced during inspection')
        if not isinstance(observations, list) or len(observations) > 8: raise ValueError('Invalid frame observations')
        rows = []
        for i, item in enumerate(observations):
            if not isinstance(item, dict): raise ValueError('Invalid frame observation')
            region = item.get('region')
            if not isinstance(region, list) or len(region) != 4 or any(not finite(v) for v in region): raise ValueError('Invalid frame region')
            x, y, w, h = region
            if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > 1.00001 or y + h > 1.00001: raise ValueError('Region is outside the inspected frame')
            label = item.get('label', '')
            if not isinstance(label, str) or len(label) > 100 or any(ord(c) < 32 for c in label): raise ValueError('Invalid region label')
            identity = 'v-' + frame_id + '-' + str(i + 1)
            record = {'id': identity, 'time': frame['time'], 'region': list(region), 'label': label, 'frame_hash': digest}
            rows.append(record)
        self.regions.update({row['id']: row for row in rows})
        return rows

    def abort(self, identity): self.pending.pop(identity, None)
    def cancel_pending(self): self.pending.clear()


def declarations():
    return [
        {'name': 'control_selected_video', 'behavior': 'BLOCKING', 'description': 'Control the exact original video selected and approved by the visitor. Play, pause, seek to absolute seconds, rewind by an interval, change playback rate, or hide the view. Wait for the actual browser receipt. Controls do not establish visual content. The source stays in the browser.',
         'parameters': {'type': 'OBJECT', 'properties': {'action': {'type': 'STRING', 'enum': ['play', 'pause', 'seek', 'rewind', 'rate', 'hide']}, 'seconds': {'type': 'NUMBER'}, 'rate': {'type': 'NUMBER'}}, 'required': ['action']}},
        {'name': 'inspect_selected_video_frame', 'behavior': 'BLOCKING', 'description': 'Pause and inspect an ACTUAL frame of the approved browser-local video. Optional seconds selects a precise time; omitting it uses the current playhead. The configured image inspector returns its actual model, visible details and source region IDs. A single frame cannot establish motion, sound, causality, or unseen events. Inspect separated frames before comparing changes. Never infer content from a filename or video metadata.',
         'parameters': {'type': 'OBJECT', 'properties': {'seconds': {'type': 'NUMBER'}}}},
        {'name': 'mark_selected_video_frame', 'behavior': 'BLOCKING', 'description': 'Add one non-destructive explanatory overlay to a previously inspected video frame using an exact returned region_id. The browser returns to that frame, pauses it, and confirms the overlay before you may say it is highlighted. The source is unchanged. No arbitrary guessed coordinates are accepted.',
         'parameters': {'type': 'OBJECT', 'properties': {'region_id': {'type': 'STRING'}, 'label': {'type': 'STRING'}}, 'required': ['region_id']}},
    ]
