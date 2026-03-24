# Monzer Omer — Portfolio

Personal portfolio site built entirely with [WebFluent](https://github.com/monzeromer-lab/WebFluent), a web-first programming language that compiles to HTML, CSS, and JavaScript.

## Structure

```
src/
├── App.wf              # Root layout — navbar, router, footer
├── pages/
│   ├── Home.wf         # Landing page
│   ├── Projects.wf     # Featured projects
│   ├── Experience.wf   # Work history
│   ├── Skills.wf       # Technical skills
│   ├── Education.wf    # Education
│   └── Contact.wf      # Contact info & links
```

## Setup

```bash
wf build          # Compile to ./build
wf serve           # Dev server on localhost:3000
```

## Config

Theme, SSG, and metadata are configured in `webfluent.app.json`.

## License

All rights reserved.
