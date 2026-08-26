#!/usr/bin/env bash
# Copyright Ayers Electronics Inc. All rights reserved.
#
# THE VERSION DERIVATION IS COPIED FOUR TIMES AND NOTHING KEPT THE COPIES HONEST.
#
# release.yml stamps it three times (desktop build, android build, the publish job's tag_name)
# and ios-submission.yml a fourth. A comment in release.yml says they are identical and records
# that TWO DRIFTED VARIANTS ONCE COEXISTED - latent only because the tag filter is howland-v*
# alone, so nothing exercised the disagreement. A widened filter would have had desktop and
# mobile stamp different versions from one tag, and the published tag_name would have matched
# neither.
#
# WHY A CHECK RATHER THAN A SHARED JOB. The obvious fix is one job with an output, or a composite
# action for the cross-workflow case. Both are the right long-term shape and both are UNTESTABLE
# here: GitHub Actions is unfunded, so a restructured release workflow could not be run before the
# one budget-day run it exists to serve. A drift check closes the defect that actually bit -
# copies disagreeing - costs nothing at release time, and can be run right now on this machine.
# When Actions is funded and a run is cheap, the composite action supersedes this.
#
# Usage: scripts/check-version-derivation.sh
set -euo pipefail

cd "$(dirname "$0")/.."

# The canonical body, written once here. Every site must contain it verbatim.
read -r -d '' CANON <<'EOF' || true
case "$VERSION" in
*[!0-9.]*|"") VERSION=1.0.0 ;;
[0-9]*.[0-9]*.[0-9]*) ;;
*) VERSION=1.0.0 ;;
esac
EOF

SED_LINE="VERSION=\$(echo \"\$RAW_TAG\" | sed -E 's/^(howland-(mobile-)?)?v?//')"

fail=0
total=0

# Normalise a file's version blocks: strip leading whitespace and trailing comments, so the
# comparison is about the LOGIC and not about how deeply a step happens to be indented.
normalise() {
  sed -E 's/^[[:space:]]+//; s/[[:space:]]+#.*$//' "$1"
}

echo "checking version derivation is identical across every stamp site"

for f in .github/workflows/release.yml .github/workflows/ios-submission.yml; do
  [ -f "$f" ] || { echo "  MISSING $f - a stamp site moved; this check moves with it"; fail=1; continue; }
  body=$(normalise "$f")

  # Count the case blocks by their first and last lines appearing in order.
  n=$(printf '%s\n' "$body" | grep -c '^\*\[!0-9\.\]\*|"") VERSION=1\.0\.0 ;;$' || true)
  s=$(printf '%s\n' "$body" | grep -cF "sed -E 's/^(howland-(mobile-)?)?v?//'" || true)

  echo "  $f: $n fallback blocks, $s sed derivations"
  total=$((total + n))

  if [ "$n" -ne "$s" ]; then
    echo "    MISMATCH: $s sites derive a version but only $n normalise it."
    echo "    A site that derives without the fallback accepts a malformed tag verbatim."
    fail=1
  fi

  # Every fallback block must be the canonical one, character for character after normalising.
  got=$(printf '%s\n' "$body" | grep -A 4 '^case "\$VERSION" in$' | grep -v '^--$' || true)
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    case "$line" in
      'case "$VERSION" in'|'esac'|'*[!0-9.]*|"") VERSION=1.0.0 ;;'|'[0-9]*.[0-9]*.[0-9]*) ;;'|'*) VERSION=1.0.0 ;;')
        ;;
      *)
        echo "    DRIFT: unexpected line inside a version fallback: $line"
        fail=1
        ;;
    esac
  done <<< "$got"
done

if [ "$total" -lt 4 ]; then
  echo "  only $total stamp sites found, expected at least 4 (release.yml x3, ios-submission x1)."
  echo "  Either a site was removed - in which case update this check deliberately - or a site"
  echo "  stopped using the canonical form and is no longer being counted, which is the drift"
  echo "  this exists to catch."
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "version derivation: DRIFTED"
  exit 1
fi
echo "version derivation: consistent across $total stamp sites"
