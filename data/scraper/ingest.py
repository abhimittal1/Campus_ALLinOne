"""
JIIT RAG Ingestion Script
=========================
Reads the structured JSON produced by jiit_crawler.py, splits each page
section into an embeddable chunk, embeds it with a local free model, and
upserts everything into a persisted ChromaDB collection.

Run this once, or after re-crawling, to build or refresh the vector store.

Usage
-----
    python ingest.py
    python ingest.py --input ../scraped/jiit_pages.json
    python ingest.py --input ../scraped/jiit_pages.json --db-path ../vector_store/chroma_db
    python ingest.py --reset

Requirements
------------
    pip install chromadb sentence-transformers

The default embedding model is BAAI/bge-base-en-v1.5. It is free/open and is
downloaded from Hugging Face the first time you run ingestion.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

# Allow running from the data/scraper/ directory directly.
ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

# Clear broken env-level CA overrides, if any.
os.environ.pop("REQUESTS_CA_BUNDLE", None)
os.environ.pop("CURL_CA_BUNDLE", None)

# Load optional RAG_EMBED_MODEL from the project root .env.
try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    pass

import chromadb
from sentence_transformers import SentenceTransformer

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

DEFAULT_INPUT = str(Path(__file__).parent.parent / "scraped" / "jiit_pages.json")
DEFAULT_DB_PATH = str(Path(__file__).parent.parent / "vector_store" / "chroma_db")
COLLECTION_NAME = "jiit_knowledge"
DEFAULT_EMBED_MODEL = "BAAI/bge-base-en-v1.5"
EMBED_BATCH_SIZE = 64
MIN_CHUNK_CHARS = 30

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("ingest")


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------

def build_chunks(pages: list[dict]) -> list[dict]:
    """
    Convert crawler JSON into flat embeddable chunks.

    Each chunk has:
      id, text, url, title, heading
    """
    chunks: list[dict] = []

    for page in pages:
        url = page.get("url", "")
        title = page.get("title", "")
        sections = page.get("sections", [])

        for idx, section in enumerate(sections):
            heading = section.get("heading", "")
            content_lines = section.get("content", [])

            parts = []
            if heading and heading != "Introduction":
                parts.append(heading)
            parts.extend(content_lines)

            text = "\n".join(parts).strip()
            if len(text) < MIN_CHUNK_CHARS:
                continue

            chunks.append(
                {
                    "id": f"{url}#sec{idx}",
                    "text": text,
                    "url": url,
                    "title": title,
                    "heading": heading,
                }
            )

    log.info("Built %d chunks from %d pages", len(chunks), len(pages))
    return chunks


# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------

def embed_texts(model: SentenceTransformer, texts: list[str]) -> list[list[float]]:
    """Embed texts in batches, returning plain Python lists for ChromaDB."""
    all_embeddings: list[list[float]] = []

    for i in range(0, len(texts), EMBED_BATCH_SIZE):
        batch = texts[i : i + EMBED_BATCH_SIZE]
        log.info(
            "Embedding batch %d-%d / %d ...",
            i + 1,
            min(i + EMBED_BATCH_SIZE, len(texts)),
            len(texts),
        )
        batch_embeddings = model.encode(
            batch,
            batch_size=EMBED_BATCH_SIZE,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        all_embeddings.extend(batch_embeddings.tolist())

    return all_embeddings


# ---------------------------------------------------------------------------
# ChromaDB upsert
# ---------------------------------------------------------------------------

def upsert_to_chroma(
    db_path: str,
    chunks: list[dict],
    embeddings: list[list[float]],
    embed_model_name: str,
    reset: bool = False,
) -> None:
    """Create/open the collection and upsert all chunks."""
    client = chromadb.PersistentClient(path=db_path)

    if reset:
        try:
            client.delete_collection(COLLECTION_NAME)
            log.info("Deleted existing ChromaDB collection '%s'", COLLECTION_NAME)
        except Exception:
            pass

    collection = client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine", "embedding_model": embed_model_name},
    )

    ids = [c["id"] for c in chunks]
    documents = [c["text"] for c in chunks]
    metadatas = [
        {"url": c["url"], "title": c["title"], "heading": c["heading"]}
        for c in chunks
    ]

    batch_size = 500
    for i in range(0, len(chunks), batch_size):
        collection.upsert(
            ids=ids[i : i + batch_size],
            embeddings=embeddings[i : i + batch_size],
            documents=documents[i : i + batch_size],
            metadatas=metadatas[i : i + batch_size],
        )
        log.info(
            "Upserted %d / %d chunks into ChromaDB",
            min(i + batch_size, len(chunks)),
            len(chunks),
        )

    log.info(
        "Collection '%s' now has %d documents",
        COLLECTION_NAME,
        collection.count(),
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ingest JIIT crawler JSON into ChromaDB for RAG retrieval."
    )
    parser.add_argument(
        "--input",
        default=DEFAULT_INPUT,
        help=f"Path to the crawler JSON file (default: {DEFAULT_INPUT})",
    )
    parser.add_argument(
        "--db-path",
        default=DEFAULT_DB_PATH,
        help=f"ChromaDB persistence directory (default: {DEFAULT_DB_PATH})",
    )
    parser.add_argument(
        "--embed-model",
        default=os.environ.get("RAG_EMBED_MODEL", DEFAULT_EMBED_MODEL),
        help=f"SentenceTransformers model name (default: {DEFAULT_EMBED_MODEL})",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Delete the existing Chroma collection before ingesting.",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        log.error("Input file not found: %s", input_path)
        log.error(
            "Run the crawler first: python data/scraper/jiit_crawler.py "
            "--output data/scraped/jiit_pages.json"
        )
        sys.exit(1)

    log.info("Loading %s ...", input_path)
    with open(input_path, encoding="utf-8") as f:
        pages: list[dict] = json.load(f)
    log.info("Loaded %d pages", len(pages))

    chunks = build_chunks(pages)
    if not chunks:
        log.error("No chunks produced; check that the JSON has non-empty sections.")
        sys.exit(1)

    log.info("Loading embedding model: %s", args.embed_model)
    embedding_model = SentenceTransformer(args.embed_model)
    embeddings = embed_texts(embedding_model, [c["text"] for c in chunks])

    db_path = str(Path(args.db_path).resolve())
    Path(db_path).mkdir(parents=True, exist_ok=True)
    upsert_to_chroma(
        db_path,
        chunks,
        embeddings,
        embed_model_name=args.embed_model,
        reset=args.reset,
    )

    log.info("Ingestion complete. Vector store at: %s", db_path)


if __name__ == "__main__":
    main()
