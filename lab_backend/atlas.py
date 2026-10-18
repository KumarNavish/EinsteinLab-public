"""Semantic source atlas alongside the preserved lexical baseline.

Paragraphs retain exact offsets into the downloaded public page. A small local
ONNX sentence encoder retrieves meaning without expanding queries into unrelated
lab themes. The generation context is bounded separately from source coverage.
"""
from __future__ import annotations
import hashlib
import json
import re
import threading
from pathlib import Path
from urllib.parse import parse_qs, urlparse
import numpy as np

HEADINGS = {"challenge", "approach", "our approach", "results", "outcomes", "expected results",
            "expected outcomes", "lead researcher", "lead researchers", "project status"}
EXPECTED = {"expected results", "expected outcomes"}


def fingerprint(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def blocks(page: dict) -> list[dict]:
    text = page["text"]
    matches = list(re.finditer(r"\S(?:.*?\S)?(?=\n\s*\n|\Z)", text, re.S))
    result = []
    section = "Description"
    for match in matches:
        value = match.group(0)
        if value.casefold() in HEADINGS:
            section = value
            continue
        # Some pages repeat a whole container and then each of its child paragraphs.
        nested = sum(1 for other in matches if other is not match and len(other.group(0)) > 90
                     and other.group(0) in value)
        if nested >= 2 and len(value) > 700:
            if value.startswith(("Approach ", "Our Approach ")):
                section = "Approach"
            continue
        if page["title"] == "About Us":
            anchor = text.find("\n\nAbout Us\n\n")
            if anchor >= 0 and match.start() < anchor:
                continue
        if len(value) < 3:
            continue
        # Keep names attached to their role and section, not orphaned by chunk limits.
        end = match.end()
        if len(value) < 75:
            index = matches.index(match)
            if index + 1 < len(matches):
                following = matches[index + 1]
                if following.group(0).casefold() not in HEADINGS:
                    end = following.end()
                    value = text[match.start():end]
        if len(value) > 1550:
            spans = list(re.finditer(r"[^.!?]+[.!?](?:\s|$)|[^.!?]+$", value))
            windows = []
            start = 0
            stop = 0
            for sentence in spans:
                if sentence.end() - start > 1300 and stop > start:
                    windows.append((start, stop))
                    start = sentence.start()
                stop = sentence.end()
            if stop > start:
                windows.append((start, stop))
            if not windows:
                windows = [(0, min(len(value), 1500))]
        else:
            windows = [(0, len(value))]
        for start, stop in windows:
            left = match.start() + start
            right = min(match.start() + stop, end)
            excerpt = text[left:right].strip()
            if len(excerpt) < 3:
                continue
            actual = text.find(excerpt, left, right + 1)
            result.append({"id": fingerprint(page["url"] + "\n" + excerpt)[:16],
                "url": page["url"], "title": page["title"], "excerpt": excerpt,
                "section": section, "epistemic": "anticipated" if section.casefold() in EXPECTED else "documented",
                "fetched_at": page.get("fetched_at"), "text_sha256": page.get("text_sha256"),
                "start": actual, "end": actual + len(excerpt)})
    return result


class SentenceEncoder:
    def __init__(self, directory: Path):
        from tokenizers import Tokenizer
        import onnxruntime as ort
        self.directory = directory
        self.tokenizer = Tokenizer.from_file(str(directory / "tokenizer.json"))
        self.tokenizer.enable_truncation(max_length=256)
        self.tokenizer.enable_padding()
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(str(directory / "onnx/model_qint8_arm64.onnx"),
            sess_options=options, providers=["CPUExecutionProvider"])
        self.inputs = {item.name for item in self.session.get_inputs()}
        self.lock = threading.Lock()

    def encode(self, texts: list[str]) -> np.ndarray:
        rows = []
        with self.lock:
            for start in range(0, len(texts), 16):
                encoded = self.tokenizer.encode_batch(texts[start:start + 16])
                feed = {"input_ids": np.array([e.ids for e in encoded], dtype=np.int64),
                        "attention_mask": np.array([e.attention_mask for e in encoded], dtype=np.int64),
                        "token_type_ids": np.array([e.type_ids for e in encoded], dtype=np.int64)}
                output = self.session.run(None, {key: value for key, value in feed.items() if key in self.inputs})[0]
                if output.ndim == 3:
                    mask = feed["attention_mask"][..., None]
                    pooled = (output * mask).sum(1) / np.maximum(mask.sum(1), 1)
                else:
                    pooled = output
                pooled = pooled.astype(np.float32)
                rows.append(pooled / np.maximum(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-8))
        return np.concatenate(rows) if rows else np.empty((0, 384), dtype=np.float32)


class Atlas:
    def __init__(self, snapshot: dict, root: Path):
        self.snapshot = snapshot
        self.root = root
        self.pages = snapshot["pages"]
        self.chunks = []
        self.page_chunks = []
        for page in self.pages:
            first = len(self.chunks)
            self.chunks.extend(blocks(page))
            self.page_chunks.append(list(range(first, len(self.chunks))))
        if not self.chunks:
            raise ValueError("No public source passages in the snapshot")
        self.encoder = SentenceEncoder(root / ".local-models/minilm")
        index_text = [f"{block['title']}. {block['section']}. {block['excerpt']}" for block in self.chunks]
        signature = fingerprint(json.dumps(index_text, ensure_ascii=False) + "minilm-L6-v2-arm64-v1")
        cache = root / "lab_backend/data" / ("semantic-" + signature[:16] + ".npz")
        if cache.is_file():
            stored = np.load(cache, allow_pickle=False)
            self.vectors, self.title_vectors = stored["passages"], stored["titles"]
            if len(self.vectors) != len(self.chunks):
                raise ValueError("Semantic cache does not match source manifest")
        else:
            self.vectors = self.encoder.encode(index_text)
            self.title_vectors = self.encoder.encode([page["title"] for page in self.pages])
            cache.parent.mkdir(parents=True, exist_ok=True)
            temporary = cache.with_suffix(".next.npz")
            np.savez_compressed(temporary, passages=self.vectors, titles=self.title_vectors)
            temporary.replace(cache)
        self.signature = signature
        from .pair_scoring import PairScorer
        self.reranker = PairScorer(root / ".local-models/reranker")

    @classmethod
    def load(cls, path: Path, root: Path | None = None):
        return cls(json.loads(path.read_text()), root or path.resolve().parents[2])

    def search(self, question: str, previous: str = "", k: int = 4) -> list[dict]:
        q = question.strip()
        if not q:
            return []
        # Explicitly unavailable information is not inferred from semantic similarity.
        if re.search(r"\b(unpublished|confidential|payroll|p.value|password|api key|weather|lottery)\b", q, re.I):
            return []
        if re.search(r"einstein.*(?:personally|historically).*endors", q, re.I):
            return []
        followup = bool(previous and re.search(r"\b(that|this|its|it|those|simpler|more simply|who leads|limitations|already been|what about)\b", q, re.I))
        effective = previous + "\nFollow-up: " + q if followup else q
        vector = self.encoder.encode([effective])[0]
        similarity = self.vectors @ vector
        title_similarity = self.title_vectors @ vector
        who = bool(re.search(r"\b(who|researcher|responsible|leads?)\b", q, re.I))
        status = bool(re.search(r"\b(status|ongoing|completed|concluded)\b", q, re.I))
        result_intent = bool(re.search(r"\b(results?|find|found|finding|discover|demonstrat|outcome|prove|learn|report)\w*", q, re.I))
        mission = bool(re.search(r"\b(mission|trying to achieve|introduc\w*.*lab|lab.*introduc\w*|lab actually|lab all about|what connects.*lab|what unites.*lab|work.*across.*lab)\b", q, re.I))
        team = bool(re.search(r"\b(scientific director|lab director|who is|team members|staff)\b", q, re.I))
        newest = bool(re.search(r"\b(latest|newest|recent|news)\b", q, re.I))
        scores = []
        def substantive(index):
            item = self.chunks[index]
            return len(item["excerpt"]) >= 75 and item["section"].casefold() not in ("lead researcher", "lead researchers", "project status") and not item["excerpt"].lower().startswith(("click here", "read more", "download "))
        for number, page in enumerate(self.pages):
            indexes = self.page_chunks[number]
            if not indexes:
                continue
            informative = [i for i in indexes if substantive(i)] or indexes
            best = max(float(similarity[i]) for i in informative)
            score = .7 * best + .3 * float(title_similarity[number])
            project = "research-proj-posts=" in page["url"]
            if project:
                score += .07
            if "?p=" in page["url"] and not newest:
                score -= .035
            if page["title"] in ("Research", "Further Research", "Publications") and not newest:
                score -= .06
            if mission and page["url"].rstrip("/") in ("https://mobililab.ethz.ch", "https://mobiliarlab.ethz.ch"):
                score += .5
            if team and page["title"] == "About Us":
                score += .25
            scores.append((score, best, number))
        scores.sort(reverse=True)
        # Ordinary questions about the lab use canonical project/team pages rather
        # than historic recruitment posts or promotional news. Explicit news and
        # publication requests retain access to the complete snapshot.
        broad_archive = newest or bool(re.search(r"\b(publication|paper|article|conference|workshop|news|vacanc|job|recruit)\w*", q, re.I))
        if not broad_archive:
            canonical = [row for row in scores if "research-proj-posts=" in self.pages[row[2]]["url"]
                         or self.pages[row[2]]["title"] == "About Us"
                         or self.pages[row[2]]["url"].rstrip("/") in ("https://mobililab.ethz.ch", "https://mobiliarlab.ethz.ch")]
            if canonical:
                scores = canonical
        candidates = scores[:10]
        documents = []
        for score, best, number in candidates:
            available = [i for i in self.page_chunks[number] if substantive(i)] or self.page_chunks[number]
            indexes = sorted(available, key=lambda i: float(similarity[i]), reverse=True)[:2]
            # A project overview needs both the problem and what is being studied.
            overview = [i for i in available if self.chunks[i]["section"].casefold() in ("challenge", "approach", "our approach")]
            ordered = list(dict.fromkeys(overview[:2] + indexes)) if "research-proj-posts=" in self.pages[number]["url"] else indexes
            documents.append(self.pages[number]["title"] + ". " + " ".join(self.chunks[i]["excerpt"] for i in ordered)[:1800])
        relevance = self.reranker.score([(effective, document) for document in documents]).reshape(-1)
        scores = [(score + .025 * float(rank), best, number) for (score, best, number), rank in zip(candidates, relevance)]
        scores.sort(reverse=True)
        if not scores or scores[0][1] < .30:
            return []
        picked = []
        best_page = scores[0][0]
        comparison = bool(re.search(r"\b(compare|connect|versus|vs|relationship|different|between)\b", q, re.I))
        pages_allowed = 2 if comparison else 1
        page_count = 0
        for page_score, best, number in scores:
            if page_count >= pages_allowed or page_score < best_page - .20:
                break
            indexes = self.page_chunks[number]
            ordered = []
            for i in indexes:
                item = self.chunks[i]
                if not who and not status and not substantive(i):
                    continue
                score = float(similarity[i])
                heading = item["section"].casefold()
                if who and heading in ("lead researcher", "lead researchers"):
                    score += .5
                elif status and heading == "project status":
                    score += .5
                elif result_intent and heading in ("results", "outcomes", "expected results", "expected outcomes"):
                    score += .38
                elif not who and not status and heading in ("approach", "our approach"):
                    score += .09
                ordered.append((score, i))
            ordered.sort(reverse=True)
            budget = 2 if comparison else min(3, k)
            for score, index in ordered[:budget]:
                item = dict(self.chunks[index])
                item.update(score=round(score, 4), page_score=round(page_score, 4), retriever="semantic-atlas")
                picked.append(item)
            page_count += 1
        return picked[:k]

    def projects(self) -> list[dict]:
        return [{"title": page["title"], "url": page["url"], "fetched_at": page.get("fetched_at")}
                for page in self.pages if "research-proj-posts=" in page["url"]]
