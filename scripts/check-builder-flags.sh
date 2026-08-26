#!/usr/bin/env bash
# Copyright Ayers Electronics Inc. All rights reserved.
#
# EVERY -c.<path> OVERRIDE IN release.yml IS A REAL electron-builder OPTION, CHECKED AGAINST THE
# INSTALLED SCHEMA RATHER THAN AGAINST MEMORY.
#
# Why this exists. Three override names were written from plausibility instead of from the type
# definitions, and the third one — `-c.linux.license` — failed the ENTIRE desktop family: six legs,
# two of them after eight minutes of runner setup, zero assets published. electron-builder
# validates the merged config before it does any platform work, so an invalid NAME is not a
# degraded build, it is no build at all.
#
# The names are easy to get wrong because they are plausible. `license` IS an electron-builder
# option — on AppImageOptions and FlatpakOptions, taking a path to a file — just not on `linux`,
# and not as a string. Plausible-but-absent is the whole failure mode, and it is exactly what a
# human reviewer waves through.
#
# WHAT THIS CANNOT DO: it checks that a name EXISTS on the interface it is addressed to. It cannot
# check that the VALUE is the right shape — `linux.license` would have passed a name-only check on
# AppImage while still being a licence string where a filename belongs. Stated because a guard
# whose limits are unwritten gets trusted past them.
set -euo pipefail

cd "$(dirname "$0")/.."

WF=".github/workflows/release.yml"
SCHEMA_DIR=$(find node_modules/.pnpm -maxdepth 6 -type d -path "*app-builder-lib@25*/node_modules/app-builder-lib/out/options" 2>/dev/null | head -1)

if [ -z "$SCHEMA_DIR" ]; then
  echo "check-builder-flags: app-builder-lib is not installed — run 'pnpm install' first." >&2
  echo "  Refusing to report a result: with no schema this check cannot fail, and a check that" >&2
  echo "  cannot fail reads exactly like a check that passed." >&2
  exit 2
fi

python3 - "$WF" "$SCHEMA_DIR" <<'PY'
import re, sys, pathlib

wf, schema_dir = sys.argv[1], pathlib.Path(sys.argv[2])

# Every interface -> its declared property names, across the option files.
props: dict[str, set] = {}
for f in schema_dir.glob("*.d.ts"):
    cur = None
    for line in f.read_text().splitlines():
        m = re.match(r"\s*export interface (\w+)", line)
        if m:
            cur = m.group(1)
            props.setdefault(cur, set())
            # Inherited members count: DebOptions extends LinuxTargetSpecificOptions extends
            # CommonLinuxOptions, and a name valid on a parent is valid on the child.
            for parent in re.findall(r"[\w]+", line.split("extends")[1]) if "extends" in line else []:
                props.setdefault(cur, set()).add("@" + parent)
            continue
        m = re.match(r"\s*readonly (\w+)\??:", line)
        if m and cur:
            props[cur].add(m.group(1))

def resolve(iface, seen=None):
    seen = seen or set()
    if iface in seen or iface not in props:
        return set()
    seen.add(iface)
    out = set()
    for p in props[iface]:
        out |= resolve(p[1:], seen) if p.startswith("@") else {p}
    return out

# Where each -c. prefix lands in the schema. Anything not listed is checked no further than its
# existence as a known prefix, which is deliberate: an unknown PREFIX is the loud failure.
ROOTS = {
    "linux": "LinuxConfiguration",
    "deb": "DebOptions",
    "appImage": "AppImageOptions",
    "mac": "MacConfiguration",
    "win": "WindowsConfiguration",
    "nsis": "NsisOptions",
}
# Top-level Configuration keys used as bare -c.<name>; these are not in the linux option files.
TOP_LEVEL = {
    "productName", "appId", "artifactName", "copyright", "extraMetadata", "publish",
    "directories", "files", "extraResources", "asar", "npmRebuild", "buildVersion",
}

bad = []
checked = 0
for flag in re.findall(r"-c\.([A-Za-z0-9_.]+)=", pathlib.Path(wf).read_text()):
    checked += 1
    parts = flag.split(".")
    head = parts[0]
    if head in ROOTS:
        if len(parts) < 2:
            continue
        iface = ROOTS[head]
        valid = resolve(iface)
        if not valid:
            bad.append(f"{flag}: cannot resolve interface {iface} — the schema layout changed")
        elif parts[1] not in valid:
            near = sorted(n for n in valid if n.lower().startswith(parts[1][:3].lower()))
            hint = f"  did you mean: {', '.join(near)}" if near else ""
            bad.append(f"-c.{flag} — '{parts[1]}' is not a property of {iface}.{hint}")
    elif head not in TOP_LEVEL:
        bad.append(f"-c.{flag} — '{head}' is not a known top-level option or platform prefix")

if bad:
    print("check-builder-flags: FAILED", file=sys.stderr)
    for b in bad:
        print("  " + b, file=sys.stderr)
    print("\n  electron-builder validates the merged config BEFORE any platform work, so an\n"
          "  invalid name fails EVERY leg and publishes nothing.", file=sys.stderr)
    sys.exit(1)

print(f"check-builder-flags: {checked} override names valid against app-builder-lib")
PY
