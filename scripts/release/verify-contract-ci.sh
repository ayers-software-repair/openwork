#!/usr/bin/env bash
# Copyright Ayers Electronics Inc. All rights reserved.
set -euo pipefail
: "${GITHUB_REPOSITORY:?}" "${GITHUB_SHA:?}" "${GH_TOKEN:?}" "${SELECTED_TAG:?}"
[[ "$SELECTED_TAG" =~ ^howland-v[0-9]+\.[0-9]+\.[0-9]+(-rc\.[1-9][0-9]*)?$ ]] || { echo '::error::invalid selected tag'; exit 1; }
SOURCE_SHA=$(git rev-parse HEAD)
[ "$SOURCE_SHA" = "$GITHUB_SHA" ] || { echo '::error::checkout does not match workflow source SHA'; exit 1; }
if [ "${GITHUB_REF_TYPE:-}" = tag ]; then
  [ "${GITHUB_REF_NAME:-}" = "$SELECTED_TAG" ] || { echo '::error::selected tag differs from triggering tag'; exit 1; }
fi
# An existing remote tag must point at this checkout; a fresh dispatch may create it later.
if remote_tag=$(git ls-remote --exit-code origin "refs/tags/$SELECTED_TAG" "refs/tags/$SELECTED_TAG^{}"); then
  tag_sha=$(printf '%s\n' "$remote_tag" | awk -F '\t' -v tag="refs/tags/$SELECTED_TAG" '
    $2 == tag { base = $1 }
    $2 == tag "^{}" { peeled = $1 }
    END { print peeled != "" ? peeled : base }
  ')
  [ -n "$tag_sha" ] || { echo '::error::selected tag lookup returned no tag'; exit 1; }
  [ "$tag_sha" = "$SOURCE_SHA" ] || { echo '::error::selected tag points at a different source'; exit 1; }
else
  status=$?
  [ "$status" -eq 2 ] || { echo '::error::could not inspect selected tag'; exit 1; }
fi

runs=$(gh api "repos/$GITHUB_REPOSITORY/actions/workflows/contract.yml/runs?head_sha=$SOURCE_SHA&event=push&branch=howland&per_page=100")
run=$(jq -ce --arg repo "$GITHUB_REPOSITORY" --arg sha "$SOURCE_SHA" '
  .workflow_runs
  | map(select(.head_sha == $sha and .event == "push" and .head_branch == "howland"
    and .path == ".github/workflows/contract.yml" and .head_repository.full_name == $repo))
  | sort_by(.id) | last // empty
' <<< "$runs") || { echo "::error::no exact-source contract push run for $SOURCE_SHA"; exit 1; }
run_id=$(jq -er '.id | select(type == "number" and . > 0)' <<< "$run")
if ! jq -e '.status == "completed" and .conclusion == "success"' <<< "$run" >/dev/null; then
  echo "::error::latest exact-source contract run $run_id has not passed"
  exit 1
fi

jobs=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$run_id/jobs?filter=latest&per_page=100")
if ! jq -e '.total_count == (.jobs | length) and (.jobs | length) > 0
  and ([.jobs[] | select(.name == "contract" and .status == "completed" and .conclusion == "success")] | length) == 1
  and all(.jobs[]; .status == "completed" and .conclusion == "success")' <<< "$jobs" >/dev/null; then
  echo "::error::exact-source contract run $run_id has missing, incomplete or failed jobs"
  exit 1
fi
printf 'Exact-source contract proof: run %s (%s)\n' "$run_id" "$GITHUB_SHA"
