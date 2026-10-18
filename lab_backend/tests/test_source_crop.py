"""Geometry regressions using reported measurements and decoded image fixtures.

These tests do not constitute browser, narration or semantic acceptance evidence.
"""
import base64
import io

from PIL import Image
import pytest

from lab_backend.teaching_steps import source_teaching_plan
from lab_backend.tests.test_local_documents import offered, read_receipt


# The three selected source regions from the failed public first stage.
REPORTED_REGIONS = [
    {'label': 'Native execution loop', 'region': [.689, .371, .152, .047]},
    {'label': 'Interpret and monitor', 'region': [.637, .263, .087, .078]},
    {'label': 'Trace entry and exit', 'region': [.744, .341, .089, .125]},
]


def geometry_fixture(size=(1236, 1600), crop=None, regions=None):
    state = offered()
    action = state.propose('read_selected_pdf_page', {'page': 2, 'region': crop or [0, 0, 1, 1]})
    output = io.BytesIO()
    Image.new('RGB', size, '#fff').save(output, format='JPEG')
    image = {'mime_type': 'image/jpeg', 'data': base64.b64encode(output.getvalue()).decode(),
             'width': 1, 'height': 1}  # Untrusted JSON dimensions must be ignored.
    result = state.acknowledge(read_receipt(action, image=image))
    fingerprint = result['_page_image']['sha256']
    registered = state.register_visual_regions(2, fingerprint, regions or REPORTED_REGIONS, document_id=state.document['id'])
    source = result['sources'][0]
    args = {'title': 'Original source figure', 'source_id': source['id'], 'page': 2, 'image_sha256': fingerprint,
            'steps': [{'region_id': item['id'], 'narration': item['label'] + ' anchors the next connection explained on the original figure.'}
                      for item in registered]}
    return state, {source['id']: source}, args, result


def assert_contains_regions(crop, state, args):
    x, y, width, height = crop
    assert 0 <= x < 1 and 0 <= y < 1 and x + width <= 1.000001 and y + height <= 1.000001
    for step in args['steps']:
        left, top, w, h = state.visual_regions[step['region_id']]['region']
        assert x <= left + 1e-12 and y <= top + 1e-12
        assert x + width >= left + w - 1e-12 and y + height >= top + h - 1e-12


def test_reported_portrait_crop_expands_to_fit_the_unchanged_workspace_without_dropping_source_regions():
    state, sources, args, result = geometry_fixture()
    assert (result['_page_image']['width'], result['_page_image']['height']) == (1236, 1600)
    page_aspect = state.page_aspects[(2, args['image_sha256'])]
    assert page_aspect == pytest.approx(1236 / 1600)
    stages = source_teaching_plan(args, sources, state)
    crop = stages[0]['view_region']
    assert crop == pytest.approx([.4827864077669903, .228, .5124271844660194, .273])
    assert crop[2] * page_aspect / crop[3] == pytest.approx(1.45)
    projected_height = 519.03125 * crop[3] / (crop[2] * page_aspect)
    assert projected_height == pytest.approx(357.95258620689657)
    assert projected_height < 428, 'The original public workspace and size oracle stay unchanged.'
    assert_contains_regions(crop, state, args)
    assert all(stage['view_region'] == crop and stage['image_sha256'] == args['image_sha256'] for stage in stages)
    assert [len(stage['marks']) for stage in stages] == [1, 2, 3]


def test_truly_tall_source_uses_all_available_original_width_without_clipping_vertical_content():
    regions = [{'label': 'Upper source area', 'region': [.2, .04, .15, .3]},
               {'label': 'Lower source area', 'region': [.3, .66, .15, .3]}]
    state, sources, args, _result = geometry_fixture((600, 1600), regions=regions)
    crop = source_teaching_plan(args, sources, state)[0]['view_region']
    assert crop[0] == 0 and crop[2] == 1
    assert crop[1] == pytest.approx(.005) and crop[3] == pytest.approx(.99)
    assert crop[2] * (600 / 1600) / crop[3] < 1.45
    assert_contains_regions(crop, state, args)


def test_landscape_source_does_not_shrink_already_useful_surrounding_source_context():
    regions = [{'label': 'Left source area', 'region': [.1, .3, .3, .15]},
               {'label': 'Right source area', 'region': [.6, .3, .3, .15]}]
    state, sources, args, _result = geometry_fixture((1600, 900), regions=regions)
    crop = source_teaching_plan(args, sources, state)[0]['view_region']
    assert crop == pytest.approx([.065, .265, .87, .22])
    assert_contains_regions(crop, state, args)


def test_cropped_inspection_recovers_original_page_aspect_instead_of_using_the_image_shape():
    regions = [{'label': 'First cropped area', 'region': [.28, .17, .12, .08]},
               {'label': 'Second cropped area', 'region': [.45, .32, .10, .10]}]
    state, sources, args, _result = geometry_fixture((400, 800), crop=[.2, .1, .4, .5], regions=regions)
    aspect = state.page_aspects[(2, args['image_sha256'])]
    assert aspect == pytest.approx(.625), 'Image aspect .5 must be corrected by the actual inspected crop.'
    crop = source_teaching_plan(args, sources, state)[0]['view_region']
    assert crop[2] == pytest.approx(.7424)
    assert crop[2] * aspect / crop[3] == pytest.approx(1.45)
    assert_contains_regions(crop, state, args)


@pytest.mark.parametrize('aspect', [None, True, '1.45', 0, -1, float('nan'), float('inf'), 1e6, 1e-9])
def test_missing_or_invalid_measured_aspect_cannot_fall_back_to_assumed_page_geometry(aspect):
    state, sources, args, _result = geometry_fixture()
    key = (2, args['image_sha256'])
    if aspect is None:
        state.page_aspects.pop(key)
    else:
        state.page_aspects[key] = aspect
    with pytest.raises(ValueError, match='measured source page aspect'):
        source_teaching_plan(args, sources, state)
    assert not state.pending and state.inspected_pages == {2}


def test_aspect_is_bound_to_the_exact_image_hash_and_page():
    state, sources, args, result = geometry_fixture()
    original_hash = args['image_sha256']
    other_hash = 'b' * 64
    registered = state.register_visual_regions(2, other_hash, REPORTED_REGIONS, document_id=state.document['id'])
    args['image_sha256'] = other_hash
    for step, item in zip(args['steps'], registered):
        step['region_id'] = item['id']
    with pytest.raises(ValueError, match='measured source page aspect'):
        source_teaching_plan(args, sources, state)
    assert (2, original_hash) in state.page_aspects

    state, sources, args, result = geometry_fixture()
    action = state.propose('read_selected_pdf_page', {'page': 3})
    state.acknowledge(read_receipt(action, image=result['_page_image']))
    state.select_view({'document_id': state.document['id'], 'page': 2, 'region': [0, 0, 1, 1], 'view_revision': 1})
    state.page_aspects.pop((2, args['image_sha256']))
    assert (3, args['image_sha256']) in state.page_aspects
    with pytest.raises(ValueError, match='measured source page aspect'):
        source_teaching_plan(args, sources, state)


@pytest.mark.parametrize('operation', ['revoke', 'offer'])
def test_removing_or_replacing_the_document_discards_measured_geometry(operation):
    state, _sources, _args, _result = geometry_fixture()
    assert state.page_aspects
    if operation == 'revoke':
        state.revoke()
    else:
        state.offer({**state.document, 'approved': True})
    assert not state.page_aspects


def test_invalid_source_image_cannot_register_aspect_from_reported_dimensions():
    state = offered()
    action = state.propose('read_selected_pdf_page', {'page': 2})
    bad_image = {'mime_type': 'image/jpeg', 'data': base64.b64encode(b'not an image').decode(), 'width': 1236, 'height': 1600}
    with pytest.raises(ValueError): state.acknowledge(read_receipt(action, image=bad_image))
    assert not state.page_aspects and not state.inspected_pages
