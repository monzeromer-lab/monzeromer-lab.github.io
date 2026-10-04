#!/usr/bin/env python3
"""The MO mark, as geometry.

A geometric M and O in graphite, drawn on MO Systems' 4px grid at the
weight Inter has at display size. The O overlaps the M's right stem and cuts
into it, as in the original mark. Below the cut the stem turns blue, and
leaves the letter as a circuit trace — along, then up at 45°, the angle every
trace in the system takes — into a ringed node at the centre of the O.
Graphite is structure, blue is intent.

Every SVG under brand/ and the site's icons are written from here, so a
change to the mark is a change to these numbers, then `brand/build.sh`.

The clear space between the letters, and between a letter and the trace,
is a mask, not a white stroke, so the mark sits on any background.
"""
import sys

# ── The palette (MO Systems) ─────────────────────────────────────────────
GRAPHITE = "#4C4D4F"          # graphite-800, on light
BLUE = "#2B5178"              # blue-800, on light
GRAPHITE_ON_DARK = "#E2E5E8"  # graphite-200
BLUE_ON_DARK = "#6A9BCB"      # blue-400
SURFACE_DARK = "#17191C"      # surface, dark: the icon's tile

# ── Grid and weights ─────────────────────────────────────────────────────
TOP, BASE = 8, 120            # cap height 112, on the 4px grid
STROKE = 20                   # the letters' weight
TRACE = 8                     # a trace's width
NODE_R = 9                    # a node's radius, to the middle of its ring
GAP = 6                       # clear space around the trace and the O

# ── The M ────────────────────────────────────────────────────────────────
# One mitred stroke — stem, diagonal, diagonal, stem — clipped flat to the
# cap height and the baseline, so the joins are sharp and the ends square.
M_BOX = (8, TOP, 120, BASE)   # left, top, right, bottom
M_STROKE = "M18 140V20L64 100L110 20V140"
# The right stem turns blue below a 45° cut; GAP apart, measured vertically.
GRAPHITE_PART = "M0 0H130V62L88 104V140H0Z"
BLUE_FOOT = "M88 110L130 68V140H88Z"

# ── The O ────────────────────────────────────────────────────────────────
O_CENTRE = (174, 64)
O_OUTER = 56                  # as tall as the M
O_INNER = O_OUTER - STROKE
O_CLEAR = O_OUTER + GAP       # how far the O cuts into the M

# ── The trace ────────────────────────────────────────────────────────────
# Out of the blue foot, along, up at 45° into the node at the O's centre.
TRACE_START = (102, 104)
TRACE_ELBOW = (134, 104)

VIEWBOX = (0, 0, 236, 128)


def _ring(c, r):
    x, y = c
    return f"M{x - r} {y}a{r} {r} 0 1 0 {2 * r} 0a{r} {r} 0 1 0 {-2 * r} 0Z"


def _trace(node_r):
    """The trace's path, ending at the node's ring."""
    cx, cy = O_CENTRE
    d = node_r / 2 ** 0.5
    return (f"M{TRACE_START[0]} {TRACE_START[1]}H{TRACE_ELBOW[0]}"
            f"L{cx - d:.1f} {cy + d:.1f}")


def mark(graphite, blue, *, ids="mo", viewbox=VIEWBOX, size=None, trace=TRACE,
         node_r=NODE_R, tile=None, tile_radius=0, title=True):
    """The mark as an SVG document. `graphite` and `blue` are colours (or
    `currentColor`); `tile` puts it on a rounded square of that colour."""
    x0, y0, w, h = viewbox
    vb = f"{x0:g} {y0:g} {w:g} {h:g}"
    dims = f' width="{size[0]}" height="{size[1]}"' if size else ""
    cx, cy = O_CENTRE
    path = _trace(node_r)
    clear_trace = (f'<path d="{path}" stroke="#000" stroke-width="{trace + 2 * GAP}" fill="none" '
                   f'stroke-linejoin="round"/>'
                   f'<circle cx="{cx}" cy="{cy}" r="{node_r + trace / 2 + GAP}" fill="#000"/>')
    clear_o = f'<circle cx="{cx}" cy="{cy}" r="{O_CLEAR}" fill="#000"/>'

    def mask(name, cut):
        return (f'<mask id="{ids}-{name}" maskUnits="userSpaceOnUse" x="{x0:g}" y="{y0:g}" '
                f'width="{w:g}" height="{h:g}"><rect x="{x0:g}" y="{y0:g}" width="{w:g}" '
                f'height="{h:g}" fill="#fff"/>{cut}</mask>')

    l, t, r, b = M_BOX
    stroke = (f'd="{M_STROKE}" stroke-width="{STROKE}" fill="none" '
              f'stroke-miterlimit="10"')
    tile_el = (f'<rect x="{x0:g}" y="{y0:g}" width="{w:g}" height="{h:g}" '
               f'rx="{tile_radius:g}" fill="{tile}"/>' if tile else "")
    title_el = "<title>MO</title>" if title else ""
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}"{dims} role="img" aria-label="MO">{title_el}
<defs>
<clipPath id="{ids}-box"><rect x="{l}" y="{t}" width="{r - l}" height="{b - t}"/></clipPath>
<clipPath id="{ids}-graphite"><path d="{GRAPHITE_PART}"/></clipPath>
<clipPath id="{ids}-foot"><path d="{BLUE_FOOT}"/></clipPath>
{mask("m", clear_trace + clear_o)}
{mask("foot", clear_o)}
{mask("o", clear_trace)}
</defs>{tile_el}
<g clip-path="url(#{ids}-box)">
<g mask="url(#{ids}-m)"><path clip-path="url(#{ids}-graphite)" stroke="{graphite}" {stroke}/></g>
<g mask="url(#{ids}-foot)"><path clip-path="url(#{ids}-foot)" stroke="{blue}" {stroke}/></g>
</g>
<path mask="url(#{ids}-o)" fill="{graphite}" fill-rule="evenodd" d="{_ring(O_CENTRE, O_OUTER)}{_ring(O_CENTRE, O_INNER)}"/>
<path d="{path}" stroke="{blue}" stroke-width="{trace}" fill="none" stroke-linejoin="round"/>
<circle cx="{cx}" cy="{cy}" r="{node_r}" fill="none" stroke="{blue}" stroke-width="{trace}"/>
</svg>
"""


def icon(size=None):
    """The app and tab icon: the mark on a dark tile, with a heavier trace
    and node so it still reads at 16px."""
    x, y, w, h = VIEWBOX
    side = w * 1.18
    vb = (x + w / 2 - side / 2, y + h / 2 - side / 2, side, side)
    return mark(GRAPHITE_ON_DARK, BLUE_ON_DARK, viewbox=vb, size=size, ids="mo-icon",
                trace=12, node_r=10, tile=SURFACE_DARK, tile_radius=side * 0.22)


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    files = {
        "mo-logo.svg": mark(GRAPHITE, BLUE),
        "mo-logo-on-dark.svg": mark(GRAPHITE_ON_DARK, BLUE_ON_DARK),
        "mo-logo-mono.svg": mark("currentColor", "currentColor"),
        "favicon.svg": icon(),
    }
    for name, svg in files.items():
        with open(f"{out}/{name}", "w") as fh:
            fh.write(svg)
        print(f"{out}/{name}")
