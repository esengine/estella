#!/bin/bash
set -e

cd "$(dirname "$0")/.."

BUILD_DIR=build-web

if [ -d "$BUILD_DIR" ]; then
    echo "Removing existing build directory..."
    rm -rf "$BUILD_DIR"
fi

exec "$(dirname "$0")/build-web.sh"
