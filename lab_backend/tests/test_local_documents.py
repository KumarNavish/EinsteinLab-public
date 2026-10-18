import base64
import io
from PIL import Image
import pytest
from lab_backend.local_documents import SelectedPDF, region, DOCUMENT_TOOLS


def offered():
    state = SelectedPDF()
    state.offer({'id': 'a' * 64, 'name': 'visitor-selected-study.pdf', 'pages': 3, 'bytes': 1800,
                 'kind': 'visitor-selected-pdf', 'approved': True})
    return state


def read_receipt(action, **changes):
    image = Image.new('RGB', (320, 240), '#fff')
    output = io.BytesIO(); image.save(output, format='JPEG')
    return {'action_id': action['action_id'], 'document_id': action['document_id'],
            'revision': action['revision'], 'ok': True, 'page': action['page'], 'region': action['region'],
            'text': 'A controlled synthetic page fixture, not a research finding.',
            'image': {'mime_type': 'image/jpeg', 'data': base64.b64encode(output.getvalue()).decode()}, **changes}


def test_no_read_without_explicit_visitor_approval():
    state = SelectedPDF()
    with pytest.raises(ValueError): state.propose('read_selected_pdf_page', {'page': 1})
    with pytest.raises(ValueError):
        state.offer({'id': 'a' * 64, 'name': 'file.pdf', 'pages': 1, 'bytes': 1000, 'kind': 'visitor-selected-pdf', 'approved': False})


@pytest.mark.parametrize('value', [[-1, 0, 1, 1], [0, 0, 1.1, 1], [0, 0, .001, 1], [False, 0, 1, 1], [0, 0, float('nan'), 1], [0, 0, 1]])
def test_bounded_full_page_coordinates(value):
    with pytest.raises(ValueError): region(value)


@pytest.mark.parametrize('page', [True, 0, 4, '1', 1.5])
def test_only_existing_pages_can_be_requested(page):
    state = offered()
    with pytest.raises(ValueError): state.propose('read_selected_pdf_page', {'page': page})


def test_source_is_not_inspected_before_matching_browser_receipt():
    state = offered(); action = state.propose('read_selected_pdf_page', {'page': 2})
    assert not state.inspected_pages
    result = state.acknowledge(read_receipt(action))
    assert result['status'] == 'page-inspected' and state.inspected_pages == {2}
    assert result['sources'][0]['page'] == 2
    assert result['sources'][0]['document_id'] == 'a' * 64
    assert result['_page_image']['sha256']


def test_uninspected_page_cannot_be_annotated():
    state = offered()
    with pytest.raises(ValueError): state.propose('mark_selected_pdf', {'page': 1, 'marks': [{'kind': 'box', 'region': [0, 0, .5, .5]}]})


def test_annotation_requires_the_exact_source_page_and_count():
    state = offered(); read = state.propose('read_selected_pdf_page', {'page': 1})
    state.acknowledge(read_receipt(read))
    state.visually_verified_pages.add(1)
    action = state.propose('mark_selected_pdf', {'page': 1, 'marks': [{'kind': 'box', 'region': [.1, .1, .5, .4], 'label': 'Interpretation, not source data'}]})
    response = {'action_id': action['action_id'], 'document_id': action['document_id'], 'revision': action['revision'], 'ok': True, 'page': 1, 'region': [0, 0, 1, 1], 'mark_count': 0}
    with pytest.raises(ValueError): state.acknowledge(response)
    response['mark_count'] = 1
    assert state.acknowledge(response)['status'] == 'page-annotated'


@pytest.mark.parametrize('changes', [{'document_id': 'b' * 64}, {'revision': 400}, {'page': 3}, {'region': [.1, .1, .5, .5]}])
def test_wrong_or_stale_receipt_is_not_accepted(changes):
    state = offered(); action = state.propose('read_selected_pdf_page', {'page': 1})
    with pytest.raises(ValueError): state.acknowledge(read_receipt(action, **changes))
    assert not state.inspected_pages


def test_fake_image_is_not_an_observation():
    state = offered(); action = state.propose('read_selected_pdf_page', {'page': 1})
    with pytest.raises(ValueError): state.acknowledge(read_receipt(action, image={'mime_type': 'image/jpeg', 'data': base64.b64encode(b'not a JPEG').decode()}))


def test_independent_connections_never_share_document_ownership():
    a = offered(); b = SelectedPDF()
    action = a.propose('read_selected_pdf_page', {'page': 1})
    with pytest.raises(ValueError): b.acknowledge(read_receipt(action))
    assert b.document is None and not b.inspected_pages


def test_removing_document_revokes_pending_actions_and_knowledge_state():
    state = offered(); action = state.propose('read_selected_pdf_page', {'page': 1})
    state.revoke()
    with pytest.raises(ValueError): state.acknowledge(read_receipt(action))
    assert state.document is None and not state.pending and not state.inspected_pages


def test_operations_are_bounded_and_not_parallel():
    state = offered(); first = state.propose('read_selected_pdf_page', {'page': 1})
    with pytest.raises(ValueError): state.propose('read_selected_pdf_page', {'page': 2})
    state.abort(first['action_id']); state.operations = 30
    with pytest.raises(ValueError): state.propose('read_selected_pdf_page', {'page': 1})


def test_client_failure_is_not_promoted_to_display_success():
    state = offered(); action = state.propose('read_selected_pdf_page', {'page': 1})
    receipt = {'action_id': action['action_id'], 'document_id': action['document_id'], 'revision': action['revision'], 'ok': False}
    assert state.acknowledge(receipt)['status'] == 'not-displayed'
    assert not state.pending and not state.inspected_pages


def test_document_metadata_does_not_authorize_paths_or_urls():
    state = offered()
    with pytest.raises(ValueError): state.propose('read_selected_pdf_page', {'page': 1, 'url': 'file:///private/key'})
    with pytest.raises(ValueError): state.offer({**state.document, 'approved': True, 'path': '/etc/passwd'})


def test_text_and_delivered_pixels_without_successful_vision_do_not_authorize_marks():
    state = offered(); action = state.propose('read_selected_pdf_page', {'page': 1})
    state.acknowledge(read_receipt(action))
    assert 1 in state.inspected_pages and 1 not in state.visually_verified_pages
    with pytest.raises(ValueError):
        state.propose('mark_selected_pdf', {'page': 1, 'marks': [{'kind': 'box', 'region': [.1, .1, .4, .4]}]})


def test_inspected_region_id_resolves_exact_source_coordinates():
    state = offered(); action = state.propose('read_selected_pdf_page', {'page': 2})
    state.acknowledge(read_receipt(action))
    source = state.register_visual_regions(2, 'd' * 64, [{'label': 'Source state', 'region': [.61, .18, .15, .012]}], document_id='a' * 64)[0]
    mark = state.propose('mark_selected_pdf', {'page': 2, 'marks': [{'kind': 'box', 'region_id': source['id']}]})
    assert mark['marks'][0]['region'] == [.61, .18, .15, .012]
    assert mark['marks'][0]['label'] == 'Source state'


def test_region_ids_cannot_cross_pages_or_documents():
    state = offered(); action = state.propose('read_selected_pdf_page', {'page': 2})
    state.acknowledge(read_receipt(action))
    source = state.register_visual_regions(2, 'd' * 64, [{'label': 'Source state', 'region': [.61, .18, .15, .012]}], document_id='a' * 64)[0]
    state.visually_verified_pages.add(1)
    with pytest.raises(ValueError): state.propose('mark_selected_pdf', {'page': 1, 'marks': [{'kind': 'box', 'region_id': source['id']}]})
    state.revoke()
    assert not state.visual_regions and not state.visually_verified_pages


def test_thin_scientific_annotation_does_not_require_a_large_image_crop():
    state = offered(); state.inspected_pages.add(2); state.visually_verified_pages.add(2)
    action = state.propose('mark_selected_pdf', {'page': 2, 'marks': [{'kind': 'box', 'region': [.61, .18, .15, .012]}]})
    assert action['marks'][0]['region'][3] == .012
    state.abort(action['action_id'])
    with pytest.raises(ValueError): state.propose('read_selected_pdf_page', {'page': 2, 'region': [.61, .18, .15, .012]})


def test_delayed_visual_result_cannot_bind_to_a_replacement_document():
    state = offered(); first = state.propose('read_selected_pdf_page', {'page': 2})
    result = state.acknowledge(read_receipt(first))
    old_document = result['document']['id']
    state.offer({'id': 'b' * 64, 'name': 'different-study.pdf', 'pages': 3, 'bytes': 2000,
                 'kind': 'visitor-selected-pdf', 'approved': True})
    second = state.propose('read_selected_pdf_page', {'page': 2})
    state.acknowledge(read_receipt(second))
    with pytest.raises(ValueError):
        state.register_visual_regions(2, 'd' * 64, [{'label': 'Old source region', 'region': [.1, .1, .3, .3]}], document_id=old_document)
    assert not state.visual_regions
    assert not state.visually_verified_pages


def test_annotation_diagnostic_exposes_finite_shape_without_submitted_strings():
    state = offered()
    secret = 'private-value-must-not-be-in-diagnostic'
    arguments = {'page': 2, secret: secret, 'marks': [{'kind': secret, 'region_id': secret,
                  'region': [0, 0, .3, .3], secret: secret}]}
    diagnostic = state.action_diagnostic('mark_selected_pdf', arguments,
                                        ValueError('Use a source region ID or explicit coordinates, not both'))
    assert diagnostic['tool'] == 'mark_selected_pdf'
    assert diagnostic['code'] == 'region-id-and-coordinates'
    assert diagnostic['unexpected_field_count'] == 1
    assert diagnostic['marks'][0] == {'type': 'object', 'fields': ['kind', 'region', 'region_id'],
        'unexpected_field_count': 1, 'kind': 'invalid', 'kind_type': 'string', 'region_id_type': 'string',
        'region_id_known': False, 'region_id_matches_page': False, 'region_type': 'array', 'region_length': 4}
    import json
    assert secret not in json.dumps(diagnostic)
    assert state.action_diagnostic('mark_selected_pdf', arguments, ValueError(secret))['code'] == 'document-action-invalid'


def test_diagnostic_recognizes_the_inspected_region_but_does_not_change_validation():
    state = offered(); action = state.propose('read_selected_pdf_page', {'page': 2})
    state.acknowledge(read_receipt(action))
    source = state.register_visual_regions(2, 'd' * 64, [{'label': 'Source state', 'region': [.61, .18, .15, .012]}], document_id='a' * 64)[0]
    arguments = {'page': 2, 'marks': [{'kind': 'box', 'region_id': source['id'], 'region': source['region']}]}
    with pytest.raises(ValueError) as error: state.propose('mark_selected_pdf', arguments)
    diagnostic = state.action_diagnostic('mark_selected_pdf', arguments, error.value)
    assert diagnostic['code'] == 'region-id-and-coordinates'
    assert diagnostic['marks'][0]['region_id_known'] is True
    assert diagnostic['marks'][0]['region_id_matches_page'] is True
    assert not state.pending


def test_selected_view_is_metadata_and_preserves_inspected_page_evidence():
    state = offered()
    action = state.propose('read_selected_pdf_page', {'page': 2})
    state.acknowledge(read_receipt(action))
    regions = state.register_visual_regions(2, 'd' * 64, [{'label': 'Existing region', 'region': [.1, .1, .3, .3]}], document_id='a' * 64)
    operations = state.operations
    info = state.select_view({'document_id': 'a' * 64, 'page': 3, 'region': [0, 0, 1, 1], 'view_revision': 1})
    assert info['current_view'] == {'page': 3, 'region': [0., 0., 1., 1.], 'view_revision': 1, 'visually_inspected': False}
    assert state.inspected_pages == state.visually_verified_pages == {2}
    assert state.visual_regions[regions[0]['id']] == regions[0]
    assert state.operations == operations, 'Selecting a page must not inspect it or use a tool operation.'
    info = state.select_view({'document_id': 'a' * 64, 'page': 2, 'region': [.1, .1, .5, .5], 'view_revision': 2})
    assert info['current_view']['visually_inspected'] is True


@pytest.mark.parametrize('changes', [
    {'document_id': 'b' * 64}, {'page': 0}, {'page': 4}, {'page': True}, {'page': '2'},
    {'region': [0, 0, float('nan'), 1]}, {'region': [0, 0, .01, 1]}, {'region': [False, 0, 1, 1]},
    {'view_revision': 0}, {'view_revision': True}, {'view_revision': 10001}, {'image': 'not allowed'},
])
def test_invalid_view_metadata_cannot_change_state_or_cancel_valid_pending_action(changes):
    state = offered(); pending = state.propose('read_selected_pdf_page', {'page': 2})
    with pytest.raises(ValueError):
        state.select_view({'document_id': 'a' * 64, 'page': 3, 'region': [0, 0, 1, 1], 'view_revision': 1, **changes})
    assert state.current_view is None and state.view_revision == 0
    assert pending['action_id'] in state.pending


def test_view_selection_rejects_unapproved_and_revoked_documents_and_stale_receipts():
    state = SelectedPDF()
    view = {'document_id': 'a' * 64, 'page': 2, 'region': [0, 0, 1, 1], 'view_revision': 1}
    with pytest.raises(ValueError): state.select_view(view)
    state = offered(); pending = state.propose('read_selected_pdf_page', {'page': 1})
    state.select_view(view)
    assert not state.pending and not state.inspected_pages
    with pytest.raises(ValueError): state.acknowledge(read_receipt(pending))
    with pytest.raises(ValueError): state.select_view(view)
    action = state.propose('read_selected_pdf_page', {'page': 2})
    assert action['view_revision'] == 1
    state.revoke()
    with pytest.raises(ValueError): state.select_view({**view, 'view_revision': 2})


def test_browser_acknowledged_tool_navigation_updates_the_current_view_without_a_new_user_epoch():
    state = offered()
    state.select_view({'document_id': 'a' * 64, 'page': 1, 'region': [0, 0, 1, 1], 'view_revision': 1})
    action = state.propose('read_selected_pdf_page', {'page': 2, 'region': [.1, .2, .5, .6]})
    result = state.acknowledge(read_receipt(action))
    assert state.current_view == {'page': 2, 'region': [.1, .2, .5, .6], 'visible': True}
    assert result['current_view'] == {**state.current_view, 'view_revision': 1}
    state.register_visual_regions(2, 'd' * 64, [{'label': 'Source region', 'region': [.1, .2, .3, .3]}], document_id='a' * 64)
    state.select_view({'document_id': 'a' * 64, 'page': 1, 'region': [0, 0, 1, 1], 'view_revision': 2})
    mark = state.propose('mark_selected_pdf', {'page': 2, 'marks': [{'kind': 'box', 'region': [.1, .2, .3, .3]}]})
    result = state.acknowledge({'action_id': mark['action_id'], 'document_id': mark['document_id'],
                               'revision': mark['revision'], 'ok': True, 'page': 2, 'region': [0, 0, 1, 1], 'mark_count': 1})
    assert result['current_view'] == {'page': 2, 'region': [0., 0., 1., 1.], 'visible': True, 'view_revision': 2}
    assert state.view_revision == 2 and state.inspected_pages == state.visually_verified_pages == {2}
    hide = state.propose('close_selected_pdf_view', {})
    result = state.acknowledge({'action_id': hide['action_id'], 'document_id': hide['document_id'],
                               'revision': hide['revision'], 'ok': True})
    assert result['current_view'] is None and state.description()['current_view'] is None
    assert state.document is not None and state.inspected_pages == state.visually_verified_pages == {2}
    assert state.view_revision == 2


def test_source_teaching_requires_an_acknowledgement_of_the_exact_server_owned_crop():
    state = offered()
    read = state.propose('read_selected_pdf_page', {'page': 2})
    state.acknowledge(read_receipt(read))
    inspected = state.register_visual_regions(2, 'd' * 64, [{'label': 'Original guard', 'region': [.5, .3, .2, .1]}], document_id='a' * 64)[0]
    assert inspected['image_sha256'] == 'd' * 64
    mark = state.propose('mark_selected_pdf', {'page': 2, 'marks': [{'kind': 'box', 'region_id': inspected['id']}]})
    mark['view_region'] = [.4, .2, .4, .3]
    receipt = {'action_id': mark['action_id'], 'document_id': mark['document_id'], 'revision': mark['revision'],
               'ok': True, 'page': 2, 'mark_count': 1, 'region': [0, 0, 1, 1]}
    with pytest.raises(ValueError): state.acknowledge(receipt)
    assert state.current_view['region'] == [0., 0., 1., 1.]
    receipt['region'] = list(mark['view_region'])
    assert state.acknowledge(receipt)['current_view']['region'] == mark['view_region']
