# Monzer Omer — Portfolio

Personal portfolio site built entirely with [WebFluent](https://github.com/monzeromer-lab/WebFluent), a web-first programming language that compiles to HTML, CSS, and JavaScript.

## Structure

Written in WebFluent 5.2, styled with MO Systems. The site is dark by
default: `src/theme.wf` is the dark theme it builds with, and
`src/theme-light.css` the light palette a reader can switch to.

```
src/
├── App.wf                # Header, router, footer
├── model.wf              # Types, constants, and the content files
├── theme.wf              # MO Systems, dark: the site's theme
├── theme-light.css       # MO Systems, light: applied when a reader picks it
├── site.css              # Shared rules, all on theme tokens
├── content/              # projects, experience, skills, education (JSON)
├── components/           # Header, footer, cards, timeline entries, AI badge and callout
└── pages/                # Home, Projects, Experience, Skills, Education, Contact
```

To change what the site says, edit the JSON under `src/content/`.

## Setup

Needs `wf` 5.2 or later.

```bash
wf serve          # Dev server on localhost:3000
wf check          # Every finding, nothing written
wf build          # Compile into ./build (ignored by git)
wf verify         # Load every built page in headless Chrome
```

## Deploying

Nothing built is committed. `.github/workflows/deploy.yml` installs the
pinned `wf` release, runs `wf check --deny-warnings`, builds, and publishes
`build/` to GitHub Pages on every push to `master`. Pull requests are checked
and built but not deployed.

Between the build and the upload, `tools/pages.py` finishes the output for
GitHub Pages: a `<route>.html` beside each `<route>/index.html`, so `/contact`
is served directly instead of redirecting to `/contact/`; a `Person` in the
structured data where WebFluent writes an `Organization`; the sharing
card's size and alt text; and preloads for the two fonts.

The fonts — Inter and JetBrains Mono, Latin subsets, SIL Open Font License
1.1 — are served from `public/fonts/` rather than Google Fonts, so nothing
from another origin stands in the way of the first paint. To move to a new WebFluent release, change
`WF_VERSION` in the workflow. The custom domain, `monzeromer.dev`, is
`public/CNAME`, copied into every build.

## License

All rights reserved.
