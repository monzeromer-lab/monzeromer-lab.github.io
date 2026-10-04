# The MO mark

A geometric **M** and **O** in graphite, drawn on MO Systems' 4px grid at
the weight Inter has at display size. The O overlaps the M's right stem and
cuts into it, as in the original mark. Below the cut the stem turns blue and
leaves the letter as a circuit trace — along, then up at 45°, the angle
every trace in the system takes — into a ringed node at the centre of the O.
Graphite is structure, blue is intent: the design system's rule, in one
mark.

The geometry lives in `mark.py` as numbers on the grid (cap height, stroke,
the M's path, the cut, the O's radii, the trace), and every file here is
written from that one source.

| File | Use |
|---|---|
| `mo-logo.svg` | On light surfaces — graphite `#4C4D4F`, blue `#2B5178` |
| `mo-logo-on-dark.svg` | On dark surfaces — graphite `#E2E5E8`, blue `#6A9BCB` |
| `mo-logo-mono.svg` | One colour, `currentColor`: inline it and set `color` |
| `favicon.svg` | The icon: the mark on a dark tile, with a heavier trace for small sizes |
| `mo-logo.png`, `mo-logo-on-dark.png` | 1200px rasters, for places that refuse SVG |
| `poster.html` | The sharing card's source |
| `github-social-preview.png` | 1280×640, for the repository's social preview |

The gaps between the letters and the trace are masks, not white strokes, so
the mark sits on any background. Keep clear space of half the O's width
around it; do not recolour it outside the pairs above.

## Changing it

```bash
brand/build.sh
```

Writes the SVGs from `mark.py` and copies the site's copies into `public/`.
It also renders the icons (`apple-touch-icon.png`, `icon-512.png`,
`favicon.ico`) with Inkscape and the sharing card (`public/og.png`, and the
GitHub preview) from `poster.html` with headless Chrome, for the real
fonts. The outputs are committed, so the site's build in CI needs none of
these tools.
