import copy
import math
import pytest
from lab_backend.visual_tools import VisualSession, visual_declarations
from lab_backend.voice_direction import selected_accent, DEFAULT_ACCENT


def graph():
    return {'title': 'Evidence and decisions', 'nodes': [
        {'id': 'question', 'label': 'Question', 'x': .2, 'y': .3},
        {'id': 'evidence', 'label': 'Evidence', 'x': .8, 'y': .3},
        {'id': 'decision', 'label': 'Decision', 'x': .5, 'y': .8}],
        'edges': [{'from': 'question', 'to': 'evidence'}, {'from': 'evidence', 'to': 'decision', 'kind': 'association'}]}


def ack(action, status='displayed', count=5):
    return {'revision': action['revision'], 'status': status, 'rendered_elements': count}


def test_proposal_is_not_visible_until_complete_browser_ack():
    session = VisualSession()
    action = session.propose('sketch_mechanism', graph(), {})
    assert session.graph is None
    result = session.acknowledge(action['action_id'], ack(action))
    assert result['status'] == 'displayed' and session.graph['scope'] == 'conceptual-explanation'


def test_wrong_receipt_does_not_consume_pending_action():
    session = VisualSession(); action = session.propose('sketch_mechanism', graph(), {})
    for receipt in [dict(ack(action), revision=99), ack(action, 'focused'), ack(action, count=4)]:
        with pytest.raises(ValueError): session.acknowledge(action['action_id'], receipt)
        assert action['action_id'] in session.pending and session.graph is None
    session.acknowledge(action['action_id'], ack(action))
    with pytest.raises(ValueError): session.acknowledge(action['action_id'], ack(action))


def test_failed_display_retains_previous_graph():
    session = VisualSession(); a = session.propose('sketch_mechanism', graph(), {})
    session.acknowledge(a['action_id'], ack(a)); original = session.graph
    replacement = graph(); replacement['title'] = 'Unconfirmed replacement'
    b = session.propose('sketch_mechanism', replacement, {})
    result = session.acknowledge(b['action_id'], ack(b, 'failed', 0))
    assert result['status'] == 'not-displayed' and session.graph is original


def test_focus_and_hide_apply_only_to_acknowledged_graph():
    session = VisualSession()
    with pytest.raises(ValueError): session.propose('focus_visual', {'element_id': 'question'}, {})
    action = session.propose('sketch_mechanism', graph(), {}); session.acknowledge(action['action_id'], ack(action))
    with pytest.raises(ValueError): session.propose('focus_visual', {'element_id': 'imaginary'}, {})
    focus = session.propose('focus_visual', {'element_id': 'edge-1', 'annotation': 'Association, not causation'}, {})
    assert session.focus is None
    result = session.acknowledge(focus['action_id'], ack(focus, 'focused'))
    assert result['focused_element'] == 'edge-1'
    hide = session.propose('hide_visual', {}, {}); assert session.graph is not None
    session.acknowledge(hide['action_id'], ack(hide, 'hidden', 0)); assert session.graph is None


@pytest.mark.parametrize('value', [True, -1, .99, float('nan'), float('inf'), '0.3'])
def test_invalid_geometry_rejected(value):
    spec = graph(); spec['nodes'][0]['x'] = value
    with pytest.raises(ValueError): VisualSession().propose('sketch_mechanism', spec, {})


@pytest.mark.parametrize('change', ['duplicate', 'unknown-edge', 'self-edge', 'unknown-source', 'too-many-nodes', 'unsafe-id'])
def test_invalid_graph_rejected(change):
    spec = graph()
    if change == 'duplicate': spec['nodes'][1]['id'] = spec['nodes'][0]['id']
    if change == 'unknown-edge': spec['edges'][0]['to'] = 'absent'
    if change == 'self-edge': spec['edges'][0]['to'] = 'question'
    if change == 'unknown-source': spec['source_ids'] = ['invented-source']
    if change == 'too-many-nodes': spec['nodes'] *= 4
    if change == 'unsafe-id': spec['nodes'][0]['id'] = '../../file'
    with pytest.raises(ValueError): VisualSession().propose('sketch_mechanism', spec, {})


def test_exact_source_ids_and_literal_text_only():
    spec = graph(); spec['source_ids'] = ['s1']; spec['nodes'][0]['label'] = '<script>alert(1)</script>'
    sources = {'s1': {'id': 's1', 'title': 'Actual source', 'url': 'https://mobililab.ethz.ch/', 'fetched_at': '2026-10-14'}}
    action = VisualSession().propose('sketch_mechanism', spec, sources)
    assert action['graph']['nodes'][0]['label'] == '<script>alert(1)</script>'
    assert action['graph']['sources'][0]['id'] == 's1'  # The canvas paints text; it does not execute markup.


def test_cancellation_and_serialization():
    session = VisualSession(); action = session.propose('sketch_mechanism', graph(), {})
    with pytest.raises(ValueError): session.propose('hide_visual', {}, {})
    session.cancel_pending()
    with pytest.raises(ValueError): session.acknowledge(action['action_id'], ack(action))
    assert session.graph is None
    newer = session.propose('sketch_mechanism', graph(), {})
    assert newer['revision'] > action['revision']


def test_visual_tools_are_data_only_and_blocking():
    declarations = visual_declarations()
    assert {d['name'] for d in declarations} == {'sketch_mechanism', 'focus_visual', 'hide_visual', 'inspect_visual', 'show_source_passage', 'focus_source_phrase'}
    assert all(d['behavior'] == 'BLOCKING' for d in declarations)
    assert 'url' not in str(declarations[0]['parameters']) and 'script' not in declarations[0]['parameters']['properties']


def test_accent_choice_is_explicit_and_bounded():
    assert selected_accent(None) == DEFAULT_ACCENT == 'german'
    assert selected_accent('original') == 'original'
    with pytest.raises(ValueError): selected_accent('unsupported')


def test_boolean_revision_does_not_count_as_integer_one():
    s = VisualSession(); a = s.propose('sketch_mechanism', graph(), {})
    with pytest.raises(ValueError): s.acknowledge(a['action_id'], {**ack(a), 'revision': True})
    assert a['action_id'] in s.pending
