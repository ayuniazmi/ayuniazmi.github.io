"""Aggregates QuestionResult objects into a markdown benchmark report."""
from datetime import datetime, timezone
from pathlib import Path

from src.evaluate import QuestionResult

REPORTS_DIR = Path(__file__).resolve().parent.parent / "reports"

CATEGORY_LABELS = {
    "success": "Success",
    "generation_failure": "Generation failure (good retrieval, unfaithful answer)",
    "retrieval_failure": "Retrieval failure (relevant section not retrieved)",
    "correct_abstention": "Correct abstention (unanswerable, model said so)",
    "hallucinated_on_unanswerable": "Hallucinated on unanswerable question",
}


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def build_report(results: list[QuestionResult], mode: str) -> str:
    answerable = [r for r in results if r.answerable]
    unanswerable = [r for r in results if not r.answerable]

    mrr = _mean([r.reciprocal_rank for r in answerable])
    precision_at_k = _mean([r.precision_at_k for r in answerable])
    recall = _mean([1.0 if r.hit else 0.0 for r in answerable])
    faithfulness = _mean([r.faithfulness_score for r in answerable if r.hit])
    abstention_accuracy = _mean([1.0 if r.category == "correct_abstention" else 0.0 for r in unanswerable])

    counts: dict[str, int] = {}
    for r in results:
        counts[r.category] = counts.get(r.category, 0) + 1

    lines = []
    lines.append(f"# RAG Evaluation Report ({mode} mode)")
    lines.append("")
    lines.append(f"Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} "
                 f"— {len(results)} questions ({len(answerable)} answerable, {len(unanswerable)} unanswerable).")
    if mode == "mock":
        lines.append("")
        lines.append("> **Mock mode**: embeddings are a deterministic bag-of-words hash, not a real "
                     "semantic model, and faithfulness is scored by word-overlap heuristic rather than "
                     "an LLM judge. This validates the pipeline end to end at zero cost; numbers here are "
                     "not representative of real embedding-model quality. Abstention accuracy in particular "
                     "is expected to be near zero in mock mode — the naive keyword-overlap trigger almost "
                     "always finds *some* shared word between an unanswerable question and a retrieved "
                     "chunk, unlike a real model asked to reason about whether the context actually answers "
                     "the question. Run with `--real` (requires `OPENAI_API_KEY`) for a meaningful benchmark.")
    lines.append("")

    lines.append("## Summary metrics")
    lines.append("")
    lines.append("| Metric | Value | Scope |")
    lines.append("|---|---|---|")
    lines.append(f"| MRR (retrieval) | {mrr:.2f} | Answerable questions |")
    lines.append(f"| Precision@{3} (retrieval) | {precision_at_k:.2f} | Answerable questions |")
    lines.append(f"| Recall (retrieval hit rate) | {recall:.2f} | Answerable questions |")
    lines.append(f"| Faithfulness (generation) | {faithfulness:.2f} | Answerable questions with a retrieval hit |")
    lines.append(f"| Abstention accuracy | {abstention_accuracy:.2f} | Unanswerable questions |")
    lines.append("")

    lines.append("## Error analysis breakdown")
    lines.append("")
    lines.append("| Category | Count |")
    lines.append("|---|---|")
    for key, label in CATEGORY_LABELS.items():
        lines.append(f"| {label} | {counts.get(key, 0)} |")
    lines.append("")

    failures = [r for r in results if r.category != "success" and r.category != "correct_abstention"]
    if failures:
        lines.append("## Notable failure cases")
        lines.append("")
        for r in failures:
            lines.append(f"### {r.id} — {CATEGORY_LABELS[r.category]}")
            lines.append(f"- **Question:** {r.question}")
            lines.append(f"- **Expected:** {r.expected_answer}")
            lines.append(f"- **Retrieved sections:** {', '.join(r.retrieved_sections) or '(none)'}"
                         f" — relevant: {', '.join(r.relevant_sections) or '(n/a)'}")
            lines.append(f"- **Generated answer:** {r.generated_answer}")
            lines.append(f"- **Faithfulness score:** {r.faithfulness_score:.2f}")
            lines.append("")

    lines.append("## Full results")
    lines.append("")
    lines.append("| ID | Question | Answerable | Hit | RR | Faithfulness | Category |")
    lines.append("|---|---|---|---|---|---|---|")
    for r in results:
        lines.append(
            f"| {r.id} | {r.question} | {r.answerable} | {r.hit} | {r.reciprocal_rank:.2f} | "
            f"{r.faithfulness_score:.2f} | {CATEGORY_LABELS[r.category]} |"
        )

    return "\n".join(lines) + "\n"


def write_report(results: list[QuestionResult], mode: str) -> Path:
    REPORTS_DIR.mkdir(exist_ok=True)
    report_text = build_report(results, mode)
    out_path = REPORTS_DIR / f"eval_report_{mode}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.md"
    out_path.write_text(report_text, encoding="utf-8")
    return out_path
