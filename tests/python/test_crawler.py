"""Tests for Arsenal's native web crawler, structural parser, and surface discovery playbook."""

from __future__ import annotations

import io
import json
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from arsenal.crawl import LinkAndFormParser, WebCrawler


def test_parser_extracts_links_and_forms():
    html_sample = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Test Portal</title>
        <link rel="stylesheet" href="/assets/style.css">
        <script src="/static/app.js"></script>
    </head>
    <body>
        <nav>
            <a href="/dashboard">Dashboard</a>
            <a href="https://target.com/profile">Profile</a>
            <a href="javascript:void(0)">Do Not Visit</a>
            <a href="#section">Anchor Link</a>
            <a href="mailto:admin@target.com">Email Us</a>
        </nav>
        <form action="/login" method="POST">
            <input type="text" name="username" value="guest">
            <input type="password" name="password">
            <input type="hidden" name="csrf_token" value="xyz123">
        </form>
    </body>
    </html>
    """
    parser = LinkAndFormParser(base_url="https://target.com")
    parser.feed(html_sample)

    assert "https://target.com/dashboard" in parser.extracted_urls
    assert "https://target.com/profile" in parser.extracted_urls
    assert "https://target.com/assets/style.css" in parser.extracted_urls
    assert "https://target.com/static/app.js" in parser.extracted_urls
    assert not any("javascript" in u or "mailto" in u for u in parser.extracted_urls)

    assert len(parser.forms) == 1
    form = parser.forms[0]
    assert form.action == "https://target.com/login"
    assert form.method == "POST"
    input_names = [i.name for i in form.inputs]
    assert input_names == ["username", "password", "csrf_token"]


def test_crawler_scope_containment_and_safety():
    crawler = WebCrawler(
        base_url="https://app.example.com",
        in_scope=["app.example.com", "*.api.example.com"],
        out_of_scope=["admin.api.example.com", "https://app.example.com/forbidden/*"],
    )

    # Allowed in-scope
    assert crawler.is_url_allowed("https://app.example.com/home") is True
    assert crawler.is_url_allowed("https://v1.api.example.com/users") is True

    # Blocked external
    assert crawler.is_url_allowed("https://attacker.com/malicious") is False

    # Blocked by out_of_scope
    assert crawler.is_url_allowed("https://admin.api.example.com/secrets") is False
    assert crawler.is_url_allowed("https://app.example.com/forbidden/test") is False

    # Blocked dangerous destructive paths
    assert crawler.is_url_allowed("https://app.example.com/logout") is False
    assert crawler.is_url_allowed("https://app.example.com/api/delete-account") is False


@pytest.mark.anyio
async def test_crawler_execution_with_mocked_responses():
    crawler = WebCrawler(
        base_url="https://example.com",
        max_depth=1,
        concurrency=2,
        rate_limit=100.0,
    )

    home_html = """
    <html><body>
        <a href="/about">About</a>
        <a href="/missing">Missing Page</a>
        <form action="/search" method="GET">
            <input type="text" name="q">
        </form>
    </body></html>
    """

    about_html = "<html><body><h1>About Us</h1></body></html>"
    soft404_html = "<html><head><title>404 Page Not Found</title></head><body>Nothing here</body></html>"

    def mock_get(url: str, **kwargs: object) -> httpx.Response:
        req = httpx.Request("GET", url)
        if url == "https://example.com":
            return httpx.Response(200, text=home_html, headers={"content-type": "text/html"}, request=req)
        elif url == "https://example.com/about":
            return httpx.Response(200, text=about_html, headers={"content-type": "text/html"}, request=req)
        elif url == "https://example.com/missing":
            return httpx.Response(200, text=soft404_html, headers={"content-type": "text/html"}, request=req)
        return httpx.Response(404, text="Not Found", request=req)

    with patch.object(httpx.AsyncClient, "get", new=AsyncMock(side_effect=mock_get)):
        result = await crawler.crawl()

    assert result.target == "https://example.com"
    assert "https://example.com/about" in result.unique_urls
    assert "https://example.com/missing" in result.unique_urls
    assert "https://example.com/missing" in result.soft_404s
    assert len(result.forms) == 1
    assert result.forms[0]["action"] == "https://example.com/search"
    assert result.status_codes["https://example.com"] == 200
    assert result.duration_ms >= 0


def test_playbook_catalog_resolution():
    from arsenal.scripts.playbook_catalog import resolve

    # Both canonical ID and alias resolve correctly
    entry1 = resolve("webapp-web-surface-discovery/agent")
    entry2 = resolve("webapp-web-surface-discovery")
    assert entry1["canonical_id"] == "webapp-web-surface-discovery/agent"
    assert entry2["canonical_id"] == "webapp-web-surface-discovery/agent"
    assert entry1["domain"] == "webapp"
    assert entry1["implementation_ref"]["resource_path"] == "playbooks/webapp/web_surface_discovery.py"


def test_playbook_direct_execution_with_mock():
    from arsenal.scripts.playbooks.webapp.web_surface_discovery import main as playbook_main

    f_out = io.StringIO()
    f_err = io.StringIO()

    mock_resp = httpx.Response(
        200,
        text="<html><body><a href='/contact'>Contact</a></body></html>",
        headers={"content-type": "text/html"},
        request=httpx.Request("GET", "https://example.com"),
    )

    with patch("sys.argv", ["web_surface_discovery.py", "--target", "https://example.com", "--depth", "1"]):
        with patch.object(httpx.AsyncClient, "get", new=AsyncMock(return_value=mock_resp)):
            with redirect_stdout(f_out), redirect_stderr(f_err):
                playbook_main()

    output = json.loads(f_out.getvalue())
    assert output["target"] == "https://example.com"
    assert "https://example.com/contact" in output["unique_urls"]
    assert output["endpoints_discovered"] >= 1
