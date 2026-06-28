#!/bin/sh
# Build script for Monzer Omer portfolio
# Runs wf build then appends custom responsive overrides

set -e
cd "$(dirname "$0")"

echo "🔨 Running wf build..."
wf build

echo "📱 Appending custom responsive overrides..."
cat responsive-overrides.css >> styles.css

echo "✅ Build complete with mobile responsiveness"
