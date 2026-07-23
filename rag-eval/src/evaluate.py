"""Runs the fixed eval question set through retrieval + generation, scores both
stages, and buckets each question into an error-analysis category."""
import json
from dataclasses import dataclass, field
from pathlib import Path

from src.providers import EmbeddingProvider, LLMProvider

EVAL_QUESTIONS_PATH = Path(__file__).resolve().parent.parent / "data" / "eval_questions.json"
TOP_K = 3
FAITHFULNESS_PASS_THRESHOLD = 0.5
ABSTENTION_PHRASES = ["don't have information", "does not cover", "doesn't cover", "not covered", "no information"]


@dataclass
class QuestionResult:
    id: str
    question: str
    answerable: bool
    expected_answer: str
    retrieved_sections: list[str]
    relevant_sections: list[str]
    reciprocal_rank: float
    precision_at_k: float
    hit: bool
    generated_answer: str
    faithfulness_score: float
    category: str


def _looks_like_abstention(answer: str) -> bool:
    lower = answer.lower()
    return any(phrase in lower for phrase in ABSTENTION_PHRASES)


def _reciprocal_rank(retrieved_sections: list[str], relevant_sections: list[str]) -> float:
    for i, section in enumerate(retrieved_sections):
        if section in relevant_sections:
            return 1.0 / (i + 1)
    return 0.0


def _categorize(q: dict, hit: bool, faithfulness: float, answer: str) -> str:
    if not q["answerable"]:
        return "correct_abstention" if _looks_like_abstention(answer) else "hallucinated_on_unanswerable"
    if not hit:
        return "retrieval_failure"
    if faithfulness < FAITHFULNESS_PASS_THRESHOLD:
        return "generation_failure"
    return "success"


def run_evaluation(collection, embedder: EmbeddingProvider, llm: LLMProvider) -> list[QuestionResult]:
    with open(EVAL_QUESTIONS_PATH, "r", encoding="utf-8") as f:
        questions = json.load(f)

    results = []
    for q in questions:
        query_embedding = embedder.embed([q["question"]])[0]
        found = collection.query(query_embeddings=[query_embedding], n_results=TOP_K)

        retrieved_docs = found["documents"][0]
        retrieved_sections = [m["section"] for m in found["metadatas"][0]]

        relevant = q["relevant_sections"]
        hit = any(s in relevant for s in retrieved_sections) if relevant else False
        precision_at_k = (
            sum(1 for s in retrieved_sections if s in relevant) / TOP_K if relevant else 0.0
        )
        rr = _reciprocal_rank(retrieved_sections, relevant) if relevant else 0.0

        answer = llm.generate_answer(q["question"], retrieved_docs)
        faithfulness = llm.judge_faithfulness(q["question"], answer, q["expected_answer"])

        category = _categorize(q, hit, faithfulness, answer)

        results.append(QuestionResult(
            id=q["id"],
            question=q["question"],
            answerable=q["answerable"],
            expected_answer=q["expected_answer"],
            retrieved_sections=retrieved_sections,
            relevant_sections=relevant,
            reciprocal_rank=rr,
            precision_at_k=precision_at_k,
            hit=hit,
            generated_answer=answer,
            faithfulness_score=faithfulness,
            category=category,
        ))
    return results
