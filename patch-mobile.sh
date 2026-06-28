#!/usr/bin/env bash
# Post-build patch for mobile responsiveness.
# Run after `wf build` to fix framework-generated CSS rules that break mobile layouts.
#
# Usage:  ./patch-mobile.sh
# Or:     wf build && ./patch-mobile.sh

CSS="styles.css"
if [ ! -f "$CSS" ]; then
    echo "✗ $CSS not found — run from project root after wf build"
    exit 1
fi

changes=0
tmp="${CSS}.tmp"
cp "$CSS" "$tmp"

# ── 1. Add --color-surface-alt to :root if missing ─────────────
if ! grep -q -- '--color-surface-alt' "$tmp"; then
    sed -i '' 's/\(--color-surface:[^;]*;\)/\1\
  --color-surface-alt: #F1F5F9;/' "$tmp"
    echo "✓ [1/5] Added --color-surface-alt to :root"
    changes=$((changes + 1))
else
    echo "• [1/5] --color-surface-alt already present"
fi

# ── 2. Replace .wf-row column stacking with wrap at 768px ──────
if grep -q '\.wf-row.*flex-direction: *column' "$tmp"; then
    sed -i '' '/\.wf-row.*flex-direction: *column/s/flex-direction: *column;/flex-wrap: wrap;/' "$tmp"
    echo "✓ [2/5] Replaced .wf-row column stacking with wrap"
    changes=$((changes + 1))
else
    echo "• [2/5] .wf-row column rule not found (already patched)"
fi

# ── 3a. h1 heading inside 768px media query — add !important ───
if grep -q 'h1\.wf-heading' "$tmp"; then
    sed -i '' '/h1\.wf-heading {/{
s/font-size: \([^!;]*\);/font-size: \1 !important; line-height: 1.2 !important;/
}' "$tmp"
    echo "✓ [3a] Added !important to h1.wf-heading"
    changes=$((changes + 1))
else
    echo "• [3a] h1.wf-heading not found"
fi

# ── 3b. h2 heading inside 768px media query — add !important ───
if grep -q 'h2\.wf-heading' "$tmp"; then
    sed -i '' '/h2\.wf-heading {/{
s/font-size: \([^!;]*\);/font-size: \1 !important; line-height: 1.25 !important;/
}' "$tmp"
    echo "✓ [3b] Added !important to h2.wf-heading"
    changes=$((changes + 1))
else
    echo "• [3b] h2.wf-heading not found"
fi

# ── 4. Fix .wf-container padding at 768px ──────────────────────
if grep -q '\.wf-container.*padding: *0 .*var(--spacing-sm)' "$tmp"; then
    sed -i '' '/\.wf-container.*padding: *0 .*var(--spacing-sm)/{
s/padding: *0 .*var(--spacing-sm);/max-width: 100% !important; padding: 0 16px;/
}' "$tmp"
    echo "✓ [4/5] Fixed .wf-container padding at 768px"
    changes=$((changes + 1))
else
    echo "• [4/5] .wf-container rule already patched"
fi

# ── 5. (REMOVED) The injected CSS from SiteNav.wf already handles
#    hiding .wf-navbar__links on mobile — no patch needed here.

# ── Write back ─────────────────────────────────────────────────
mv "$tmp" "$CSS"

if [ "$changes" -gt 0 ]; then
    echo "✓ Done — $changes patch(es) applied to $CSS"
else
    echo "• No changes needed — $CSS is already mobile-ready"
fi
