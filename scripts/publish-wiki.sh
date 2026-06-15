#!/usr/bin/env bash
#
# Publish the Markdown under wiki/ to this repo's GitHub Wiki.
#
# Prerequisite (one-time): the wiki repo only exists after you create the first
# page in the GitHub UI. Go to the repo's "Wiki" tab → "Create the first page"
# → Save. After that, this script can push to it.
#
# Usage:
#   scripts/publish-wiki.sh
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WIKI_SRC="$REPO_ROOT/wiki"

# Derive the wiki remote from this repo's origin (…/repo.git -> …/repo.wiki.git).
ORIGIN_URL="$(git -C "$REPO_ROOT" remote get-url origin)"
WIKI_URL="${ORIGIN_URL%.git}.wiki.git"

if [ ! -d "$WIKI_SRC" ]; then
  echo "No wiki/ directory found at $WIKI_SRC" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Cloning wiki: $WIKI_URL"
if ! git clone "$WIKI_URL" "$TMP_DIR" 2>/dev/null; then
  echo "Could not clone the wiki repo. Create the first wiki page in the" >&2
  echo "GitHub UI (repo → Wiki tab → Create the first page), then re-run." >&2
  exit 1
fi

# Sync wiki/*.md into the wiki working copy (overwrite, keep .git).
cp "$WIKI_SRC"/*.md "$TMP_DIR"/

cd "$TMP_DIR"
git add -A
if git diff --cached --quiet; then
  echo "Wiki already up to date — nothing to publish."
  exit 0
fi

git commit -m "Update wiki from repo wiki/ source"
git push
echo "Wiki published."
