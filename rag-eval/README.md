# Project 02 — RAG Evaluation Framework v2

A production-grade rebuild of the Student Handbook RAG project: not another "ask your
documents a question" demo, but a framework for **measuring whether a RAG pipeline is
actually any good** — retrieval quality, answer faithfulness, and failure modes,
scored against a fixed question set instead of eyeballed from a few manual queries.

## Why this exists

Most RAG demos stop at "it answers questions." The harder, more useful skill is knowing
*how well* it answers, *where* it breaks, and whether it knows what it doesn't know.
This framework scores three things a real deployment needs to get right:

1. **Retrieval quality** — does the pipeline find the right source material at all?
2. **Answer faithfulness** — given the right material, does it produce a correct answer?
3. **Abstention behavior** — when the answer isn't in the corpus, does it say so, or
   does it hallucinate? This is arguably the most important failure mode in production
   RAG, and the one most demos never test.

## Architecture

```
data/handbook.md ──▶ chunking.py ──▶ providers.py (embed) ──▶ ingest.py ──▶ Chroma
                                                                                │
data/eval_questions.json ──────────────────────────────────────▶ evaluate.py ◀┘
                                                                       │
                                                                       ▼
                                                              providers.py (generate + judge)
                                                                       │
                                                                       ▼
                                                                  report.py ──▶ reports/*.md
```

- **Corpus**: `data/handbook.md` — a fictional "Meridian University" student handbook,
  written from scratch as a stand-in (no real institution's document is used or needed).
- **Chunking**: `src/chunking.py` splits by section, then into overlapping ~90-word
  windows, tagging each chunk with its source section for retrieval scoring.
- **Vector store**: Chroma (`chromadb`), persisted locally to `.chroma/<mode>/`.
- **Providers**: `src/providers.py` defines an `EmbeddingProvider` / `LLMProvider`
  interface with two implementations each — `Mock*` (deterministic, free, no API key)
  and `OpenAI*` (real embeddings + `gpt-4o-mini` generation and judging). The rest of
  the pipeline is provider-agnostic; swapping mock for real doesn't touch any other file.
- **Eval set**: `data/eval_questions.json` — 15 fixed questions: 12 answerable (covering
  all 8 handbook sections) and 3 deliberately **unanswerable** (not covered anywhere in
  the handbook), to test abstention rather than just retrieval.

## Metrics

| Metric | What it measures |
|---|---|
| MRR | How high up the correct section ranks in retrieval results |
| Precision@3 | What fraction of the top-3 retrieved chunks are actually relevant |
| Recall (hit rate) | Whether the relevant section was retrieved at all |
| Faithfulness | Whether the generated answer matches the reference answer |
| Abstention accuracy | On unanswerable questions, whether the model correctly said so instead of hallucinating |

Every question is also bucketed into one error-analysis category — `success`,
`retrieval_failure`, `generation_failure` (good retrieval, bad answer — i.e. the
generator is the weak link, not the retriever), `correct_abstention`, or
`hallucinated_on_unanswerable` — because an aggregate score alone doesn't tell you
*where* a pipeline needs work.

## Running it

```bash
cd rag-eval
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python run_eval.py            # mock mode: no API key, no cost, validates the pipeline
python run_eval.py --real     # real mode: requires OPENAI_API_KEY (see .env.example)
```

Each run writes a timestamped report to `reports/`.

## Honest limitations of this v1

- **Mock mode is a pipeline test, not a benchmark.** Its embeddings are a deterministic
  bag-of-words hash (shared-vocabulary similarity only) and its "faithfulness judge" is
  a word-overlap heuristic, not a model reasoning about correctness. A committed sample
  report (`reports/`) shows the pipeline runs end to end; the numbers in it aren't a
  claim about real embedding-model quality.
- **The corpus is synthetic and small** (8 sections, 16 chunks) — enough to exercise
  every part of the pipeline, not enough to stress-test retrieval at scale.
- **Real mode hasn't been run yet** — it requires an `OPENAI_API_KEY` and hasn't been
  executed against actual billing. The code path is written and provider-swappable, but
  "runs against real embeddings" and "has been run against real embeddings" are
  different claims; only the former is true right now.

## What's next

- Run `--real` mode once an API key is attached, and commit that report alongside the
  mock one for a real vs. mock quality comparison.
- Add a second embedding model (e.g. a local open-weights model) as a third provider to
  compare cost/quality tradeoffs — the same kind of tradeoff reasoning as Project 01,
  applied to model selection instead of infrastructure.
