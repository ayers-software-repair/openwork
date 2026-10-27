#!/usr/bin/env bash
# Copyright Ayers Electronics Inc.
# Keep the release workflows wired to the shared, strict platform version action.
# The action validates release-tag grammar and separates display/marketing/build forms;
# this guard ensures each package stamp continues to use the correct output.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
require() {
  local file=$1 pattern=$2 description=$3
  if ! grep -Fq -- "$pattern" "$file"; then
    echo "MISSING: $description ($file)"
    fail=1
  fi
}
require_count() {
  local file=$1 pattern=$2 expected=$3 description=$4 actual
  actual=$(grep -Fc -- "$pattern" "$file" || true)
  if [ "$actual" -ne "$expected" ]; then
    echo "DRIFT: $description in $file (expected $expected, found $actual)"
    fail=1
  fi
}

RELEASE=.github/workflows/release.yml
IOS=.github/workflows/ios-submission.yml
ACTION='./_platform/codestyle/ci/actions/release-version'

echo "checking shared release-version action and all version stamp consumers"
# One canonical action call per independent workflow. The action rejects malformed tags and
# produces display, numeric, Windows, Debian, channel, and per-run build forms.
require_count "$RELEASE" "uses: $ACTION" 1 "release workflow must resolve version once"
require_count "$IOS" "uses: $ACTION" 1 "iOS workflow must resolve version once"
require "$RELEASE" 'id: version' 'release action step id'
require "$RELEASE" 'ref: ${{ inputs.tag || github.ref_name }}' 'release action tag input'
require "$RELEASE" 'prefix: howland-v' 'release action tag prefix'
require "$IOS" 'id: ver' 'iOS action step id'
require "$IOS" 'ref: ${{ inputs.tag }}' 'iOS action tag input'
require "$IOS" 'prefix: howland-v' 'iOS action tag prefix'

# The release preflight exports the action's display and build outputs, and desktop/Android
# package jobs consume those outputs instead of parsing a tag or using a package.json fallback.
require "$RELEASE" 'version: ${{ steps.version.outputs.display }}' 'release display output mapping'
require "$RELEASE" 'numeric: ${{ steps.version.outputs.version }}' 'release marketing output mapping'
require "$RELEASE" 'four: ${{ steps.version.outputs.four }}' 'release Windows version output mapping'
require "$RELEASE" 'build: ${{ steps.version.outputs.build }}' 'release build output mapping'
require_count "$RELEASE" 'RELEASE_VERSION: ${{ needs.preflight.outputs.version }}' 3 'desktop, Windows, and Android display stamps'
require "$RELEASE" '-c.extraMetadata.version="$VERSION"' 'NSIS wrapper retains the RC display version'
require_count "$RELEASE" 'WINDOWS_BUILD_VERSION: ${{ needs.preflight.outputs.four }}' 2 'Windows build and wrapper numeric version stamps'
require_count "$RELEASE" 'WINDOWS_BUILD: ${{ needs.preflight.outputs.build }}' 2 'Windows build and wrapper build-number stamps'
require "$RELEASE" 'RELEASE_NUMERIC_VERSION: ${{ needs.preflight.outputs.numeric }}' 'AppX Store version uses numeric marketing version'
require_count "$RELEASE" '-c.buildVersion="$WINDOWS_BUILD_VERSION"' 2 'Windows executable file-version stamps'
require_count "$RELEASE" '-c.buildNumber="$WINDOWS_BUILD"' 2 'Windows resource/package build-number stamps'
require "$RELEASE" 'APPX_STORE_VERSION="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.$WINDOWS_BUILD"' 'AppX package uses canonical Store major/minor/build mapping'
require "$RELEASE" '--win appx' 'AppX is packaged independently from NSIS display version'
require "$RELEASE" '-c.appx.setBuildNumber=false' 'AppX identity leaves Store revision at zero'
require "$RELEASE" '-c.extraMetadata.version="$APPX_STORE_VERSION"' 'AppX receives numeric Store package version'
require "$RELEASE" 'ANDROID_BUILD: ${{ needs.preflight.outputs.build }}' 'Android build number output'
require "$RELEASE" 'VERSION="$RELEASE_VERSION"' 'desktop/Windows display version stamp'
require "$RELEASE" 'versionName \"$VERSION\"' 'Android marketing/display stamp'
require "$RELEASE" 'versionCode $ANDROID_BUILD' 'Android monotonic build stamp'
# Prepared store metadata must keep the same display version and its independent Android build.
require "$RELEASE" 'VERSION: ${{ needs.preflight.outputs.version }}' 'prepared Android display version'
require "$RELEASE" 'ANDROID_BUILD: ${{ needs.preflight.outputs.build }}' 'prepared Android build number'

# iOS has its own action invocation/run number. Apple marketing version is numeric, display
# metadata retains the RC suffix, and both Xcode targets use the action's per-run build value.
require "$IOS" 'version: ${{ steps.ver.outputs.display }}' 'iOS display output mapping'
require "$IOS" 'marketing: ${{ steps.ver.outputs.version }}' 'iOS numeric marketing output mapping'
require "$IOS" 'ios_build: ${{ steps.ver.outputs.build }}' 'iOS CFBundleVersion output mapping'
require "$IOS" 'IOS_BUILD: ${{ steps.ver.outputs.build }}' 'iOS validates the shared action build'
require "$IOS" '[[ "$IOS_BUILD" =~ ^[1-9][0-9]{0,3}$ ]]' 'iOS accepts only Apple-valid one-part build numbers'
require "$IOS" "echo 'STAMP_VERSION=\${{ steps.ver.outputs.version }}' >> \"\$GITHUB_ENV\"" 'iOS numeric marketing stamp'
require "$IOS" "echo 'DISPLAY_VERSION=\${{ steps.ver.outputs.display }}' >> \"\$GITHUB_ENV\"" 'iOS full display stamp'
require_count "$IOS" 'MARKETING_VERSION="$STAMP_VERSION"' 2 'iOS Xcode marketing version stamps'
require_count "$IOS" 'CURRENT_PROJECT_VERSION="${{ steps.ver.outputs.build }}"' 2 'iOS Xcode build-number stamps'
require "$IOS" 'IOS_BUILD: ${{ needs.build-ios.outputs.ios_build }}' 'iOS receipt uses independent action build number'

if [ "$fail" -ne 0 ]; then
  echo "version derivation: DRIFTED"
  exit 1
fi
echo "version derivation: shared action outputs reach desktop, Android, and iOS stamp sites"
