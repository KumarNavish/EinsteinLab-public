"""Local ONNX relevance and textual-entailment diagnostics.

These classifiers are fallible filters, not a proof of factual correctness. They
operate on public source text and generated speech only; no remote API is called.
"""
from __future__ import annotations
import json
import re
import threading
from pathlib import Path
import numpy as np


class PairScorer:
    def __init__(self, directory: Path):
        import onnxruntime as ort
        from tokenizers import Tokenizer
        self.tokenizer = Tokenizer.from_file(str(directory / "tokenizer.json"))
        self.tokenizer.enable_truncation(max_length=384)
        self.tokenizer.enable_padding()
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(str(directory / "onnx/model_qint8_arm64.onnx"),
            sess_options=options, providers=["CPUExecutionProvider"])
        self.inputs = {item.name for item in self.session.get_inputs()}
        self.labels = {int(key): str(value).casefold() for key, value in
                       json.loads((directory / "config.json").read_text()).get("id2label", {}).items()}
        self.lock = threading.Lock()

    def score(self, pairs: list[tuple[str, str]]) -> np.ndarray:
        results = []
        with self.lock:
            for start in range(0, len(pairs), 8):
                rows = self.tokenizer.encode_batch(pairs[start:start + 8])
                feed = {"input_ids": np.array([row.ids for row in rows], dtype=np.int64),
                        "attention_mask": np.array([row.attention_mask for row in rows], dtype=np.int64),
                        "token_type_ids": np.array([row.type_ids for row in rows], dtype=np.int64)}
                output = self.session.run(None, {key: value for key, value in feed.items() if key in self.inputs})[0]
                results.append(output)
        return np.concatenate(results) if results else np.empty((0, 1))


class EntailmentGuard:
    def __init__(self, root: Path):
        self.scorer = PairScorer(root / ".local-models/entailment")
        matches = [index for index, label in self.scorer.labels.items() if label == "entailment"]
        if len(matches) != 1:
            raise ValueError("The selected NLI model does not expose an unambiguous entailment label")
        self.entailment_label = matches[0]

    def check(self, answer: str, sources: list[dict]) -> dict:
        sentences = [text.strip() for text in re.split(r"(?<!Dr\.)(?<=[.!?])\s+(?=[A-Z])", answer) if text.strip()]
        # Check each source passage separately so long unrelated premises cannot
        # truncate the actual support. Two adjacent passages are also considered.
        premises = [f"{source['title']}. {source.get('section', '')}: {source['excerpt']}" for source in sources]
        if len(premises) > 1:
            premises.append("\n".join(premises)[:2400])
        pairs = [(premise, sentence) for sentence in sentences for premise in premises]
        logits = self.scorer.score(pairs)
        shifted = logits - logits.max(axis=1, keepdims=True)
        probabilities = np.exp(shifted) / np.exp(shifted).sum(axis=1, keepdims=True)
        scores = probabilities[:, self.entailment_label].reshape(len(sentences), len(premises)).max(axis=1)
        return {"accepted": bool(len(scores) and np.all(scores >= .60)),
                "sentence_entailment": [round(float(value), 4) for value in scores],
                "threshold": .60, "limit": "Fallible NLI filter across actual source passages, not a semantic proof."}
