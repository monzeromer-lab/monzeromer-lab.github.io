# Monzer Omer — Portfolio

Personal portfolio site built entirely with [WebFluent](https://github.com/monzeromer-lab/WebFluent), a web-first programming language that compiles to HTML, CSS, and JavaScript.

## Structure

Written in WebFluent 5.3, styled with MO Systems. The site is dark by
default: `src/theme.wf` is the dark theme it builds with, and
`src/theme-light.css` the light palette a reader can switch to.

```
src/
├── App.wf                # Header, router, footer
├── model.wf              # Types, constants, and the content files
├── theme.wf              # MO Systems, dark: the site's theme
├── theme-light.css       # MO Systems, light: applied when a reader picks it
├── site.css              # Shared rules, all on theme tokens
├── analytics.js          # Google Analytics and Consent Mode (live site only)
├── stores/               # Consent: whether the banner is asking
├── content/              # projects, experience, skills, education (JSON)
├── components/           # Header, footer, cards, timeline entries, AI badge and callout, consent banner
└── pages/                # Home, Projects, Experience, Skills, Education, Contact
```

To change what the site says, edit the JSON under `src/content/`.

## Setup

Needs `wf` 5.3.3 or later.

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

`webfluent.app.json` says everything the build needs for GitHub Pages and
for search: `build.clean_urls: "file"` writes a `<route>.html` beside each
`<route>/index.html`, so `/contact` is served directly instead of
redirecting to `/contact/`; `meta.owner: "person"`, `job_title`, `same_as`
and `owner_details` describe you in the structured data; `meta.image_alt`
describes the sharing card; and `meta.preload` asks for the two fonts with
the page.

The fonts — Inter and JetBrains Mono, Latin subsets, SIL Open Font License
1.1 — are served from `public/fonts/` rather than Google Fonts, so nothing
from another origin stands in the way of the first paint.

Google Analytics (GA4, `G-NJ43DW0SFV`) with Consent Mode v2: the library is
in `meta.scripts`, loaded `async` so it never holds up the page; the
endpoints it reports to are in `meta.connect` (the policy's `connect-src`)
and its image beacons' origins in `meta.img` (`img-src`);
and `src/analytics.js` does the set-up Google's inline snippet would. Every
consent type starts `denied`, so nothing is stored until the reader allows
it in the banner (`ConsentBanner`, reopened by "Cookie settings" in the
footer); the answer is kept in `localStorage`. Only `monzeromer.dev`
reports, so local builds and Lighthouse runs are not counted. `lints` turns
`D05` off: `gtag.js` changes at Google's will, so it cannot carry an
integrity hash.

To move to a new WebFluent release, change `WF_VERSION` in the workflow. The custom domain, `monzeromer.dev`, is
`public/CNAME`, copied into every build.

## License

All rights reserved.
