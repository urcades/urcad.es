#!/bin/bash
# Sets required secrets on the urcades Worker.
# Run from the repo root: bash scripts/set-secrets.sh

set -e

WORKER="urcades"

echo ""
echo "Setting secrets for Worker: $WORKER"
echo "Paste the Overland token and press Enter. Input is hidden."
echo ""

printf "OVERLAND_TOKEN: "
read -rs overland_token
echo ""

if [ -z "$overland_token" ]; then
  echo "OVERLAND_TOKEN is required; no secrets were changed."
  exit 1
fi

printf "%s" "$overland_token" | npx wrangler secret put OVERLAND_TOKEN --name "$WORKER"

echo ""
echo "Done. Required Worker secrets are set on '$WORKER'."
echo "You can now run: npm run deploy"
