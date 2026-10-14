"""Structural web crawler and link/form extraction engine.

Implements an asynchronous, bounded web crawler utilizing httpx and the standard
library HTML parser. Enforces rate limits, concurrency semaphores, max depth,
and scope containment (in_scope and out_of_scope).
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Sequence
from urllib.parse import urldefrag, urljoin, urlparse

import httpx

from arsenal.scope import matches_selector

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class FormInput:
    name: str
    input_type: str = "text"
    value: str | None = None


@dataclass(slots=True)
class FormInfo:
    action: str
    method: str
    inputs: list[FormInput] = field(default_factory=list)


@dataclass(slots=True)
class CrawlResult:
    target: str
    endpoints_discovered: int
    unique_urls: list[str]
    forms: list[dict[str, object]]
    redirects: list[dict[str, str]]
    soft_404s: list[str]
    status_codes: dict[str, int]
    errors: list[str]
    duration_ms: int


class LinkAndFormParser(HTMLParser):
    """HTML parser that structurally extracts hyperlinks, resource URLs, and forms."""

    def __init__(self, base_url: str) -> None:
        super().__init__()
        self.base_url = base_url
        self.extracted_urls: set[str] = set()
        self.forms: list[FormInfo] = []
        self._current_form: FormInfo | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_dict = {k.lower(): v for k, v in attrs if v is not None}

        # 1. Links & Navigation
        if tag in ("a", "link", "area") and "href" in attr_dict:
            self._add_url(attr_dict["href"])

        # 2. Scripts & Media Sources
        elif tag in ("script", "iframe", "embed", "source") and "src" in attr_dict:
            self._add_url(attr_dict["src"])

        # 3. Form Begin
        elif tag == "form":
            action = attr_dict.get("action", "")
            method = attr_dict.get("method", "GET").upper()
            resolved_action = self._resolve_url(action)
            self._current_form = FormInfo(action=resolved_action, method=method, inputs=[])

        # 4. Form Inputs
        elif self._current_form is not None:
            if tag in ("input", "textarea", "select"):
                name = attr_dict.get("name")
                if name:
                    inp_type = attr_dict.get("type", "text").lower()
                    val = attr_dict.get("value")
                    self._current_form.inputs.append(FormInput(name=name, input_type=inp_type, value=val))

    def handle_endtag(self, tag: str) -> None:
        if tag == "form" and self._current_form is not None:
            self.forms.append(self._current_form)
            self._current_form = None

    def _resolve_url(self, raw_url: str) -> str:
        stripped = raw_url.strip()
        if not stripped or stripped.startswith(("#", "javascript:", "mailto:", "tel:", "data:")):
            return ""
        resolved = urljoin(self.base_url, stripped)
        clean_url, _ = urldefrag(resolved)
        return clean_url

    def _add_url(self, raw_url: str) -> None:
        resolved = self._resolve_url(raw_url)
        if resolved:
            self.extracted_urls.add(resolved)


class WebCrawler:
    """Bounded, rate-limited async web surface crawler."""

    # Default paths that risk destructive side-effects during automated traversal
    DANGEROUS_PATH_SEGMENTS = (
        "/logout",
        "/signout",
        "/log-out",
        "/sign-out",
        "/delete",
        "/destroy",
        "/deactivate",
        "/terminate",
    )

    def __init__(
        self,
        base_url: str,
        *,
        max_depth: int = 2,
        concurrency: int = 5,
        rate_limit: float = 10.0,
        timeout: float = 10.0,
        proxy: str | None = None,
        headers: dict[str, str] | None = None,
        in_scope: Sequence[str] | None = None,
        out_of_scope: Sequence[str] | None = None,
        user_agent: str = "Arsenal-Crawler/4.0",
    ) -> None:
        self.base_url = base_url.rstrip("/")
        parsed = urlparse(self.base_url)
        if not parsed.scheme or not parsed.netloc:
            raise ValueError(f"Invalid base URL: '{base_url}'. Scheme and netloc are required.")
        self.allowed_host = parsed.netloc.lower()
        self.max_depth = max(0, max_depth)
        self.concurrency = max(1, concurrency)
        self.rate_limit = max(0.1, rate_limit)
        self.timeout = max(0.5, timeout)
        self.proxy = proxy
        self.in_scope = list(in_scope) if in_scope else []
        self.out_of_scope = list(out_of_scope) if out_of_scope else []
        self.custom_headers = dict(headers or {})
        self.user_agent = user_agent

        self._min_interval = 1.0 / self.rate_limit
        self._last_request_time = 0.0
        self._lock = asyncio.Lock()

    def is_url_allowed(self, url: str) -> bool:
        """Check whether a URL stays within scope boundaries and avoids side effects."""
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False

        # Host constraint: must match base netloc or declared in_scope
        host = parsed.netloc.lower()
        if host != self.allowed_host:
            if not self.in_scope:
                return False
            if not any(matches_selector(host, s) for s in self.in_scope):
                return False

        # Out-of-scope selector check
        for oos in self.out_of_scope:
            if matches_selector(host, oos) or matches_selector(url, oos):
                return False

        # Skip dangerous actions
        path_lower = parsed.path.lower()
        if any(bad in path_lower for bad in self.DANGEROUS_PATH_SEGMENTS):
            return False

        return True

    async def _rate_limit_throttle(self) -> None:
        """Enforce inter-request rate limiting delay."""
        async with self._lock:
            now = time.monotonic()
            elapsed = now - self._last_request_time
            if elapsed < self._min_interval:
                await asyncio.sleep(self._min_interval - elapsed)
            self._last_request_time = time.monotonic()

    async def crawl(self) -> CrawlResult:
        """Run breadth-first crawl within bounded depth and concurrency."""
        start_time = time.monotonic()

        visited_urls: set[str] = set()
        discovered_urls: set[str] = {self.base_url}
        forms_inventory: list[dict[str, object]] = []
        redirect_chains: list[dict[str, str]] = []
        soft_404_urls: list[str] = []
        status_codes: dict[str, int] = {}
        error_logs: list[str] = []

        # Queue items: (url, current_depth)
        queue: asyncio.Queue[tuple[str, int]] = asyncio.Queue()
        await queue.put((self.base_url, 0))

        client_headers = {
            "User-Agent": self.user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }
        client_headers.update(self.custom_headers)

        semaphore = asyncio.Semaphore(self.concurrency)

        client_kwargs: dict[str, object] = {
            "headers": client_headers,
            "timeout": self.timeout,
            "follow_redirects": False,
            "verify": False,
        }
        if self.proxy:
            client_kwargs["proxy"] = self.proxy

        async with httpx.AsyncClient(**client_kwargs) as client:  # type: ignore[arg-type]
            while not queue.empty():
                url, depth = await queue.get()
                if url in visited_urls:
                    queue.task_done()
                    continue

                visited_urls.add(url)
                if not self.is_url_allowed(url):
                    queue.task_done()
                    continue

                async with semaphore:
                    await self._rate_limit_throttle()
                    try:
                        resp = await client.get(url)
                    except Exception as err:
                        error_logs.append(f"{url}: {err}")
                        queue.task_done()
                        continue

                status_codes[url] = resp.status_code

                # Handle redirects (301, 302, 303, 307, 308)
                if resp.is_redirect and "location" in resp.headers:
                    target_loc = urljoin(url, resp.headers["location"])
                    target_loc, _ = urldefrag(target_loc)
                    redirect_chains.append({"from": url, "to": target_loc, "status": str(resp.status_code)})
                    if self.is_url_allowed(target_loc):
                        discovered_urls.add(target_loc)
                        if depth + 1 <= self.max_depth and target_loc not in visited_urls:
                            await queue.put((target_loc, depth + 1))
                    queue.task_done()
                    continue

                # Soft 404 detection: status 200 with common missing page indicators
                content_type = resp.headers.get("content-type", "").lower()
                is_html = "text/html" in content_type or "application/xhtml" in content_type
                if resp.status_code == 200 and is_html:
                    text_sample = resp.text[:2000].lower()
                    if (
                        "<title>404" in text_sample
                        or "page not found" in text_sample
                        or "not found</title>" in text_sample
                        or "does not exist" in text_sample
                    ):
                        soft_404_urls.append(url)

                # Parse links and forms if HTML and within depth bounds
                if is_html and depth < self.max_depth:
                    parser = LinkAndFormParser(url)
                    try:
                        parser.feed(resp.text)
                    except Exception as parse_err:
                        error_logs.append(f"Parser error on {url}: {parse_err}")

                    for f in parser.forms:
                        forms_inventory.append({
                            "action": f.action,
                            "method": f.method,
                            "source_page": url,
                            "inputs": [
                                {"name": inp.name, "type": inp.input_type, "value": inp.value}
                                for inp in f.inputs
                            ],
                        })

                    for child_url in parser.extracted_urls:
                        if self.is_url_allowed(child_url):
                            discovered_urls.add(child_url)
                            if child_url not in visited_urls:
                                await queue.put((child_url, depth + 1))

                queue.task_done()

        duration_ms = int((time.monotonic() - start_time) * 1000)

        # Deduplicate forms
        unique_forms: list[dict[str, object]] = []
        seen_forms: set[str] = set()
        for f in forms_inventory:
            key = f"{f['method']}:{f['action']}:{','.join(i['name'] for i in f['inputs'])}"  # type: ignore[index]
            if key not in seen_forms:
                seen_forms.add(key)
                unique_forms.append(f)

        return CrawlResult(
            target=self.base_url,
            endpoints_discovered=len(discovered_urls),
            unique_urls=sorted(discovered_urls),
            forms=unique_forms,
            redirects=redirect_chains,
            soft_404s=sorted(set(soft_404_urls)),
            status_codes=status_codes,
            errors=error_logs,
            duration_ms=duration_ms,
        )
