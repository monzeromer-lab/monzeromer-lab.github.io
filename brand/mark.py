#!/usr/bin/env python3
"""The MO mark, as geometry.

Redrawn from the original raster: a serif M and an O in graphite, and a
blue circuit trace that runs out of the M's right stem past five nodes.
Every SVG under brand/ and the site's icons are written from here, so a
change to the mark is a change to these numbers, then `./build.sh`.

Coordinates are in a 880 x 500 drawing space; the viewBox crops to the
mark with a little room. The gaps between the letters and the trace are
masks, not white strokes, so the mark sits on any background.
"""
import math
import sys

# ── The palette (MO Systems) ─────────────────────────────────────────────
GRAPHITE = "#4C4D4F"        # graphite-800: the M and the O, on light
BLUE = "#2B5178"            # blue-800: the trace, on light
GRAPHITE_ON_DARK = "#E2E5E8"  # graphite-200
BLUE_ON_DARK = "#6A9BCB"      # blue-400

# ── The trace ────────────────────────────────────────────────────────────
TRACE = 13                  # stroke width of a trace
NODE_R = 20                 # radius of a node, to the middle of its ring
NODE_RING = 12              # ring width
GAP = 5                     # clear space the letters keep from the trace

NODES = {"a": (388, 246), "b": (532, 246), "c": (206, 386), "d": (322, 404), "e": (246, 456)}
JUNCTION = (296, 368)

# ── The O ────────────────────────────────────────────────────────────────
O_CENTRE, O_OUTER, O_INNER = (640, 250), 205, 127

# ── The M ────────────────────────────────────────────────────────────────
V_POINT = (300, 352)                             # the bottom of the V
THIN_TOP_L, THIN_TOP_R = (397, 62), (421, 70)    # thin diagonal into the right stem
THICK_TOP = (106, 206)                           # x range of the heavy diagonal at y=60
FOOT_CUT = ((400, 322), (466, 284))              # slanted top of the blue foot

VIEWBOX = (30, 37, 823, 454)


def _toward(p, q, d):
    dx, dy = q[0] - p[0], q[1] - p[1]
    n = math.hypot(dx, dy)
    return (p[0] + dx / n * d, p[1] + dy / n * d)


def _meet(p1, d1, p2, d2):
    det = d1[0] * -d2[1] - d1[1] * -d2[0]
    t = ((p2[0] - p1[0]) * -d2[1] - (p2[1] - p1[1]) * -d2[0]) / det
    return (p1[0] + t * d1[0], p1[1] + t * d1[1])


def _f(p):
    return f"{p[0]:.1f} {p[1]:.1f}"


def _trace_path(node_r=None):
    node_r = node_r or NODE_R
    n = NODES
    # (from, to, end at a node's ring?) for each end
    segs = [
        (n["a"], n["b"], True, True),
        (n["a"], JUNCTION, True, False),
        (JUNCTION, n["c"], False, True),
        (n["e"], JUNCTION, True, False),
        (n["d"], (436, 304), True, False),
    ]
    out = []
    for p, q, tp, tq in segs:
        a = _toward(p, q, node_r) if tp else p
        b = _toward(q, p, node_r) if tq else q
        out.append(f"M{_f(a)}L{_f(b)}")
    return "".join(out)


def _m_path():
    d_thin = (THIN_TOP_R[0] - V_POINT[0], THIN_TOP_R[1] - V_POINT[1])
    notch = _meet((THICK_TOP[1], 60), (118, 250), THIN_TOP_L, d_thin)
    return (
        f"M{THICK_TOP[0]} 60H{THICK_TOP[1]}L{_f(notch)}L{_f(THIN_TOP_L)}L{_f(THIN_TOP_R)}L{_f(V_POINT)}Z"
        "M72 60H134V446H72Z"            # left stem
        "M38 52H182V72H38Z"             # left top serif
        "M38 428H164V446H38Z"           # left foot serif
        f"M400 60H466V{FOOT_CUT[1][1] - 18}L400 {FOOT_CUT[0][1] - 18}Z"  # right stem, above the foot
        "M372 52H494V72H372Z"           # right top serif
    )


def _ring(c, r):
    x, y = c
    return f"M{x - r} {y}a{r} {r} 0 1 0 {2 * r} 0a{r} {r} 0 1 0 {-2 * r} 0Z"


def mark(graphite, blue, *, ids="mo", style="", viewbox=VIEWBOX, size=None,
         trace=TRACE, node_r=NODE_R, ring=NODE_RING, tile=None, tile_radius=0):
    """The mark as an SVG document. `graphite`/`blue` may be colours or
    `currentColor`; `style` is an optional <style> body (for a favicon that
    follows the browser's theme, give the classes `g` and `b` colours)."""
    tp = _trace_path(node_r)
    halo_w = trace + 2 * GAP
    halo_nodes = "".join(
        f'<circle cx="{x}" cy="{y}" r="{node_r + ring / 2 + GAP}"/>' for x, y in NODES.values()
    )
    nodes = "".join(f'<circle cx="{x}" cy="{y}" r="{node_r}"/>' for x, y in NODES.values())
    foot = f"M{FOOT_CUT[0][0]} {FOOT_CUT[0][1]}L{FOOT_CUT[1][0]} {FOOT_CUT[1][1]}V446H{FOOT_CUT[0][0]}Z"
    o = _ring(O_CENTRE, O_OUTER) + _ring(O_CENTRE, O_INNER)
    vb = " ".join(str(v) for v in viewbox)
    dims = f' width="{size[0]}" height="{size[1]}"' if size else ""
    g_attr = 'class="g"' if style else f'fill="{graphite}"'
    b_fill = 'class="b"' if style else f'fill="{blue}"'
    b_stroke = 'class="bs"' if style else f'stroke="{blue}"'
    style_el = f"<style>{style}</style>" if style else ""
    if tile:
        x, y, w, h = viewbox
        style_el += f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{tile_radius}" fill="{tile}"/>'
    cut_trace = (
        f'<path d="{tp}" stroke="#000" stroke-width="{halo_w}" stroke-linecap="round" fill="none"/>'
        f'<g fill="#000">{halo_nodes}</g>'
    )
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}"{dims} role="img" aria-label="MO">
<title>MO</title>{style_el}
<defs>
<mask id="{ids}-m" maskUnits="userSpaceOnUse" x="0" y="0" width="900" height="520"><rect width="900" height="520" fill="#fff"/><circle cx="{O_CENTRE[0]}" cy="{O_CENTRE[1]}" r="{O_OUTER + GAP + 2}" fill="#000"/>{cut_trace}</mask>
<mask id="{ids}-o" maskUnits="userSpaceOnUse" x="0" y="0" width="900" height="520"><rect width="900" height="520" fill="#fff"/>{cut_trace}</mask>
</defs>
<g mask="url(#{ids}-m)"><path {g_attr} d="{_m_path()}"/><path {b_fill} d="{foot}"/></g>
<path mask="url(#{ids}-o)" {g_attr} fill-rule="evenodd" d="{o}"/>
<path {b_stroke} d="{tp}" stroke-width="{trace}" stroke-linecap="round" fill="none"/>
<g {b_stroke} fill="none" stroke-width="{ring}">{nodes}</g>
</svg>
"""


SURFACE_DARK = "#17191C"     # surface, dark theme: the icon tile


def icon(size=None):
    """The app and tab icon: a square dark tile with the mark across it."""
    vb = square(pad=0.07)
    return mark(GRAPHITE_ON_DARK, BLUE_ON_DARK, viewbox=vb, size=size, ids="mo-icon",
                trace=20, node_r=22, ring=17, tile=SURFACE_DARK, tile_radius=round(vb[2] * 0.2))


def square(viewbox=VIEWBOX, pad=0.0):
    """A square viewBox around the mark, with `pad` of its width on each side."""
    x, y, w, h = viewbox
    side = w * (1 + 2 * pad)
    cx, cy = x + w / 2, y + h / 2
    return (round(cx - side / 2, 1), round(cy - side / 2, 1), round(side, 1), round(side, 1))


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    files = {
        "mo-logo.svg": mark(GRAPHITE, BLUE),
        "mo-logo-on-dark.svg": mark(GRAPHITE_ON_DARK, BLUE_ON_DARK),
        "mo-logo-mono.svg": mark("currentColor", "currentColor"),
        # Icons: the mark on a dark tile, with a heavier trace so it still
        # reads at 16px. The tile keeps it legible on light and dark tab bars.
        "favicon.svg": icon(),
    }
    for name, svg in files.items():
        with open(f"{out}/{name}", "w") as fh:
            fh.write(svg)
        print(f"{out}/{name}")
