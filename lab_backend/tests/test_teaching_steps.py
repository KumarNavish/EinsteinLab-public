from copy import deepcopy

import pytest

from lab_backend.teaching_steps import teaching_declaration, teaching_plan, source_teaching_declaration, source_teaching_plan, source_teaching_request
from lab_backend.local_documents import SelectedPDF
from lab_backend.tests.test_local_documents import read_receipt
from lab_backend.visual_tools import VisualSession, visual_declarations


def explanation():
    return {
        'title': 'How the inspected experiment works',
        'nodes': [
            {'id': 'input', 'label': 'Measured input', 'x': .2, 'y': .3},
            {'id': 'comparison', 'label': 'Comparison', 'x': .5, 'y': .3},
            {'id': 'limit', 'label': 'What remains unknown', 'x': .8, 'y': .7},
        ],
        # A future-to-earlier relationship must stay hidden until both exist.
        'edges': [
            {'from': 'input', 'to': 'comparison', 'kind': 'information'},
            {'from': 'limit', 'to': 'input', 'kind': 'association'},
        ],
        'steps': [
            'Begin with the measured input shown on this page.',
            'The comparison tells us which difference was actually measured.',
            'This last item separates what was observed from what remains unknown.',
        ],
        'source_ids': ['observed-source'],
    }


SOURCES = {'observed-source': {
    'id': 'observed-source', 'title': 'Inspected source',
    'url': 'https://mobililab.ethz.ch/', 'fetched_at': '2026-10-17',
}}


def test_prefixes_never_reveal_future_nodes_edges_or_narration():
    arguments = explanation()
    original = deepcopy(arguments)
    stages = teaching_plan(arguments, SOURCES)
    assert arguments == original
    assert [stage['focus_id'] for stage in stages] == ['input', 'comparison', 'limit']
    assert [len(stage['graph']['nodes']) for stage in stages] == [1, 2, 3]
    assert [len(stage['graph']['edges']) for stage in stages] == [0, 1, 2]
    assert [stage['narration'] for stage in stages] == arguments['steps']
    for index, stage in enumerate(stages):
        assert stage['graph']['source_ids'] == ['observed-source']
        assert stage['focus_id'] == stage['graph']['nodes'][-1]['id']
        assert [node['id'] for node in stage['graph']['nodes']] == [
            node['id'] for node in arguments['nodes'][:index + 1]
        ]
        assert 'steps' not in stage['graph']
        assert stage['narration'] not in stage['graph'].values()
        assert 'experimental evidence' in stage['graph']['caption']
    stages[0]['graph']['nodes'][0]['label'] = 'Only this stage changes'
    assert stages[1]['graph']['nodes'][0]['label'] == 'Measured input'
    assert arguments == original


def test_each_stage_still_requires_its_own_exact_browser_receipt():
    visual = VisualSession()
    for stage in teaching_plan(explanation(), SOURCES):
        previous = visual.graph
        action = visual.propose('sketch_mechanism', stage['graph'], SOURCES)
        assert visual.graph is previous
        count = len(action['graph']['nodes']) + len(action['graph']['edges'])
        with pytest.raises(ValueError):
            visual.acknowledge(action['action_id'], {
                'status': 'displayed', 'revision': action['revision'], 'rendered_elements': count + 1,
            })
        assert visual.graph is previous
        visual.acknowledge(action['action_id'], {
            'status': 'displayed', 'revision': action['revision'], 'rendered_elements': count,
        })
        focus = visual.propose('focus_visual', {'element_id': stage['focus_id']}, SOURCES)
        assert visual.focus is None
        result = visual.acknowledge(focus['action_id'], {
            'status': 'focused', 'revision': focus['revision'], 'rendered_elements': count,
        })
        assert result['focused_element'] == stage['focus_id']


@pytest.mark.parametrize('change', [
    'missing-steps', 'too-few-steps', 'too-many-steps', 'one-node', 'seven-nodes',
    'blank-step', 'long-step', 'step-object', 'control-step',
    'unknown-source', 'unknown-edge', 'unsafe-id', 'invalid-coordinate',
])
def test_invalid_plan_cannot_start_partial_teaching(change):
    arguments = explanation()
    if change == 'missing-steps': arguments.pop('steps')
    if change == 'too-few-steps': arguments['steps'].pop()
    if change == 'too-many-steps': arguments['steps'].append('An extra step.')
    if change == 'one-node': arguments['nodes'] = arguments['nodes'][:1]; arguments['steps'] = arguments['steps'][:1]
    if change == 'seven-nodes': arguments['nodes'] *= 3; arguments['nodes'] = arguments['nodes'][:7]; arguments['steps'] = ['Step.'] * 7
    if change == 'blank-step': arguments['steps'][1] = '   '
    if change == 'long-step': arguments['steps'][1] = 'x' * 421
    if change == 'step-object': arguments['steps'][1] = {'narration': 'Wrong shape.'}
    if change == 'control-step': arguments['steps'][1] = 'Hidden\x00instruction'
    if change == 'unknown-source': arguments['source_ids'] = ['not-inspected']
    if change == 'unknown-edge': arguments['edges'][0]['to'] = 'future-invention'
    if change == 'unsafe-id': arguments['nodes'][0]['id'] = '../../private'
    if change == 'invalid-coordinate': arguments['nodes'][0]['x'] = True
    with pytest.raises(ValueError):
        teaching_plan(arguments, SOURCES)


def test_declaration_reuses_visual_schema_without_mutating_the_original():
    original = next(item for item in visual_declarations() if item['name'] == 'sketch_mechanism')
    declaration = teaching_declaration()
    assert declaration['name'] == 'teach_mechanism'
    assert declaration['behavior'] == 'BLOCKING'
    parameters = declaration['parameters']
    assert parameters['properties']['nodes']['minItems'] == 2
    assert parameters['properties']['nodes']['maxItems'] == 6
    assert parameters['properties']['steps']['items']['maxLength'] == 420
    assert 'steps' in parameters['required']
    assert 'steps' not in original['parameters']['properties']
    assert 'source_ids' in parameters['properties']
    assert 'first inspect the actual selected page or frame' in declaration['description']
    node_schema = parameters['properties']['nodes']['items']
    assert set(node_schema['properties']) == {'id', 'label'}
    assert node_schema['required'] == ['id', 'label']
    assert 'caption' not in parameters['properties']
    assert 'x' in original['parameters']['properties']['nodes']['items']['properties']


def test_application_places_coordinate_free_nodes_without_mutating_the_request():
    arguments = explanation()
    for node in arguments['nodes']:
        del node['x'], node['y']
    original = deepcopy(arguments)
    stages = teaching_plan(arguments, SOURCES)
    assert arguments == original
    assert [(n['x'], n['y']) for n in stages[-1]['graph']['nodes']] == [(.1, .5), (.5, .5), (.9, .5)]
    assert stages[0]['graph']['nodes'][0] == stages[-1]['graph']['nodes'][0]


def source_fixture():
    state = SelectedPDF()
    state.offer({'id': 'a' * 64, 'name': 'protocol-fixture.pdf', 'pages': 3, 'bytes': 1800,
                 'kind': 'visitor-selected-pdf', 'approved': True})
    state.select_view({'document_id': 'a' * 64, 'page': 2, 'region': [0, 0, 1, 1], 'view_revision': 1})
    read = state.propose('read_selected_pdf_page', {'page': 2})
    result = state.acknowledge(read_receipt(read))
    image_hash = result['_page_image']['sha256']
    regions = state.register_visual_regions(2, image_hash, [
        {'label': 'Record trace', 'region': [.2, .3, .15, .12]},
        {'label': 'Compile trace', 'region': [.45, .3, .15, .12]},
        {'label': 'Side exit', 'region': [.7, .45, .15, .12]},
    ], document_id='a' * 64)
    source_id = 'pdf-' + 'a' * 16 + '-p2'
    sources = {source_id: {'id': source_id, 'document_id': 'a' * 64, 'page': 2,
                           'source_kind': 'visitor-selected-pdf', 'title': 'protocol-fixture.pdf'}}
    args = {'title': 'An inspected tracing example', 'source_id': source_id, 'page': 2, 'image_sha256': image_hash,
            'steps': [
                {'region_id': regions[0]['id'], 'narration': 'Record trace captures the observed types along the repeating loop.'},
                {'region_id': regions[1]['id'], 'narration': 'Compile trace turns that recorded path into a faster execution route.'},
                {'region_id': regions[2]['id'], 'narration': 'Side exit leaves that route when its recorded assumptions fail.'},
            ]}
    return state, sources, args


def test_cached_source_teaching_cannot_jump_back_over_the_visitors_new_page():
    state, sources, args = source_fixture()
    state.select_view({'document_id': 'a' * 64, 'page': 3, 'region': [0, 0, 1, 1], 'view_revision': 2})
    with pytest.raises(ValueError, match='currently displayed page'):
        source_teaching_plan(args, sources, state)
    assert state.current_view['page'] == 3 and not state.pending
    state.current_view['page'] = 2
    state.current_view['visible'] = False
    args['page'] = 2
    with pytest.raises(ValueError): source_teaching_plan(args, sources, state)


def test_source_plan_keeps_original_provenance_stable_crop_and_cumulative_inspected_marks():
    state, sources, args = source_fixture()
    original = deepcopy(args)
    stages = source_teaching_plan(args, sources, state)
    assert args == original and state.operations == 1 and not state.pending
    assert [len(stage['marks']) for stage in stages] == [1, 2, 3]
    assert len({tuple(stage['view_region']) for stage in stages}) == 1
    for index, stage in enumerate(stages):
        assert 'graph' not in stage and stage['mode'] == 'source'
        assert stage['source_id'] == args['source_id'] and stage['source_ids'] == [args['source_id']]
        assert stage['page'] == 2 and stage['image_sha256'] == args['image_sha256']
        assert stage['render_status'] == 'page-annotated'
        assert stage['marks'][-1]['region_id'] == stage['region_id'] == args['steps'][index]['region_id']
        assert stage['focus_label'] == state.visual_regions[stage['region_id']]['label']
        assert all('region' not in mark for mark in stage['marks']), 'Planner coordinates must never enter the action.'
        x, y, width, height = stage['view_region']
        for mark in stage['marks']:
            left, top, w, h = state.visual_regions[mark['region_id']]['region']
            assert x <= left and y <= top and x + width >= left + w and y + height >= top + h
    stages[0]['marks'][0]['label'] = 'Changed copy'
    assert stages[1]['marks'][0]['label'] == 'Record trace'


@pytest.mark.parametrize('change', ['unknown-source', 'wrong-document', 'wrong-page', 'boolean-page',
    'wrong-hash', 'no-vision', 'revoked', 'unknown-region', 'duplicate-region', 'region-from-other-image',
    'one-step', 'seven-steps', 'short-speech', 'long-speech', 'raw-coordinates', 'step-coordinates', 'budget'])
def test_source_plan_rejects_uninspected_mismatched_or_invented_teaching_before_render(change):
    state, sources, args = source_fixture()
    if change == 'unknown-source': args['source_id'] = 'not-inspected'
    if change == 'wrong-document': sources[args['source_id']]['document_id'] = 'b' * 64
    if change == 'wrong-page': args['page'] = 1
    if change == 'boolean-page': args['page'] = True
    if change == 'wrong-hash': args['image_sha256'] = 'e' * 64
    if change == 'no-vision': state.visually_verified_pages.clear()
    if change == 'revoked': state.revoke()
    if change == 'unknown-region': args['steps'][1]['region_id'] = 'not-inspected'
    if change == 'duplicate-region': args['steps'][1]['region_id'] = args['steps'][0]['region_id']
    if change == 'region-from-other-image': state.visual_regions[args['steps'][1]['region_id']]['image_sha256'] = 'e' * 64
    if change == 'one-step': args['steps'] = args['steps'][:1]
    if change == 'seven-steps': args['steps'] = args['steps'] * 2 + args['steps'][:1]
    if change == 'short-speech': args['steps'][0]['narration'] = 'Record trace.'
    if change == 'long-speech': args['steps'][0]['narration'] = 'word ' * 21
    if change == 'raw-coordinates': args['region'] = [0, 0, 1, 1]
    if change == 'step-coordinates': args['steps'][0]['region'] = [0, 0, 1, 1]
    if change == 'budget': state.operations = 28
    with pytest.raises(ValueError): source_teaching_plan(args, sources, state)
    assert not state.pending


def test_source_declaration_is_region_only_and_parses_with_the_actual_sdk_schema():
    from google.genai import types
    declaration = source_teaching_declaration()
    types.FunctionDeclaration(**declaration)
    assert declaration['name'] == 'teach_source' and declaration['behavior'] == 'BLOCKING'
    properties = declaration['parameters']['properties']
    assert set(properties) == {'title', 'steps'}
    assert declaration['parameters']['required'] == ['title', 'steps']
    assert set(properties['steps']['items']['properties']) == {'region_id', 'narration'}


def test_compact_request_produces_the_identical_canonical_plan_without_mutating_state():
    state, sources, canonical = source_fixture()
    request = {'title': canonical['title'], 'steps': deepcopy(canonical['steps'])}
    original = deepcopy(request)
    expected = source_teaching_plan(canonical, sources, state)
    assert source_teaching_request(request, sources, state) == expected
    assert request == original and state.operations == 1 and not state.pending
    assert set(request) == {'title', 'steps'}


@pytest.mark.parametrize('change', [
    'foreign-source', 'foreign-region', 'mixed-hash', 'mixed-page', 'old-page', 'hidden-page',
    'revoked', 'replaced', 'missing-first-region', 'missing-later-region', 'no-vision',
    'unmeasured-hash', 'duplicate-region', 'ambiguous-source', 'miskeyed-source',
    'source_id', 'page', 'image_sha256', 'canonical-metadata', 'coordinates',
    'step-metadata', 'short-speech', 'budget',
])
def test_compact_source_request_cannot_bypass_the_canonical_evidence_boundary(change):
    state, sources, canonical = source_fixture()
    request = {'title': canonical['title'], 'steps': deepcopy(canonical['steps'])}
    first_id, second_id = [step['region_id'] for step in request['steps'][:2]]
    source = sources[canonical['source_id']]
    if change == 'foreign-source': source['document_id'] = 'b' * 64
    if change == 'foreign-region': request['steps'][0]['region_id'] = 'other-document-region'
    if change == 'mixed-hash': state.visual_regions[second_id]['image_sha256'] = 'e' * 64
    if change == 'mixed-page': state.visual_regions[second_id]['page'] = 3
    if change == 'old-page':
        state.select_view({'document_id': state.document['id'], 'page': 3,
                           'region': [0, 0, 1, 1], 'view_revision': 2})
    if change == 'hidden-page': state.current_view['visible'] = False
    if change == 'revoked': state.revoke()
    if change == 'replaced': state.offer({**state.document, 'id': 'b' * 64, 'approved': True})
    if change == 'missing-first-region': request['steps'][0].pop('region_id')
    if change == 'missing-later-region': request['steps'][1].pop('region_id')
    if change == 'no-vision': state.visually_verified_pages.clear()
    if change == 'unmeasured-hash': state.visual_regions[first_id]['image_sha256'] = 'e' * 64
    if change == 'duplicate-region': request['steps'][1]['region_id'] = first_id
    if change == 'ambiguous-source': sources['another-source'] = {**source, 'id': 'another-source'}
    if change == 'miskeyed-source': source['id'] = 'another-source'
    if change in {'source_id', 'page', 'image_sha256'}: request[change] = canonical[change]
    if change == 'canonical-metadata': request = deepcopy(canonical)
    if change == 'coordinates': request['region'] = [0, 0, 1, 1]
    if change == 'step-metadata': request['steps'][0]['image_sha256'] = canonical['image_sha256']
    if change == 'short-speech': request['steps'][0]['narration'] = 'Record trace.'
    if change == 'budget': state.operations = 28
    with pytest.raises(ValueError):
        source_teaching_request(request, sources, state)
    assert not state.pending


@pytest.mark.parametrize('arguments', [None, [], {}, {'title': 'Missing steps'},
    {'title': 'Invalid steps', 'steps': None}, {'title': 'No steps', 'steps': []},
    {'title': 'Wrong step shape', 'steps': ['not a region', {}]},
    {'title': 'Non-string ID', 'steps': [{'region_id': []}, {}]}])
def test_malformed_compact_request_fails_before_any_render(arguments):
    state, sources, _canonical = source_fixture()
    with pytest.raises(ValueError):
        source_teaching_request(arguments, sources, state)
    assert not state.pending
