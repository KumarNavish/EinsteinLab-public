import json
from lab_backend.source_loader import load_sources


def test_missing_optional_encoder_does_not_break_native_service_startup(tmp_path):
    directory = tmp_path / 'lab_backend/data'; directory.mkdir(parents=True)
    (directory / 'lab.json').write_text(json.dumps({'pages': [{'url': 'https://mobililab.ethz.ch/?research-proj-posts=genai-in-vr', 'title': 'GenAI in VR', 'text': 'The project creates virtual reality scenes from verbal descriptions.'}]}))
    knowledge, metadata = load_sources(tmp_path)
    assert metadata['kind'] == 'lexical'
    assert metadata['missing_files']
    assert metadata['optional_semantic_models_ready'] is False
    assert knowledge.search('GenAI VR')
    assert not (tmp_path / '.local-models').exists()
