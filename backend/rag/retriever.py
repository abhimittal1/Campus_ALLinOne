"""
JIIT RAG Retriever
==================
Retrieves JIIT knowledge chunks from ChromaDB using the same local free
SentenceTransformers embedding model used by data/scraper/ingest.py.

The retriever is initialised lazily so importing this module does not fail at
startup when the vector store has not been created yet. If Chroma is not ready,
it falls back to a lightweight lexical search over the scraped JSON files.
"""

from __future__ import annotations

import json
import logging
import math
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path
from typing import Any

log = logging.getLogger("rag.retriever")

COLLECTION_NAME = "jiit_knowledge"
DEFAULT_EMBED_MODEL = "BAAI/bge-base-en-v1.5"
DEFAULT_N_RESULTS = 5
MIN_LEXICAL_SCORE = 1.0
BGE_QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: "

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
SCRAPED_JSON_CANDIDATES = (
    PROJECT_ROOT / "data" / "scraped" / "jiit_pages.json",
    PROJECT_ROOT / "data" / "scraped" / "test.json",
)

STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has",
    "have", "how", "i", "in", "is", "it", "its", "me", "of", "on", "or",
    "please", "tell", "the", "to", "was", "what", "when", "where", "which",
    "who", "with", "you", "your",
}


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


class JIITRetriever:
    """
    Retrieve relevant JIIT knowledge chunks for a query.

    Parameters
    ----------
    db_path:
        Absolute path to the ChromaDB persistence directory.
    embed_model_name:
        SentenceTransformers model name. Must match the model used at ingestion.
    """

    def __init__(
        self,
        db_path: str,
        embed_model_name: str = DEFAULT_EMBED_MODEL,
    ) -> None:
        self._db_path = db_path
        self._embed_model_name = embed_model_name
        self._chroma_collection: Any = None
        self._embedding_model: Any = None
        self._chroma_error: str | None = None
        self._scraped_chunks: list[dict] | None = None
        self._scraped_idf: dict[str, float] = {}

    # ------------------------------------------------------------------
    # Chroma + local embedding model
    # ------------------------------------------------------------------

    def _init(self) -> None:
        """Initialise Chroma and the local embedding model on first use."""
        if self._chroma_collection is not None and self._embedding_model is not None:
            return

        db_path = Path(self._db_path)
        if not db_path.exists():
            raise RuntimeError(
                f"ChromaDB directory not found: {db_path}\n"
                "Run ingestion first:\n"
                "  python data/scraper/ingest.py --input data/scraped/jiit_pages.json --reset"
            )

        try:
            import chromadb
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:
            raise RuntimeError(
                "chromadb and sentence-transformers must be installed: "
                "pip install chromadb sentence-transformers"
            ) from exc

        chroma_client = chromadb.PersistentClient(path=str(db_path))
        try:
            self._chroma_collection = chroma_client.get_collection(COLLECTION_NAME)
        except Exception as exc:
            raise RuntimeError(
                f"Collection '{COLLECTION_NAME}' not found in ChromaDB at {db_path}.\n"
                "Run the ingestion script to create it."
            ) from exc

        stored_model = (self._chroma_collection.metadata or {}).get("embedding_model")
        if self._chroma_collection.count() > 0 and not stored_model:
            raise RuntimeError(
                f"Collection '{COLLECTION_NAME}' has no embedding_model metadata. "
                "It may have been built with the old OpenAI embedding model. "
                "Re-run ingestion with --reset."
            )
        if stored_model and stored_model != self._embed_model_name:
            raise RuntimeError(
                f"Collection '{COLLECTION_NAME}' was built with embedding model "
                f"'{stored_model}', but the backend is configured for "
                f"'{self._embed_model_name}'. Re-run ingestion with --reset, or set "
                "RAG_EMBED_MODEL to the stored model."
            )

        self._embedding_model = SentenceTransformer(self._embed_model_name)
        log.info(
            "JIITRetriever ready - collection '%s' has %d documents using %s",
            COLLECTION_NAME,
            self._chroma_collection.count(),
            self._embed_model_name,
        )

    def _try_init_chroma(self) -> bool:
        """Best-effort Chroma initialisation; falls back to scraped JSON."""
        try:
            self._init()
            return self._chroma_collection is not None
        except Exception as exc:
            message = str(exc)
            if message != self._chroma_error:
                log.warning(
                    "Chroma retriever unavailable; falling back to scraped JSON: %s",
                    message,
                )
                self._chroma_error = message
            return False

    def _format_query_for_embedding(self, query: str) -> str:
        """Apply the recommended query prefix for BGE retrieval models."""
        model_name = self._embed_model_name.lower()
        if "bge-" in model_name or "/bge" in model_name:
            return f"{BGE_QUERY_INSTRUCTION}{query}"
        return query

    def _embed_query(self, query: str) -> list[float]:
        formatted_query = self._format_query_for_embedding(query)
        embedding = self._embedding_model.encode(
            formatted_query,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        return embedding.tolist()

    # ------------------------------------------------------------------
    # Local scraped-JSON fallback
    # ------------------------------------------------------------------

    def _load_scraped_chunks(self) -> list[dict]:
        """Load crawler JSON directly when Chroma has not been built yet."""
        if self._scraped_chunks is not None:
            return self._scraped_chunks

        source_path = next((p for p in SCRAPED_JSON_CANDIDATES if p.exists()), None)
        if source_path is None:
            self._scraped_chunks = []
            self._scraped_idf = {}
            return self._scraped_chunks

        try:
            with open(source_path, encoding="utf-8") as f:
                pages: list[dict] = json.load(f)
        except Exception as exc:
            log.warning("Could not load scraped RAG JSON at %s: %s", source_path, exc)
            self._scraped_chunks = []
            self._scraped_idf = {}
            return self._scraped_chunks

        chunks: list[dict] = []
        document_frequency: Counter[str] = Counter()

        for page in pages:
            url = page.get("url", "")
            title = page.get("title", "")
            for idx, section in enumerate(page.get("sections", [])):
                heading = section.get("heading", "")
                content_lines = section.get("content", [])
                parts = []
                if heading and heading != "Introduction":
                    parts.append(heading)
                parts.extend(content_lines)

                text = "\n".join(parts).strip()
                if len(text) < 30:
                    continue

                search_text = "\n".join([title, heading, text])
                tokens = set(_tokenize(search_text))
                document_frequency.update(tokens)
                chunks.append(
                    {
                        "id": f"{url}#sec{idx}",
                        "text": text,
                        "url": url,
                        "title": title,
                        "heading": heading,
                        "_tokens": tokens,
                        "_search_text": search_text.lower(),
                    }
                )

        total = max(1, len(chunks))
        self._scraped_idf = {
            token: math.log((1 + total) / (1 + freq)) + 1
            for token, freq in document_frequency.items()
        }
        self._scraped_chunks = chunks
        log.info("Loaded %d fallback RAG chunks from %s", len(chunks), source_path)
        return self._scraped_chunks

    def _retrieve_from_scraped_json(
        self,
        query: str,
        n_results: int = DEFAULT_N_RESULTS,
    ) -> list[dict]:
        chunks = self._load_scraped_chunks()
        if not chunks:
            return []

        query_tokens = [t for t in _tokenize(query) if t not in STOP_WORDS]
        if not query_tokens:
            query_tokens = _tokenize(query)
        if not query_tokens:
            return []

        query_set = set(query_tokens)
        scored: list[tuple[float, dict]] = []

        for chunk in chunks:
            tokens = chunk["_tokens"]
            matches = query_set & tokens
            if not matches:
                continue

            title_heading_tokens = set(_tokenize(f"{chunk['title']} {chunk['heading']}"))
            score = sum(self._scraped_idf.get(token, 1.0) for token in matches)

            for token in matches & title_heading_tokens:
                score += 1.5 * self._scraped_idf.get(token, 1.0)

            for left, right in zip(query_tokens, query_tokens[1:]):
                if f"{left} {right}" in chunk["_search_text"]:
                    score += 2.0

            if query_set.issubset(tokens):
                score += 3.0

            if score >= MIN_LEXICAL_SCORE:
                scored.append((score, chunk))

        scored.sort(key=lambda item: item[0], reverse=True)

        return [
            {
                "text": chunk["text"],
                "url": chunk["url"],
                "title": chunk["title"],
                "heading": chunk["heading"],
            }
            for _, chunk in scored[:n_results]
        ]

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def retrieve(self, query: str, n_results: int = DEFAULT_N_RESULTS) -> list[dict]:
        """Return relevant chunks with keys: text, url, title, heading."""
        if not query.strip():
            return []

        if self._try_init_chroma():
            try:
                results = self._chroma_collection.query(
                    query_embeddings=[self._embed_query(query)],
                    n_results=n_results,
                    include=["documents", "metadatas"],
                )

                chunks: list[dict] = []
                for doc, meta in zip(results["documents"][0], results["metadatas"][0]):
                    chunks.append(
                        {
                            "text": doc,
                            "url": meta.get("url", ""),
                            "title": meta.get("title", ""),
                            "heading": meta.get("heading", ""),
                        }
                    )
                if chunks:
                    return chunks
            except Exception as exc:
                log.warning("Chroma retrieval failed; using scraped JSON fallback: %s", exc)

        return self._retrieve_from_scraped_json(query, n_results=n_results)

    def is_ready(self) -> bool:
        """Return True if Chroma or the scraped-JSON fallback has documents."""
        if self._try_init_chroma():
            try:
                return self._chroma_collection.count() > 0
            except Exception:
                pass
        return bool(self._load_scraped_chunks())


@lru_cache(maxsize=1)
def get_retriever() -> JIITRetriever:
    """Return the singleton retriever."""
    from backend.core.config import settings

    return JIITRetriever(
        db_path=settings.CHROMA_DB_PATH,
    )
