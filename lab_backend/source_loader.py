"""Start from the bundled lexical implementation when optional source models are absent.

This never downloads or substitutes a model silently. The selected backend and
its limitation are exposed in health metadata. Invalid present model files still
raise rather than masquerading as a healthy semantic index.
"""
from pathlib import Path
from .knowledge import Knowledge


REQUIRED_SEMANTIC_FILES = (
    'minilm/tokenizer.json', 'minilm/onnx/model_qint8_arm64.onnx',
    'reranker/tokenizer.json', 'reranker/config.json', 'reranker/onnx/model_qint8_arm64.onnx',
)


def load_sources(root: Path):
    snapshot = root / 'lab_backend/data/lab.json'
    missing = [name for name in REQUIRED_SEMANTIC_FILES if not (root / '.local-models' / name).is_file()]
    if missing:
        index = Knowledge.load(snapshot)
        return index, {'kind': 'lexical', 'optional_semantic_models_ready': False,
                       'reason': 'Optional local semantic/reranking files are absent. Native named-project evidence lookup remains available.',
                       'missing_files': missing}
    from .atlas import Atlas
    return Atlas.load(snapshot, root), {'kind': 'semantic-plus-reranker', 'optional_semantic_models_ready': True,
                                       'reason': None, 'missing_files': []}
