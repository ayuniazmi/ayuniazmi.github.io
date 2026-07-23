#!/usr/bin/env python3
"""CLI entrypoint: ingest the handbook, run the eval question set, write a report.

Usage:
    python run_eval.py            # mock mode — no API key, no cost
    python run_eval.py --real     # real mode — requires OPENAI_API_KEY
"""
import argparse
import sys

from dotenv import load_dotenv

from src.evaluate import run_evaluation
from src.ingest import build_collection
from src.providers import get_providers
from src.report import write_report


def main():
    parser = argparse.ArgumentParser(description="Run the RAG evaluation framework.")
    parser.add_argument("--real", action="store_true", help="Use real OpenAI embeddings + generation instead of mock providers.")
    args = parser.parse_args()

    load_dotenv()
    mode = "real" if args.real else "mock"

    try:
        embedder, llm = get_providers(mode)
    except RuntimeError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"[{mode}] Ingesting handbook into Chroma...")
    collection, n_chunks = build_collection(embedder, mode)
    print(f"[{mode}] Indexed {n_chunks} chunks.")

    print(f"[{mode}] Running eval question set...")
    results = run_evaluation(collection, embedder, llm)

    report_path = write_report(results, mode)
    print(f"[{mode}] Report written to {report_path}")


if __name__ == "__main__":
    main()
