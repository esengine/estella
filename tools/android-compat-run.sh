#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#
# Install and measure every packaged canary on the emulator that is already up.
#
# This is a FILE, and not the workflow's `script:` input, because
# reactivecircus/android-emulator-runner executes that input one line at a time
# as separate `sh -c` invocations. A loop cannot survive it — `for apk in ...; do`
# arrives alone and dies with "end of file unexpected (expecting done)" — and
# nothing assigned on one line is visible on the next. The one-line workarounds
# (a folded `>-` scalar, or `sh -c` with an embedded newline) both put shell
# syntax somewhere it cannot be run or tested; a file can be run by hand.
#
#   tools/android-compat-run.sh <api-level>
#
# Every APK is attempted even after one fails, because which versions work is the
# entire output: stopping at the first break would report the oldest failure and
# hide every version above it.
set -euo pipefail

API="${1:?usage: android-compat-run.sh <api-level> [out-dir]}"

# Resolved from this file, not from the caller's cwd: being runnable by hand is
# the reason it is a file at all, and a relative `tools/...` only works from the
# repository root.
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
OUT="${2:-$ROOT/build/compat}"

mkdir -p "$OUT"

shopt -s nullglob
APKS=("$ROOT"/apks/*.apk)
if [ ${#APKS[@]} -eq 0 ]; then
    echo "::error::no APKs in $ROOT/apks — the packaging job produced nothing to install"
    exit 1
fi

rc=0
for apk in "${APKS[@]}"; do
    name=$(basename "$apk" .apk)
    label="api${API}-${name}"
    echo "::group::${label}"
    # --no-frame-judge: the frame is for a human to look at. The gate is install +
    # `ready` + no recorded error.
    node "$ROOT/tools/verify-native-boot.mjs" \
        --platform android --apk "$apk" \
        --label "$label" --no-frame-judge \
        --out "$OUT" \
        --metrics-out "${OUT}/${label}.json" || rc=$?
    echo "::endgroup::"
done

exit "$rc"
