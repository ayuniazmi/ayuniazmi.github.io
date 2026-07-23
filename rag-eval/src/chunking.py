"""Splits the handbook markdown into overlapping word-window chunks, tagged with
the section they came from so retrieval quality can be scored against known-relevant sections.
"""
import re
from dataclasses import dataclass


@dataclass
class Chunk:
    chunk_id: str
    section: str
    text: str


def parse_sections(markdown_text: str) -> list[tuple[str, str]]:
    """Returns [(section_title, section_body), ...], skipping the H1 title and italic note."""
    parts = re.split(r"\n## ", markdown_text)
    sections = []
    for part in parts[1:]:  # part[0] is the H1 preamble
        title, _, body = part.partition("\n")
        sections.append((title.strip(), body.strip()))
    return sections


def chunk_text(text: str, chunk_size: int = 90, overlap: int = 20) -> list[str]:
    words = text.split()
    if not words:
        return []
    chunks = []
    start = 0
    step = max(1, chunk_size - overlap)
    while start < len(words):
        chunk_words = words[start:start + chunk_size]
        chunks.append(" ".join(chunk_words))
        if start + chunk_size >= len(words):
            break
        start += step
    return chunks


def build_chunks(markdown_path: str) -> list[Chunk]:
    with open(markdown_path, "r", encoding="utf-8") as f:
        text = f.read()

    chunks = []
    for section_title, section_body in parse_sections(text):
        for i, piece in enumerate(chunk_text(section_body)):
            chunks.append(Chunk(
                chunk_id=f"{section_title}::{i}",
                section=section_title,
                text=piece,
            ))
    return chunks
