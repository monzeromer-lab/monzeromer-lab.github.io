#!/usr/bin/env python3
"""Finish a `wf build` for GitHub Pages. Run by the deploy workflow.

1. Clean URLs without a redirect. The site links to `/contact` and names it
   as the canonical URL, but GitHub Pages answers `/contact` with a 301 to
   `/contact/`. It serves `contact.html` for `/contact` directly, so each
   `<route>/index.html` gets a copy beside it. Asset paths in the page are
   `../app.js`, which resolve the same from either address.

2. Structured data for a person. WebFluent describes the site's owner as an
   `Organization`; this is a personal site, so that node becomes a `Person`
   with the facts the site states (see PERSON).

3. The sharing card's size and description, which WebFluent does not write:
   `og:image:width`, `og:image:height`, `og:image:alt`, `twitter:image:alt`;
   and `og:locale` in the `en_US` form Open Graph reads (WebFluent writes
   the page's `lang`, `en`).

4. The fonts, asked for early. They are referenced from styles.css, so the
   browser would only find them once that has arrived; a preload in the head
   starts both downloads with the stylesheet's.

Usage: tools/pages.py build
"""
import json
import re
import shutil
import sys
from pathlib import Path

PERSON = {
    "@type": "Person",
    "name": "Monzer Omer",
    "alternateName": "Elmonther Omer",
    "jobTitle": "Senior Backend Engineer",
    "description": "Senior backend engineer specializing in Rust, Node.js and distributed systems.",
    "email": "mailto:monzer.a.omer@gmail.com",
    "worksFor": [
        {"@type": "Organization", "name": "Alhakeem", "url": "https://platform.alhakeem.app/"},
        {"@type": "Organization", "name": "SilverKey Technologies"},
    ],
    "alumniOf": {"@type": "CollegeOrUniversity", "name": "National Ribat University"},
    "knowsAbout": ["Rust", "Node.js", "TypeScript", "Distributed systems", "Microservices",
                   "Apache Kafka", "GraphQL", "Compiler design", "WebAssembly"],
    "knowsLanguage": ["ar", "en"],
    "sameAs": [
        "https://github.com/monzeromer-lab",
        "https://www.linkedin.com/in/monzeromer/",
    ],
}
CARD = {"width": "1200", "height": "630",
        "alt": "Monzer Omer, senior backend engineer — Rust, Node.js and distributed systems. monzeromer.dev"}

FONTS = ["/fonts/inter-latin.woff2", "/fonts/jetbrains-mono-latin.woff2"]

LD = re.compile(r'(<script type="application/ld\+json">)(.*?)(</script>)', re.S)


def person(html: str) -> str:
    def swap(m):
        data = json.loads(m.group(2))
        for node in data.get("@graph", []):
            if node.get("@type") == "Organization":
                ident, url = node["@id"].replace("#organization", "#person"), node["url"]
                node.clear()
                node.update({"@id": ident, **PERSON, "url": url, "image": url + "icon-512.png"})
            elif node.get("@type") == "WebSite":
                node["publisher"] = {"@id": node["@id"].replace("#website", "#person")}
            elif "isPartOf" in node:
                node["about"] = {"@id": node["isPartOf"]["@id"].replace("#website", "#person")}
        return m.group(1) + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + m.group(3)
    return LD.sub(swap, html, count=1)


def card(html: str) -> str:
    html = html.replace('<meta property="og:locale" content="en">', '<meta property="og:locale" content="en_US">')
    if 'property="og:image"' not in html or "og:image:width" in html:
        return html
    tags = (f'<meta property="og:image:width" content="{CARD["width"]}">\n'
            f'    <meta property="og:image:height" content="{CARD["height"]}">\n'
            f'    <meta property="og:image:alt" content="{CARD["alt"]}">\n'
            f'    <meta name="twitter:image:alt" content="{CARD["alt"]}">\n    ')
    return html.replace('<meta name="twitter:card"', tags + '<meta name="twitter:card"', 1)


def preload(html: str) -> str:
    if 'rel="preload"' in html:
        return html
    links = "".join(f'<link rel="preload" href="{f}" as="font" type="font/woff2" crossorigin>\n    '
                    for f in FONTS)
    return html.replace('<link rel="stylesheet"', links + '<link rel="stylesheet"', 1)


def main(out: Path) -> None:
    pages = sorted(out.glob("index.html")) + sorted(out.glob("*/index.html"))
    for page in pages:
        page.write_text(preload(card(person(page.read_text()))))
    for page in sorted(out.glob("*/index.html")):
        shutil.copyfile(page, out / f"{page.parent.name}.html")
    print(f"{len(pages)} page(s) finished for GitHub Pages")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "build"))
