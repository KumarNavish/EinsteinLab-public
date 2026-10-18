import pytest
from lab_backend.page_vision import checked_observation


def observation(**changes):
    return {'summary': 'A source figure with a labelled circle.', 'visible_text': ['SOURCE LABEL'],
            'regions': [{'label': 'Circle', 'box': [.2, .3, .4, .2]}], 'uncertainty': '', **changes}


def test_crop_coordinates_are_mapped_back_to_original_page():
    value = checked_observation(observation(), [.1, .2, .5, .4])
    assert value['regions'][0]['region'] == [.2, .32, .2, .08]
    assert value['visible_text'] == ['SOURCE LABEL']


def test_complete_page_coordinates_are_preserved():
    value = checked_observation(observation(), [0, 0, 1, 1])
    assert value['regions'][0]['region'] == [.2, .3, .4, .2]


@pytest.mark.parametrize('box', [[0, 0, 0, 1], [-.1, 0, .2, .3], [0, 0, 2, 1], [0, False, .5, .4], [0, 0, float('nan'), 1]])
def test_invalid_inspector_coordinates_are_rejected(box):
    with pytest.raises(ValueError):
        checked_observation(observation(regions=[{'label': 'Bad box', 'box': box}]), [0, 0, 1, 1])


@pytest.mark.parametrize('changes', [{'summary': ''}, {'summary': 'x' * 1801}, {'uncertainty': None}, {'visible_text': ['x' * 251]}, {'regions': [{}]}, {'regions': [] * 1, 'visible_text': ['x'] * 25}])
def test_unbounded_or_malformed_observations_are_rejected(changes):
    with pytest.raises(ValueError): checked_observation(observation(**changes), [0, 0, 1, 1])
