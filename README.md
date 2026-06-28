# Monzer Omer — Portfolio Site

Senior Backend Engineer portfolio built with **WebFluent** (`.wf`), a web-first language that compiles to HTML, CSS, and JavaScript with static site generation (SSG).

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Project Structure](#project-structure)
3. [Quick Start](#quick-start)
4. [Build Pipeline](#build-pipeline)
5. [Running Locally](#running-locally)
6. [Deployment](#deployment)
7. [Source Architecture](#source-architecture)
8. [Mobile Responsiveness](#mobile-responsiveness)
9. [Configuration](#configuration)
10. [Development Workflow](#development-workflow)

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| [WebFluent CLI](https://github.com/monzeromer-lab/WebFluent) | latest | Compiles `.wf` → HTML/CSS/JS |
| Bash (macOS/Linux) | any | Post-build patch script |
| Node.js (optional) | ≥16 | For `node --check` validation |

### Installing WebFluent

```bash
# Via Cargo (Rust)
cargo install webfluent

# Verify
wf --version
```

---

## Project Structure

```
portfolio/
├── webfluent.app.json          # Project config (name, theme, build settings, meta)
├── patch-mobile.sh             # Post-build CSS patcher for mobile responsiveness
│
├── src/                        # ── Source files (.wf) ────────────
│   ├── components/
│   │   ├── SiteNav.wf          #   Navbar + mobile drawer + injected responsive CSS
│   │   ├── SiteFooter.wf       #   Footer with copyright + social links
│   │   ├── AIBadge.wf          #   "AI-augmented workflow" inline pill badge
│   │   └── AICallout.wf        #   Left-bordered callout explaining AI-first workflow
│   └── pages/
│       ├── Home.wf             #   Landing page (hero, typewriter, featured projects)
│       ├── Projects.wf         #   Full project list (9 projects)
│       ├── Skills.wf           #   Skills grid (8 categories × 4–5 items)
│       ├── Experience.wf       #   Work history (5 roles, reverse-chronological)
│       ├── Education.wf        #   Degree + certifications
│       └── Contact.wf          #   Email, LinkedIn, GitHub + AI workflow note
│
├── index.html                  # Compiled home page (SSG pre-rendered)
├── app.js                      # Compiled JS (router, components, reactivity)
├── styles.css                  # Compiled CSS (WebFluent framework styles)
│
├── projects/index.html         # SSG pre-rendered sub-page
├── skills/index.html           #   "
├── experience/index.html       #   "
├── education/index.html        #   "
├── contact/index.html          #   "
│
└── build/                      # Development artifacts (ignored)
```

### Compiled Output

`wf build` generates these files at the project root (`output: "./"`):

| File | Description |
|---|---|
| `index.html` | Pre-rendered Home page with SSG hydration markers |
| `app.js` | All components, router, state reactivity, event handlers |
| `styles.css` | WebFluent component library CSS (layout, typography, form, nav, etc.) |
| `*/index.html` | Pre-rendered sub-pages (projects, skills, experience, education, contact) |

---

## Quick Start

```bash
# 1. Build the site
wf build

# 2. Apply mobile responsiveness patches
./patch-mobile.sh

# 3. Serve locally
python3 -m http.server 8080
# or: wf serve
```

Then open **http://localhost:8080** in your browser.

---

## Build Pipeline

### Full pipeline (recommended)

```bash
wf build && ./patch-mobile.sh
```

### Step 1: `wf build`

```
Building Monzer Omer — Senior Backend Engineer...
  SSG: pre-rendered static pages
  6 pages, 4 components, 0 stores
  Output: .//
Build complete.
```

What happens:
1. Compiles all `.wf` files in `src/` into `app.js`
2. Generates `styles.css` from the WebFluent component library
3. Pre-renders each page as static HTML (`index.html` in root and subdirectories)
4. SSG mode injects hydration markers (`<!--wf-component-->`) for client-side takeover

### Step 2: `./patch-mobile.sh`

```
✓ [1/5] Added --color-surface-alt to :root
✓ [2/5] Replaced .wf-row column stacking with wrap
✓ [3a] Added !important to h1.wf-heading
✓ [3b] Added !important to h2.wf-heading
✓ [4/5] Fixed .wf-container padding at 768px
✓ Done — 5 patch(es) applied to styles.css
```

**Why this is needed:** The WebFluent framework's default responsive breakpoints are designed for generic apps. This portfolio needs specific overrides:

| Patch | What it fixes |
|---|---|
| `--color-surface-alt` | Adds missing CSS variable for callout backgrounds (was undefined in light mode) |
| `.wf-row` wrapping | Framework forces all rows to stack vertically at 768px — breaks badge rows, buttons, project headers |
| Heading `!important` | Inline heading sizes (e.g., 38px) otherwise defeat the responsive scaling rules |
| `.wf-container` padding | Framework sets narrow padding on mobile — needs 16px for comfortable reading |

The injected CSS from `SiteNav.wf` handles all other responsive behaviour at runtime (grid columns, card padding, button sizing, mobile nav drawer).

---

## Running Locally

### Option A: Python HTTP server (simplest)

```bash
cd portfolio
python3 -m http.server 8080
```

Open http://localhost:8080

### Option B: WebFluent dev server

```bash
wf serve
```

Opens http://localhost:3000 with hot-reload (if supported by your wf version).

### Option C: Any static file server

The site is fully static — serve the `portfolio/` directory with nginx, Apache, `npx serve`, etc.

```
npx serve .
```

---

## Deployment

The site is a **static site** — deploy the entire directory to any static host:

```
portfolio/
├── index.html          ← Required
├── app.js              ← Required
├── styles.css          ← Required
├── patch-mobile.sh     ← Optional (build tool, not needed at runtime)
├── projects/
│   └── index.html      ← Required
├── skills/
│   └── index.html      ← Required
├── experience/
│   └── index.html      ← Required
├── education/
│   └── index.html      ← Required
├── contact/
│   └── index.html      ← Required
└── src/                ← Optional (source files, not needed at runtime)
```

### Deploy targets

| Platform | Notes |
|---|---|
| **GitHub Pages** | Point to root or `/docs` folder |
| **Netlify** | Build command: `wf build && bash patch-mobile.sh`. Publish: `.` |
| **Vercel** | Same as Netlify. Framework preset: "Other" |
| **Cloudflare Pages** | Build command: `wf build && bash patch-mobile.sh`. Output: `/` |
| **nginx / Apache** | Copy all files to web root. Ensure SPA fallback: `try_files $uri $uri/ /index.html` |
| **S3 / CloudFront** | Upload all files. Set index document to `index.html` |

### SPA routing note

The `app.js` router handles client-side navigation. Direct URL access (e.g., `/projects`) requires the server to serve the corresponding `projects/index.html`. Sub-directory HTML files handle this for static hosts.

---

## Source Architecture

### Pages (6 files)

Each page is a WebFluent `Page` declaration with a `path` and `title`. The router matches URL paths to pages.

| File | Route | Title |
|---|---|---|
| `src/pages/Home.wf` | `/` | Monzer Omer — Senior Backend Engineer |
| `src/pages/Projects.wf` | `/projects` | Projects — Monzer Omer |
| `src/pages/Skills.wf` | `/skills` | Skills — Monzer Omer |
| `src/pages/Experience.wf` | `/experience` | Experience — Monzer Omer |
| `src/pages/Education.wf` | `/education` | Education — Monzer Omer |
| `src/pages/Contact.wf` | `/contact` | Contact — Monzer Omer |

### Components (4 files)

| File | Used on | Purpose |
|---|---|---|
| `src/components/SiteNav.wf` | All pages | Navigation bar, mobile bottom-sheet drawer, injects global responsive CSS |
| `src/components/SiteFooter.wf` | All pages | Footer with copyright year and social links (GitHub, LinkedIn, Email) |
| `src/components/AIBadge.wf` | Home, Skills | Inline pill: "AI-augmented workflow — 95%" with progress bar |
| `src/components/AICallout.wf` | Home, Skills, Contact | Left-bordered info block explaining AI-assisted development workflow |

### State & Reactivity

- **Typewriter effect** (Home page): Uses `state` signals for line index, character position, and phase (typing/pausing/deleting). An `effect` loop drives the animation via `setTimeout`.
- **Router**: `WF.createRouter()` handles client-side navigation with `pushState`. Active page detection highlights the current nav item in the mobile drawer.
- **Icon loading**: Tabler Icons are loaded from CDN (`@tabler/icons-webfont`). A `WF.effect` in `SiteNav` replaces `.wf-icon` elements with `<i class="ti ti-*">` tags.

---

## Mobile Responsiveness

### Strategy

Mobile responsiveness uses a **two-layer approach**:

1. **Source `.wf` files** — Page-specific `@media` queries inside component style blocks (survive rebuilds)
2. **Injected CSS** — `SiteNav.wf` injects a `<style id="wf-mobile-styles">` block at runtime that overrides framework defaults (loaded after `styles.css`, wins the cascade)

### Breakpoints

| Breakpoint | Target devices | Key behaviours |
|---|---|---|
| **>768px** | Desktop, large tablets | Full nav bar, 3-column skills grid, 38px hero headings |
| **≤768px** | Tablets, large phones | Hamburger nav drawer, rows wrap naturally, 2-column skills grid, 28/24px headings |
| **≤480px** | Phones | Single-column grid, full-width CTA buttons, 24/20px headings, compact spacing |

### What the injected CSS overrides

The framework's `styles.css` contains default mobile rules that are wrong for this portfolio:

| Framework default | Injected override | Why |
|---|---|---|
| `.wf-row { flex-direction: column }` at 768px | `.wf-row { flex-direction: row !important; flex-wrap: wrap }` | Badge rows, button rows, and project headers must stay horizontal |
| `h1.wf-heading { font-size: 2rem }` | `font-size: 28px !important` | Inline 38px styles would otherwise win |
| `.wf-container { padding: 0 var(--spacing-sm) }` | `max-width: 100% !important; padding: 0 16px` | Content needs comfortable side margins |
| `.wf-grid { grid-template-columns: 1fr }` | `repeat(2, 1fr) !important` | Skills cards fit 2 per row on tablets |

### Mobile navigation drawer

On screens ≤768px, the desktop nav links are hidden and a **bottom-sheet drawer** handles navigation:

- **Open:** Tap the ☰ hamburger button in the navbar
- **Close:** Tap the × button, tap the backdrop, or tap any page link
- **Pages:** Home, Projects, Experience, Skills, Education, Contact
- **Active state:** Current page is shown in bold
- **Safe area:** Respects `safe-area-inset-bottom` on notched iPhones
- **Touch targets:** All links are ≥48px tall

---

## Configuration

### `webfluent.app.json`

```json
{
    "name": "Monzer Omer — Senior Backend Engineer",
    "theme": {
        "name": "default",
        "tokens": {
            "color-primary": "#2563EB",
            "color-primary-dark": "#1d4ed8",
            "font-family": "Inter, system-ui, sans-serif",
            "font-family-mono": "'JetBrains Mono', 'Fira Code', monospace"
        }
    },
    "build": {
        "output": "./",
        "ssg": true,
        "output_type": "static"
    },
    "meta": {
        "description": "Senior Backend Engineer specializing in Rust, Node.js, and Distributed Systems. AI-augmented workflow.",
        "author": "Monzer Omer"
    }
}
```

| Field | Description |
|---|---|
| `theme.tokens.color-primary` | Primary accent colour (buttons, links, badges, icons) |
| `theme.tokens.font-family` | Body font (Inter) |
| `theme.tokens.font-family-mono` | Code/mono font (JetBrains Mono) |
| `build.output` | Build output directory (`./` = project root) |
| `build.ssg` | Enable Static Site Generation (pre-renders HTML) |
| `build.output_type` | `"static"` for fully static site (no SSR server needed) |
| `meta.description` | `<meta name="description">` for SEO |

### Changing content

All page content lives in `src/pages/*.wf`. To update:

1. Edit the `.wf` source file
2. Run `wf build && ./patch-mobile.sh`
3. The compiled `index.html` and `app.js` are regenerated

### Changing styles

- **Framework CSS:** Generated automatically — do not edit `styles.css` directly
- **Component styles:** Use `style { ... }` blocks inside `.wf` components
- **Responsive overrides:** Add `@media` queries inside style blocks (compiles to scoped CSS)
- **Global overrides:** Add to the injected CSS in `SiteNav.wf` (survives rebuilds)
- **Post-build patches:** Add to `patch-mobile.sh` for framework CSS fixes

---

## Development Workflow

### Editing a page

```bash
# 1. Edit the source
vim src/pages/Home.wf

# 2. Build and patch
wf build && ./patch-mobile.sh

# 3. Validate
node --check app.js

# 4. Serve and test
python3 -m http.server 8080
```

### Adding a new page

```bash
# Generate a page scaffold
wf generate page Blog

# Edit src/pages/Blog.wf
# Add it to the router (auto-detected by wf build)
# Add it to the mobile drawer in SiteNav.wf (pages array around line 72)

# Build
wf build && ./patch-mobile.sh
```

### Adding a new component

```bash
wf generate component FeatureCard
# Edit src/components/FeatureCard.wf
# Import it in pages: FeatureCard()
```

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Build error | `.wf` syntax issue | Check error message for file:line; semicolons are invalid inside `@media` blocks |
| White page | JS runtime crash | Open browser console; check `app.js` line number in stack trace |
| Nav missing on desktop | Corrupted `styles.css` | `wf build && ./patch-mobile.sh` regenerates clean CSS |
| Mobile layout broken | Framework CSS overriding injected styles | Check that `wf-mobile-styles` `<style>` tag is present in `<head>` (via DevTools) |
| Icons not loading | CDN blocked or offline | Tabler Icons load from `cdn.jsdelivr.net`; ensure network access |

---

## Files Summary

```
portfolio/
├── webfluent.app.json           # Project configuration
├── patch-mobile.sh               # Post-build CSS patcher (run after wf build)
│
├── src/
│   ├── components/
│   │   ├── SiteNav.wf            # Navbar + mobile drawer + injected responsive CSS
│   │   ├── SiteFooter.wf         # Page footer
│   │   ├── AIBadge.wf            # AI workflow badge pill
│   │   └── AICallout.wf          # AI workflow explanation block
│   └── pages/
│       ├── Home.wf               # Landing page
│       ├── Projects.wf           # Project portfolio
│       ├── Skills.wf             # Skills grid
│       ├── Experience.wf         # Work history
│       ├── Education.wf          # Education & certifications
│       └── Contact.wf            # Contact links
│
├── index.html                    # Compiled Home page
├── app.js                        # Compiled application JS
├── styles.css                    # Compiled framework CSS
│
├── projects/index.html           # Compiled sub-pages
├── skills/index.html
├── experience/index.html
├── education/index.html
├── contact/index.html
│
└── build/                        # Development artifacts (not deployed)
```

---

## Build Command Reference

```bash
wf build                  # Compile .wf → HTML/CSS/JS
wf build && ./patch-mobile.sh  # Full build + mobile patches
wf serve                  # Start dev server (port 3000)
wf generate page <name>   # Scaffold a new page
wf generate component <name>  # Scaffold a new component
wf generate store <name>  # Scaffold a new state store
node --check app.js       # Validate compiled JavaScript
```
