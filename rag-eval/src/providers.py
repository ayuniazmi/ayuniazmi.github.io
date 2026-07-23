"""Embedding/LLM providers behind a common interface, so the eval pipeline can run
in --mock mode (no API key, deterministic, free) or --real mode (actual OpenAI calls)
without changing any pipeline code.
"""
import hashlib
import math
import os
import re
from abc import ABC, abstractmethod

MOCK_DIM = 256


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def _hash_index(word: str, dim: int) -> int:
    digest = hashlib.md5(word.encode("utf-8")).hexdigest()
    return int(digest, 16) % dim


def _mock_embed(text: str, dim: int = MOCK_DIM) -> list[float]:
    """Deterministic bag-of-words hashing embedding. Not a real semantic embedding —
    it only captures shared-vocabulary similarity — but it is enough to exercise the
    retrieval pipeline end to end without any API calls or cost.
    """
    vec = [0.0] * dim
    for word in _tokenize(text):
        vec[_hash_index(word, dim)] += 1.0
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


class EmbeddingProvider(ABC):
    @abstractmethod
    def embed(self, texts: list[str]) -> list[list[float]]: ...


class LLMProvider(ABC):
    @abstractmethod
    def generate_answer(self, question: str, context_chunks: list[str]) -> str: ...

    @abstractmethod
    def judge_faithfulness(self, question: str, answer: str, expected_answer: str) -> float:
        """Returns a 0-1 faithfulness/correctness score."""
        ...


class MockEmbeddingProvider(EmbeddingProvider):
    def embed(self, texts: list[str]) -> list[list[float]]:
        return [_mock_embed(t) for t in texts]


class MockLLMProvider(LLMProvider):
    ABSTAIN_MSG = "I don't have information about that in the student handbook."
    MIN_OVERLAP_TO_ANSWER = 2

    def generate_answer(self, question: str, context_chunks: list[str]) -> str:
        if not context_chunks:
            return self.ABSTAIN_MSG

        q_words = set(_tokenize(question))
        best_sentence, best_score = "", -1
        for chunk in context_chunks:
            for sentence in re.split(r"(?<=[.!?])\s+", chunk):
                overlap = len(q_words & set(_tokenize(sentence)))
                if overlap > best_score:
                    best_sentence, best_score = sentence.strip(), overlap

        if best_score < self.MIN_OVERLAP_TO_ANSWER:
            return self.ABSTAIN_MSG
        return f"Based on the handbook: {best_sentence}"

    def judge_faithfulness(self, question: str, answer: str, expected_answer: str) -> float:
        """Heuristic stand-in for an LLM-as-judge call: word-overlap F1 between the
        generated answer and the reference answer. In --real mode this is replaced
        by an actual model call that reasons about faithfulness, not just overlap.
        """
        answer_words = set(_tokenize(answer))
        expected_words = set(_tokenize(expected_answer))
        if not answer_words or not expected_words:
            return 0.0
        overlap = len(answer_words & expected_words)
        precision = overlap / len(answer_words)
        recall = overlap / len(expected_words)
        if precision + recall == 0:
            return 0.0
        return 2 * precision * recall / (precision + recall)


class OpenAIEmbeddingProvider(EmbeddingProvider):
    def __init__(self, model: str = "text-embedding-3-small"):
        from openai import OpenAI
        self.client = OpenAI()
        self.model = model

    def embed(self, texts: list[str]) -> list[list[float]]:
        resp = self.client.embeddings.create(model=self.model, input=texts)
        return [d.embedding for d in resp.data]


class OpenAILLMProvider(LLMProvider):
    def __init__(self, model: str = "gpt-4o-mini"):
        from openai import OpenAI
        self.client = OpenAI()
        self.model = model

    def generate_answer(self, question: str, context_chunks: list[str]) -> str:
        context = "\n\n".join(context_chunks)
        prompt = (
            "Answer the question using ONLY the context below. If the context does not "
            "contain the answer, say so explicitly rather than guessing.\n\n"
            f"Context:\n{context}\n\nQuestion: {question}"
        )
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
        )
        return resp.choices[0].message.content.strip()

    def judge_faithfulness(self, question: str, answer: str, expected_answer: str) -> float:
        prompt = (
            "Score how faithful and correct the CANDIDATE answer is compared to the "
            "REFERENCE answer, on a 0.0-1.0 scale. Reply with only the number.\n\n"
            f"Question: {question}\nReference answer: {expected_answer}\nCandidate answer: {answer}"
        )
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
        )
        try:
            return max(0.0, min(1.0, float(resp.choices[0].message.content.strip())))
        except ValueError:
            return 0.0


def get_providers(mode: str) -> tuple[EmbeddingProvider, LLMProvider]:
    if mode == "real":
        if not os.environ.get("OPENAI_API_KEY"):
            raise RuntimeError("OPENAI_API_KEY is not set — cannot run in --real mode.")
        return OpenAIEmbeddingProvider(), OpenAILLMProvider()
    return MockEmbeddingProvider(), MockLLMProvider()
