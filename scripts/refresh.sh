#!/usr/bin/env bash
# Only for disposable GitHub Actions checkouts, never a user's worktree.
set -uo pipefail
if [[ "${GITHUB_ACTIONS:-}" != "true" ]]; then
  echo "This script requires a disposable GitHub Actions checkout." >&2
  exit 2
fi
if (( $# > 1 )) || { (( $# == 1 )) && [[ "$1" != "--skip-meta" ]]; }; then
  echo "Usage: bash scripts/refresh.sh [--skip-meta]" >&2
  exit 2
fi
git config user.name "squad-bot" || exit 1
git config user.email "squad-bot@users.noreply.github.com" || exit 1
attempt() {
  local fetch_status=0 diff_status=0
  git fetch --no-tags origin '+refs/heads/main:refs/remotes/origin/main' || return 1
  git checkout --force -B main refs/remotes/origin/main || return 1
  git clean -fd -- docs/data || return 1
  python scripts/fetch.py "$@" || fetch_status=$?
  git add -- docs/data || return 1
  git diff --cached --quiet || diff_status=$?
  if (( diff_status > 1 )); then return 1; fi
  if (( diff_status == 1 )); then
    git commit -m "data: update $(date -u +%Y-%m-%dT%H:%MZ)" || return 1
    git push origin HEAD:main || return 1
  fi
  return "$fetch_status"
}
for refresh_attempt in 1 2; do
  if attempt "$@"; then exit 0; fi
  if (( refresh_attempt == 1 )); then
    echo "::warning::Refresh or publication failed. Retrying from latest main in five minutes."
    sleep 300 || exit 1
  fi
done
echo "::error::Refresh failed after two complete attempts. Successful datasets may already be published."
exit 1
