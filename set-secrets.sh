#!/bin/bash
# Sets all required secrets on the urcades Worker.
# Run this once from the repo root: bash set-secrets.sh
# You'll be prompted for each value. Paste and press Enter.

set -e

WORKER="urcades"

echo ""
echo "Setting secrets for Worker: $WORKER"
echo "Paste the value for each secret and press Enter."
echo "The input is hidden for security."
echo ""

secrets=(
  GITHUB_TOKEN
  TELEGRAM_BOT_TOKEN
  WHITELISTED_USERS
  BLUESKY_HANDLE
  BLUESKY_APP_PASSWORD
  BLUESKY_PDS_URL
  ARENA_ACCESS_TOKEN
  ARENA_CHANNEL_SLUG
  GOTOSOCIAL_URL
  GOTOSOCIAL_ACCESS_TOKEN
)

for secret in "${secrets[@]}"; do
  echo -n "→ $secret: "
  read -rs value
  echo ""
  if [ -n "$value" ]; then
    echo "$value" | npx wrangler secret put "$secret" --name "$WORKER"
  else
    echo "  (skipped — empty value)"
  fi
done

# OVERLAND_TOKEN is hardcoded since it was already provided
echo "→ Setting OVERLAND_TOKEN..."
echo "8723282b1f7ddc4b9d43461b126cf9c227ee92eb5e992a3997aa282bfb65b531" | npx wrangler secret put OVERLAND_TOKEN --name "$WORKER"

echo ""
echo "Done! All secrets set on '$WORKER'."
echo "You can now run: npm run deploy"
