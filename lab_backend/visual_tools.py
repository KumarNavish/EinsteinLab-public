"""Session-scoped conceptual diagrams, with transactional browser acknowledgements.

The expired C10 writes were confirmed NOT_DISPATCHED and both target files absent
before this reviewed implementation. No arbitrary HTML, code, URL, or file action
is accepted. A proposed diagram is not visible until its exact receipt is accepted.
"""
from __future__ import annotations
import math
import base64
import hashlib
import io
import av
import re
import secrets
from .source_passage import source_passage, focus_passage, passage_declarations

VISUAL_NAMES = frozenset({'sketch_mechanism', 'focus_visual', 'hide_visual', 'inspect_visual', 'show_source_passage', 'focus_source_phrase'})


def short_text(value, limit=120):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError('A bounded nonempty text label is required')
    if any(ord(c) < 32 and c not in '\n\t' for c in value):
        raise ValueError('Control characters are not display labels')
    return value.strip()


def identity(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-zA-Z][a-zA-Z0-9_-]{0,31}', value):
        raise ValueError('Invalid visual element identifier')
    return value


def coordinate(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not .06 <= value <= .94:
        raise ValueError('Coordinates must be normalized finite values between .06 and .94')
    return float(value)


class VisualSession:
    def __init__(self):
        self.revision = 0
        self.graph = None
        self.passage = None
        self.focus = None
        self.pending = {}

    def propose(self, name, arguments, sources):
        if self.pending:
            raise ValueError('Wait for the previous visual operation to finish')
        if not isinstance(arguments, dict):
            raise ValueError('Invalid presentation request')
        if name == 'sketch_mechanism':
            title = short_text(arguments.get('title'), 100)
            nodes, edges = arguments.get('nodes', []), arguments.get('edges', [])
            if not isinstance(nodes, list) or not 1 <= len(nodes) <= 8 or not isinstance(edges, list) or len(edges) > 12:
                raise ValueError('Use one to eight nodes and at most twelve relationships')
            checked, ids = [], set()
            for node in nodes:
                if not isinstance(node, dict): raise ValueError('Invalid node')
                key = identity(node.get('id'))
                if key in ids: raise ValueError('Duplicate node identifier')
                ids.add(key)
                checked.append({'id': key, 'label': short_text(node.get('label'), 65),
                    'x': coordinate(node.get('x')), 'y': coordinate(node.get('y')),
                    'detail': short_text(node.get('detail'), 160) if node.get('detail') else ''})
            relations = []
            for i, edge in enumerate(edges):
                if not isinstance(edge, dict) or edge.get('from') not in ids or edge.get('to') not in ids:
                    raise ValueError('Every relationship must reference an actual node')
                if edge['from'] == edge['to']:
                    raise ValueError('Use separate nodes for feedback loops')
                kind = edge.get('kind', 'information')
                if kind not in ('causal-hypothesis', 'information', 'association'):
                    raise ValueError('Unknown relationship type')
                relations.append({'id': f'edge-{i}', 'from': edge['from'], 'to': edge['to'],
                    'label': short_text(edge.get('label'), 50) if edge.get('label') else '', 'kind': kind})
            source_ids = arguments.get('source_ids', [])
            if not isinstance(source_ids, list) or len(source_ids) > 4 or any(not isinstance(key, str) or key not in sources for key in source_ids):
                raise ValueError('Only already inspected sources may be cited')
            graph = {'title': title, 'nodes': checked, 'edges': relations,
                'caption': short_text(arguments.get('caption'), 180) if arguments.get('caption') else 'Conceptual explanation, not experimental evidence.',
                'scope': 'conceptual-explanation',
                'sources': [{key: sources[source_id].get(key) for key in ('id', 'title', 'url', 'fetched_at')} for source_id in dict.fromkeys(source_ids)]}
            command = {'kind': 'diagram', 'graph': graph}
        elif name == 'focus_visual':
            if self.graph is None: raise ValueError('No acknowledged diagram is visible')
            key = arguments.get('element_id')
            valid = {node['id'] for node in self.graph['nodes']} | {edge['id'] for edge in self.graph['edges']}
            if key not in valid: raise ValueError('Select an existing visible element')
            command = {'kind': 'focus', 'element_id': key,
                'annotation': short_text(arguments.get('annotation'), 160) if arguments.get('annotation') else ''}
        elif name == 'show_source_passage':
            key = arguments.get('source_id')
            if not isinstance(key, str) or key not in sources:
                raise ValueError('Select an actual source ID returned by an evidence tool in this conversation')
            command = {'kind': 'source', 'passage': source_passage(sources[key], arguments.get('quote', ''))}
        elif name == 'focus_source_phrase':
            command = {'kind': 'phrase', 'passage': focus_passage(self.passage, arguments.get('quote'))}
        elif name == 'inspect_visual':
            if self.graph is None and self.passage is None:
                raise ValueError('No acknowledged app-owned diagram or source excerpt is visible to inspect')
            command = {'kind': 'inspect'}
        elif name == 'hide_visual':
            command = {'kind': 'hide'}
        else:
            raise ValueError('Unknown presentation operation')
        self.revision += 1
        action = {'action_id': secrets.token_urlsafe(18), 'revision': self.revision, **command}
        self.pending[action['action_id']] = action
        return action

    def acknowledge(self, action_id, result):
        action = self.pending.get(action_id)
        if action is None or not isinstance(result, dict) or type(result.get('revision')) is not int or result.get('revision') != action['revision']:
            raise ValueError('Unknown or stale presentation receipt')
        expected = {'diagram': 'displayed', 'focus': 'focused', 'hide': 'hidden', 'inspect': 'inspected', 'source': 'source-displayed', 'phrase': 'phrase-focused'}[action['kind']]
        status = result.get('status')
        if status not in {expected, 'failed', 'cancelled'}:
            raise ValueError('Receipt does not match the proposed operation')
        count = result.get('rendered_elements', 0)
        if isinstance(count, bool) or not isinstance(count, int) or not 0 <= count <= 20:
            raise ValueError('Invalid rendered element count')
        if action['kind'] == 'diagram' and status == expected:
            if count != len(action['graph']['nodes']) + len(action['graph']['edges']):
                raise ValueError('The browser did not render the complete diagram')
        if action['kind'] == 'hide' and status == expected and count != 0:
            raise ValueError('A hidden diagram has no rendered elements')
        if action['kind'] in {'source', 'phrase'} and status == expected:
            if count != 1 or result.get('displayed_text_sha256') != action['passage']['displayed_text_sha256']:
                raise ValueError('The browser did not confirm the exact source passage')
            if result.get('highlighted_quote') != action['passage']['quote']:
                raise ValueError('The exact requested source phrase was not highlighted')
        image = None
        if action['kind'] == 'inspect' and status == expected:
            image = result.get('image')
            if not isinstance(image, dict) or image.get('mime_type') != 'image/jpeg' or type(image.get('width')) is not int or type(image.get('height')) is not int:
                raise ValueError('Inspection requires a real bounded rendered JPEG')
            if not 100 <= image['width'] <= 1600 or not 100 <= image['height'] <= 1200:
                raise ValueError('Unexpected inspection image dimensions')
            encoded = image.get('data')
            if not isinstance(encoded, str) or len(encoded) > 400000:
                raise ValueError('Diagram inspection exceeds its image budget')
            try:
                binary = base64.b64decode(encoded, validate=True)
            except Exception as error:
                raise ValueError('Invalid rendered image encoding') from error
            if not binary.startswith(b'\xff\xd8\xff') or not binary.endswith(b'\xff\xd9'):
                raise ValueError('Inspection image is not a JPEG')
            try:
                with av.open(io.BytesIO(binary), format='image2pipe', options={'protocol_whitelist':'pipe,data'}) as container:
                    frame = next(container.decode(video=0))
                    if frame.width != image['width'] or frame.height != image['height']:
                        raise ValueError('Inspection dimensions do not match its decoded pixels')
            except Exception as error:
                raise ValueError('The diagram inspection image is not decodable') from error
            if count != (len(self.graph['nodes']) + len(self.graph['edges']) if self.graph else 1):
                raise ValueError('Inspection did not contain the complete current graph')
            image = {**image, 'sha256': hashlib.sha256(binary).hexdigest()}
        self.pending.pop(action_id)
        if status != expected:
            return {'status': 'not-displayed', 'action_id': action_id,
                'answer': 'The browser did not finish the visual operation. Do not claim the requested visual is visible.'}
        if action['kind'] == 'diagram':
            self.graph, self.focus, self.passage = action['graph'], None, None
        elif action['kind'] == 'focus':
            self.focus = action['element_id']
        elif action['kind'] in {'source', 'phrase'}:
            self.passage, self.graph, self.focus = action['passage'], None, None
        elif action['kind'] == 'hide':
            self.graph, self.focus, self.passage = None, None, None
        answer = {'status': expected, 'action_id': action_id, 'revision': action['revision'],
            'visual': self.graph, 'focused_element': self.focus, 'rendered_elements': count,
            'scope': 'Browser-acknowledged conceptual diagram, not a retrieved experimental figure.'}
        if self.passage is not None:
            answer['passage'] = self.passage
            answer['scope'] = self.passage['scope']
        if image is not None:
            answer['_render_image'] = image
            answer['image_sha256'] = image['sha256']
            answer['inspection_scope'] = 'Only the actual current app-owned conceptual diagram or source-excerpt card. This is not a paper, webpage, video, desktop capture, or private-file reader.'
        return answer

    def abort(self, action_id):
        self.pending.pop(action_id, None)

    def cancel_pending(self):
        self.pending.clear()


def visual_declarations():
    return [
        {'name': 'inspect_visual', 'behavior': 'BLOCKING',
         'description': 'See the actual current app-owned diagram or exact source-excerpt card as an image, together with its element IDs. Inspect before judging readability, spatial relationships or correcting an explanation. Only this app-owned teaching canvas is captured; no browser tab, video, paper or computer file is read. This is an observation, not a new scientific source.',
         'parameters': {'type':'OBJECT','properties':{}}},
        {'name': 'sketch_mechanism', 'behavior': 'BLOCKING',
         'description': 'Create or replace a real spatial whiteboard next to Einstein. Draw a conceptual mechanism, never pretend it is an original experimental figure. Use 2–8 short-labelled nodes and up to 12 edges. Coordinates normalized .06–.94; use well-separated columns/rows. Say it is displayed only after status displayed. The actual returned IDs allow conversational edits/highlighting. For project-specific facts use supplied cached source IDs when sufficient; use lookup_lab for missing evidence or a requested refresh. Cite actual source IDs. Replace the whole graph to simplify or add/remove nodes.',
         'parameters': {'type': 'OBJECT', 'properties': {
             'title': {'type': 'STRING'}, 'caption': {'type': 'STRING'},
             'nodes': {'type': 'ARRAY', 'items': {'type': 'OBJECT', 'properties': {
                 'id': {'type': 'STRING'}, 'label': {'type': 'STRING'}, 'detail': {'type': 'STRING'},
                 'x': {'type': 'NUMBER'}, 'y': {'type': 'NUMBER'}}, 'required': ['id', 'label', 'x', 'y']}},
             'edges': {'type': 'ARRAY', 'items': {'type': 'OBJECT', 'properties': {
                 'from': {'type': 'STRING'}, 'to': {'type': 'STRING'}, 'label': {'type': 'STRING'},
                 'kind': {'type': 'STRING', 'enum': ['information', 'association', 'causal-hypothesis']}}, 'required': ['from', 'to']}},
             'source_ids': {'type': 'ARRAY', 'items': {'type': 'STRING'}}}, 'required': ['title', 'nodes', 'edges']}},
        {'name': 'focus_visual', 'behavior': 'BLOCKING',
         'description': 'Highlight an existing displayed node/edge, add a brief annotation, and direct the arm gesture toward that element. Targeted head rotation is not enabled. Select its actual ID from the current visual. The tool reports browser execution, not a promise.',
         'parameters': {'type': 'OBJECT', 'properties': {'element_id': {'type': 'STRING'}, 'annotation': {'type': 'STRING'}}, 'required': ['element_id']}},
        {'name': 'hide_visual', 'behavior': 'BLOCKING',
         'description': 'Dismiss the current whiteboard and restore the prior conversation camera. Wait for hidden status.',
         'parameters': {'type': 'OBJECT', 'properties': {}}}
    ] + passage_declarations()
