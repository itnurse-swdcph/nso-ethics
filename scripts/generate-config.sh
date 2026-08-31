#!/usr/bin/env bash
# Generates config.js at deploy time from environment variables.
# Run this in your CI/CD pipeline (GitHub Actions, Netlify build, etc.)
# right before publishing the site. Never commit the output.
#
# Required env vars:
#   NURSEPULSE_SUPABASE_URL
#   NURSEPULSE_SUPABASE_ANON_KEY
# Optional:
#   NURSEPULSE_ADMIN_FUNCTION   (default: verify-admin)

set -euo pipefail

: "${NURSEPULSE_SUPABASE_URL:?Missing NURSEPULSE_SUPABASE_URL}"
: "${NURSEPULSE_SUPABASE_ANON_KEY:?Missing NURSEPULSE_SUPABASE_ANON_KEY}"
ADMIN_FUNCTION="${NURSEPULSE_ADMIN_FUNCTION:-verify-admin}"

OUT_FILE="$(dirname "$0")/../config.js"

cat > "$OUT_FILE" <<EOF
// AUTO-GENERATED at deploy time by scripts/generate-config.sh — do not edit by hand,
// do not commit this file. See config.example.js for the shape.
window.NURSEPULSE_CONFIG = {
  supabaseUrl: '${NURSEPULSE_SUPABASE_URL}',
  supabaseAnonKey: '${NURSEPULSE_SUPABASE_ANON_KEY}',
  adminFunction: '${ADMIN_FUNCTION}',
  demoMode: false,
};
EOF

echo "Wrote $OUT_FILE"
