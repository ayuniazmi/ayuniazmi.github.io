"""Chunks the handbook and loads it into a persistent Chroma collection, with
embeddings supplied explicitly by our own EmbeddingProvider (mock or OpenAI) —
Chroma is used purely as the vector store, not for its own default embedder.
"""
import shutil
from pathlib import Path

import chromadb

from src.chunking import build_chunks
from src.providers import EmbeddingProvider

HANDBOOK_PATH = Path(__file__).resolve().parent.parent / "data" / "handbook.md"
CHROMA_DIR = Path(__file__).resolve().parent.parent / ".chroma"
COLLECTION_NAME = "handbook"


def build_collection(embedder: EmbeddingProvider, mode: str):
    chunks = build_chunks(str(HANDBOOK_PATH))

    persist_path = CHROMA_DIR / mode
    if persist_path.exists():
        shutil.rmtree(persist_path)
    persist_path.mkdir(parents=True, exist_ok=True)

    client = chromadb.PersistentClient(path=str(persist_path))
    collection = client.create_collection(name=COLLECTION_NAME)

    embeddings = embedder.embed([c.text for c in chunks])
    collection.add(
        ids=[c.chunk_id for c in chunks],
        embeddings=embeddings,
        documents=[c.text for c in chunks],
        metadatas=[{"section": c.section} for c in chunks],
    )
    return collection, len(chunks)
