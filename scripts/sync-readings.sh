#!/bin/bash
set -e

# Sync reading highlights from readingsync CLI tool

if ! command -v readingsync &> /dev/null; then
    echo "Error: readingsync not installed."
    echo "Install it from: https://github.com/urcades/readingsync"
    exit 1
fi

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_PATH="$PROJECT_ROOT/src/data/readings.json"

# Run readingsync with output path
readingsync --output "$OUTPUT_PATH" --pretty

echo "Readings synced to src/data/readings.json at $(date)"
