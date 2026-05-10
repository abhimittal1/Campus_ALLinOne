"""
JIIT Website Crawler for RAG Pipeline
======================================
Performs a BFS crawl of https://www.jiit.ac.in/, discovers all reachable
internal pages, extracts structured text content from each, and saves the
result as a JSON file for downstream RAG ingestion.

Usage
-----
    python jiit_crawler.py                              # defaults
    python jiit_crawler.py --max-pages 50              # quick test
    python jiit_crawler.py --max-pages 300 --output ../scraped/jiit_pages.json

Output format (JSON array)
--------------------------
[
  {
    "url": "https://www.jiit.ac.in/about-jiit",
    "title": "Overview",
    "sections": [
      {
        "heading": "Introduction",
        "type": "intro",
        "content": ["JIIT, Noida was established in 2001 ..."]
      },
      {
        "heading": "Campus",
        "type": "h2",
        "content": ["JIIT has been developed as a modern world class campus ..."]
      }
    ]
  },
  ...
]
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import time
from collections import deque
from pathlib import Path
from urllib.parse import urljoin, urlparse, urlunparse

# Clear any environment-level CA bundle overrides set by third-party tools
# (e.g. PostgreSQL sets REQUESTS_CA_BUNDLE to its own path which may not exist).
# certifi is used explicitly instead.
os.environ.pop("REQUESTS_CA_BUNDLE", None)
os.environ.pop("CURL_CA_BUNDLE", None)

import certifi
import requests
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BASE_URL = "https://www.jiit.ac.in/"
ALLOWED_DOMAIN = "www.jiit.ac.in"

# Sub-domains / external roots to never crawl
BLOCKED_NETLOCS = {
    "webportal.jiit.ac.in",
    "old.jiit.ac.in",
    "webmail.jiit.ac.in",
    "getadmissions.com",
    "jbs.ac.in",
    "www.juet.ac.in",
    "juet.ac.in",
    "www.juit.ac.in",
    "juit.ac.in",
    "jaypeeu.ac.in",
    "www.jaypeeu.ac.in",
    "nad.digilocker.gov.in",
    "nad.gov.in",
    "ugc.gov.in",
    "www.ugc.gov.in",
    "api.whatsapp.com",
}

# URL path prefixes that produce noisy/irrelevant content for a RAG chatbot
BLOCKED_PATH_PREFIXES = (
    "/uploads/",   # images, PDFs served from /uploads
)

# File extensions to skip
BLOCKED_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx",
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico",
    ".zip", ".rar", ".tar", ".gz",
    ".mp4", ".mp3", ".avi", ".mov",
}

# Noise CSS selectors stripped before content extraction
NOISE_SELECTORS = [
    "nav",
    "header",
    "footer",
    ".footer",
    "#footer",
    ".navbar",
    ".w-nav",
    ".uui-footer",
    ".dropdown-content",
    "[class*='breadcrumb']",
    "[class*='announcement']",
    "[class*='ticker']",
    "script",
    "style",
    "noscript",
    ".social",
    "[class*='social']",
    "[class*='quick-link']",
    "[class*='quicklink']",
    "[id*='quick-link']",
    ".cookie",
    "[class*='cookie']",
    ".back-to-top",
    "[class*='back-to-top']",
]

REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

REQUEST_TIMEOUT = 20          # seconds per request
POLITENESS_DELAY = 0.5        # seconds between requests
INCREMENTAL_SAVE_EVERY = 50   # pages; saves partial results for crash safety

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("jiit_crawler")


# ---------------------------------------------------------------------------
# Crawler
# ---------------------------------------------------------------------------

class JIITCrawler:
    """BFS web crawler for www.jiit.ac.in."""

    def __init__(self, start_url: str = BASE_URL, max_pages: int = 300):
        self.start_url = self._normalize_url(start_url)
        self.max_pages = max_pages
        self.visited: set[str] = set()
        self.queue: deque[str] = deque([self.start_url])
        self.results: list[dict] = []
        self._session = requests.Session()
        self._session.headers.update(REQUEST_HEADERS)
        # Use certifi's CA bundle to avoid environment-level TLS misconfigurations
        self._session.verify = certifi.where()

    # ------------------------------------------------------------------
    # URL helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _normalize_url(url: str) -> str:
        """Strip fragment, normalize trailing slash, lowercase scheme+host."""
        parsed = urlparse(url)
        # Remove fragment
        normalized = parsed._replace(fragment="")
        # Lowercase scheme and netloc only
        normalized = normalized._replace(
            scheme=normalized.scheme.lower(),
            netloc=normalized.netloc.lower(),
        )
        # Rebuild and strip trailing slash from path (except root "/")
        result = urlunparse(normalized)
        if result.endswith("/") and result != parsed.scheme + "://" + parsed.netloc + "/":
            result = result.rstrip("/")
        return result

    def _is_crawlable(self, url: str) -> bool:
        """Return True if the URL should be added to the crawl queue."""
        try:
            parsed = urlparse(url)
        except Exception:
            return False

        # Must be http(s)
        if parsed.scheme not in ("http", "https"):
            return False

        netloc = parsed.netloc.lower()

        # Must be on the allowed domain
        if netloc != ALLOWED_DOMAIN:
            return False

        # Must not be a blocked sub-domain
        if netloc in BLOCKED_NETLOCS:
            return False

        path = parsed.path.lower()

        # Skip blocked path prefixes
        for prefix in BLOCKED_PATH_PREFIXES:
            if path.startswith(prefix):
                return False

        # Skip known binary / non-HTML extensions
        ext = os.path.splitext(path)[1].lower()
        if ext in BLOCKED_EXTENSIONS:
            return False

        return True

    # ------------------------------------------------------------------
    # Networking
    # ------------------------------------------------------------------

    def _fetch_page(self, url: str) -> tuple[str | None, str]:
        """
        Fetch a URL.  Returns (html_text, final_url) or (None, url) on error.
        final_url may differ from url after redirects.
        """
        try:
            response = self._session.get(url, timeout=REQUEST_TIMEOUT, allow_redirects=True)
            if response.status_code != 200:
                log.warning("HTTP %s for %s", response.status_code, url)
                return None, url
            # Only process HTML responses
            content_type = response.headers.get("Content-Type", "")
            if "text/html" not in content_type:
                log.debug("Non-HTML response (%s) at %s", content_type, url)
                return None, url
            return response.text, response.url
        except requests.exceptions.RequestException as exc:
            log.warning("Request failed for %s: %s", url, exc)
            return None, url

    # ------------------------------------------------------------------
    # Link extraction
    # ------------------------------------------------------------------

    def _extract_links(self, soup: BeautifulSoup, base_url: str) -> list[str]:
        """Return a deduplicated list of crawlable absolute URLs found on the page."""
        links = []
        seen_on_page: set[str] = set()

        for tag in soup.find_all("a", href=True):
            raw_href = tag["href"].strip()
            if not raw_href or raw_href.startswith(("javascript:", "mailto:", "tel:", "#")):
                continue

            abs_url = urljoin(base_url, raw_href)
            norm = self._normalize_url(abs_url)

            if norm in seen_on_page:
                continue
            seen_on_page.add(norm)

            if self._is_crawlable(norm):
                links.append(norm)

        return links

    # ------------------------------------------------------------------
    # Content extraction
    # ------------------------------------------------------------------

    @staticmethod
    def _strip_noise(soup: BeautifulSoup) -> None:
        """Remove navigation, footer, scripts, and other boilerplate in-place."""
        for selector in NOISE_SELECTORS:
            for el in soup.select(selector):
                el.decompose()

    @staticmethod
    def _extract_title(soup: BeautifulSoup) -> str:
        """Best-effort page title extraction."""
        tag = soup.find("title")
        if tag and tag.get_text(strip=True):
            raw = tag.get_text(strip=True)
            # JIIT pages often have "Page Name | JIIT" format
            return raw.split("|")[0].strip()

        h1 = soup.find("h1")
        if h1:
            return h1.get_text(strip=True)

        return ""

    def _extract_content(self, soup: BeautifulSoup, url: str) -> dict:
        """
        Return a structured page dict:
        {
            "url": str,
            "title": str,
            "sections": [{"heading": str, "type": str, "content": [str]}]
        }
        """
        title = self._extract_title(soup)
        self._strip_noise(soup)

        # Prefer <main>, fall back to <body>
        target = soup.find("main") or soup.find("body")
        if target is None:
            return {"url": url, "title": title, "sections": []}

        structured_data: list[dict] = []
        current_section: dict = {"heading": "Introduction", "type": "intro", "content": []}

        candidates = target.find_all(
            ["h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "div"]
        )

        for element in candidates:
            text = element.get_text(separator="\n", strip=True)
            if not text:
                continue

            if element.name and element.name.startswith("h"):
                # Save the previous section if it has content
                if current_section["content"] or current_section["heading"] != "Introduction":
                    structured_data.append(current_section)
                current_section = {
                    "heading": text.replace("\n", " "),
                    "type": element.name,
                    "content": [],
                }

            elif element.name == "p":
                if len(text) > 3:
                    current_section["content"].append(text)

            elif element.name in ("ul", "ol"):
                items = [
                    li.get_text(strip=True)
                    for li in element.find_all("li")
                    if li.get_text(strip=True)
                ]
                current_section["content"].extend(items)

            elif element.name == "div":
                # Only grab leaf divs (no block children) to avoid duplicates
                has_block_children = bool(
                    element.find(["p", "h1", "h2", "h3", "h4", "h5", "h6", "div", "ul", "ol"])
                )
                classes = element.get("class", [])
                is_subtitle = any("subtitle" in c for c in classes)

                if (not has_block_children or is_subtitle) and len(text) > 3:
                    current_section["content"].append(text)

        # Append final section
        if current_section["content"] or current_section["heading"] != "Introduction":
            structured_data.append(current_section)

        # De-duplicate consecutive identical content lines
        for section in structured_data:
            seen: set[str] = set()
            unique_content = []
            for item in section["content"]:
                if item not in seen:
                    seen.add(item)
                    unique_content.append(item)
            section["content"] = unique_content

        return {"url": url, "title": title, "sections": structured_data}

    # ------------------------------------------------------------------
    # Crawl loop
    # ------------------------------------------------------------------

    def crawl(self, output_path: str | None = None) -> list[dict]:
        """
        BFS crawl.  Optionally saves incrementally to output_path every
        INCREMENTAL_SAVE_EVERY pages (crash safety).
        """
        log.info("Starting crawl from %s (max_pages=%d)", self.start_url, self.max_pages)
        pages_crawled = 0

        while self.queue and pages_crawled < self.max_pages:
            url = self.queue.popleft()

            if url in self.visited:
                continue
            self.visited.add(url)

            log.info("[%d/%d] Fetching: %s", pages_crawled + 1, self.max_pages, url)
            html, final_url = self._fetch_page(url)

            # If redirected to a different URL, mark final URL visited too
            if final_url != url:
                norm_final = self._normalize_url(final_url)
                if norm_final in self.visited:
                    continue
                self.visited.add(norm_final)
                # Update url reference for link resolution
                url = norm_final

            if html is None:
                continue

            soup = BeautifulSoup(html, "lxml")

            # Discover links before content extraction. _extract_content strips
            # nav/header/footer in-place, and most JIIT authority/governance
            # pages are reachable from those menus.
            new_links = self._extract_links(soup, url)

            # Extract content
            page_data = self._extract_content(soup, url)

            # Only keep pages that have actual text content
            total_content = sum(len(s["content"]) for s in page_data["sections"])
            if total_content > 0:
                self.results.append(page_data)

            # Discover links for further crawling
            for link in new_links:
                if link not in self.visited:
                    self.queue.append(link)

            pages_crawled += 1

            # Incremental save
            if output_path and pages_crawled % INCREMENTAL_SAVE_EVERY == 0:
                self.save(output_path)
                log.info("Incremental save: %d pages written to %s", len(self.results), output_path)

            time.sleep(POLITENESS_DELAY)

        log.info(
            "Crawl complete. Visited %d URLs, saved %d pages with content.",
            len(self.visited),
            len(self.results),
        )
        return self.results

    # ------------------------------------------------------------------
    # Output
    # ------------------------------------------------------------------

    def save(self, output_path: str) -> None:
        """Write results to a JSON file, creating parent directories as needed."""
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.results, f, ensure_ascii=False, indent=2)
        log.info("Saved %d pages → %s", len(self.results), path.resolve())


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="BFS crawler for jiit.ac.in — outputs structured JSON for RAG ingestion."
    )
    parser.add_argument(
        "--start-url",
        default=BASE_URL,
        help=f"Seed URL (default: {BASE_URL})",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=300,
        help="Maximum number of pages to crawl (default: 300)",
    )
    parser.add_argument(
        "--output",
        default=str(Path(__file__).parent.parent / "scraped" / "jiit_pages.json"),
        help="Output JSON file path (default: ../scraped/jiit_pages.json)",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    crawler = JIITCrawler(start_url=args.start_url, max_pages=args.max_pages)
    crawler.crawl(output_path=args.output)
    crawler.save(args.output)
    log.info("Done. Output at: %s", Path(args.output).resolve())


if __name__ == "__main__":
    main()
