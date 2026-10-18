"""Bounded, robots-aware snapshot of the public lab website; no external-host crawl."""
from __future__ import annotations
import argparse, hashlib, json, re, time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse, urlunparse, parse_qsl, urlencode
from urllib.robotparser import RobotFileParser
import httpx
from bs4 import BeautifulSoup

ROOT = "https://mobiliarlab.ethz.ch/"
HOST = "mobililab.ethz.ch"
# The supplied official site links to this ETH-hosted canonical WordPress domain.
ALLOWED_HOSTS = {"mobiliarlab.ethz.ch", HOST}
USER_AGENT = "EinsteinLabResearchPreview/0.1 (+local academic demonstration)"

def canonical(url: str) -> str | None:
    p = urlparse(url)
    if p.scheme != "https" or p.hostname not in ALLOWED_HOSTS or p.port not in (None, 443) or p.username:
        return None
    if any(x in p.path.lower() for x in ("/wp-admin", "/wp-json", "/feed", "/tag/", "/author/", "/page/")):
        return None
    query = parse_qsl(p.query, keep_blank_values=True)
    for key, value in query:
        if key in ("page_id", "p") and value.isdigit(): continue
        if key == "research-proj-posts" and re.fullmatch(r"[a-z0-9-]{1,120}", value): continue
        return None
    if len(query) > 1: return None
    return urlunparse(("https", HOST, p.path or "/", "", urlencode(query), ""))

def get_same_origin(client: httpx.Client, url: str) -> httpx.Response:
    for _ in range(5):
        if canonical(url) is None:
            raise ValueError("Off-origin or disallowed URL")
        url = canonical(url)
        r = client.get(url, follow_redirects=False)
        if r.is_redirect:
            url = urljoin(url, r.headers.get("location", ""))
            continue
        r.raise_for_status()
        return r
    raise ValueError("Redirect limit exceeded")

def extract(html: str, url: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.get_text(" ", strip=True) if soup.title else url
    title = re.split(r"\s[:|]\sMobiliar", title)[0]
    links = sorted({u for a in soup.select("a[href]") if (u := canonical(urljoin(url, a["href"])))})
    for tag in soup.select("script,style,noscript,nav,header,footer,form,aside,[aria-hidden=true],.menu,.offcanvas-menu,[role=navigation]"):
        tag.decompose()
    main = soup.select_one("main") or soup.select_one("article") or soup.select_one(".entry-content") or soup.select_one("#page-content") or soup.body or soup
    paragraphs = []
    for element in main.find_all(["h1", "h2", "h3", "p", "li"]):
        if element.name == "li" and element.find("p"):
            continue
        text = re.sub(r"\s+", " ", element.get_text(" ", strip=True)).strip()
        if text and text not in paragraphs:
            paragraphs.append(text)
    if not paragraphs:
        paragraphs = [re.sub(r"\s+", " ", main.get_text(" ", strip=True))]
    text = "\n\n".join(paragraphs)[:80000]
    return {"url": url, "title": title, "text": text, "links": links,
            "text_sha256": hashlib.sha256(text.encode()).hexdigest(),
            "html_sha256": hashlib.sha256(html.encode()).hexdigest()}

def crawl(output: Path, limit: int = 80, delay: float = 0.4) -> dict:
    queue, seen, pages, skipped = deque([canonical(ROOT)]), set(), [], []
    now = datetime.now(timezone.utc).isoformat()
    with httpx.Client(timeout=20, headers={"User-Agent": USER_AGENT}, trust_env=False) as client:
        robots = RobotFileParser()
        try:
            r = client.get(urljoin(canonical(ROOT), "robots.txt"))
            if r.status_code == 404:
                robots.parse([])
            else:
                r.raise_for_status(); robots.parse(r.text.splitlines())
        except Exception as e:
            raise RuntimeError("Cannot establish robots policy; previous snapshot preserved") from e
        delay = max(delay, robots.crawl_delay(USER_AGENT) or 0)
        while queue and len(pages) < limit:
            url = queue.popleft()
            if url in seen: continue
            seen.add(url)
            if re.search(r"\.(pdf|png|jpg|jpeg|zip|mp4|docx?|xlsx?)/?$", url, re.I):
                skipped.append({"url": url, "reason": "linked_document_not_ingested"}); continue
            if not robots.can_fetch(USER_AGENT, url):
                skipped.append({"url": url, "reason": "robots_disallowed"}); continue
            try:
                r = get_same_origin(client, url)
                if "text/html" not in r.headers.get("content-type", ""):
                    skipped.append({"url": url, "reason": "not_html"}); continue
                if len(r.content) > 2_000_000: raise ValueError("HTML exceeds limit")
                page = extract(r.text, str(r.url)); page["fetched_at"] = now
                if len(page["text"]) < 50:
                    skipped.append({"url": url, "reason": "insufficient_text"}); continue
                pages.append(page)
                for link in page["links"]:
                    if link not in seen: queue.append(link)
                print(f"{len(pages):02d} {page['title']} [{len(page['text'])} chars]", flush=True)
            except Exception as e:
                skipped.append({"url": url, "reason": type(e).__name__ + ": " + str(e)[:180]})
            time.sleep(delay)
    if not pages: raise RuntimeError("No usable pages; previous snapshot preserved")
    snapshot = {"schema": 1, "root": ROOT, "fetched_at": now, "pages": pages,
                "skipped": skipped, "queued_remaining": len(set(queue)-seen), "limit": limit,
                "coverage": "Public HTML from the two observed ETH lab hostnames, normalized to mobililab.ethz.ch; linked papers and private information not ingested."}
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_suffix(".tmp")
    temp.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2)); temp.replace(output)
    return snapshot

if __name__ == "__main__":
    p = argparse.ArgumentParser(); p.add_argument("--output", type=Path, default=Path("lab_backend/data/lab.json"))
    p.add_argument("--limit", type=int, default=80)
    a = p.parse_args(); s = crawl(a.output, max(1, min(120, a.limit)))
    print(json.dumps({"pages": len(s["pages"]), "skipped": len(s["skipped"]), "remaining": s["queued_remaining"]}))
