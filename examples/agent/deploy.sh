#!/usr/bin/env bash
# Publish a folder to Marsa and print the link.
# Usage: MARSA_URL=http://localhost:8080 ./deploy.sh <folder> [ttlHours]
set -euo pipefail
DIR="${1:?usage: deploy.sh <folder> [ttlHours]}"
TTL="${2:-24}"
URL="${MARSA_URL:-http://localhost:8080}"
ZIP="$(mktemp -t marsa-XXXXXX).zip"
trap 'rm -f "$ZIP"' EXIT
(cd "$DIR" && zip -qr "$ZIP" .)
RESP="$(curl -sS -X POST "$URL/api/sites?ttlHours=$TTL" -H "Content-Type: application/zip" --data-binary @"$ZIP")"
if command -v jq >/dev/null; then
  echo "$RESP" | jq -e .url >/dev/null || { echo "$RESP" >&2; exit 1; }
  echo "url:       $(echo "$RESP" | jq -r .url)"
  echo "expires:   $(echo "$RESP" | jq -r .expiresAt)"
  echo "id:        $(echo "$RESP" | jq -r .id)"
  echo "editToken: $(echo "$RESP" | jq -r .editToken)   (keep it private)"
else
  echo "$RESP"
fi
