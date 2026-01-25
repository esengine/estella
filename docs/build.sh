#!/bin/bash
# ESEngine Documentation Build Script (Linux/macOS)
# Usage: ./build.sh [dev|build|all]

set -e

DOCS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMAND="${1:-all}"

print_header() {
    echo ""
    echo "========================================"
    echo " $1"
    echo "========================================"
    echo ""
}

build_doxygen() {
    print_header "Building Doxygen API Documentation"

    cd "$DOCS_ROOT"

    if ! command -v doxygen &> /dev/null; then
        echo "ERROR: Doxygen not found. Please install it first."
        echo "  Ubuntu/Debian: sudo apt install doxygen"
        echo "  macOS: brew install doxygen"
        exit 1
    fi

    doxygen Doxyfile

    echo "Doxygen build complete: docs/api/html/"
}

build_astro() {
    print_header "Building Astro Documentation Site"

    cd "$DOCS_ROOT/astro"

    if [ ! -d "node_modules" ]; then
        echo "Installing dependencies..."
        npm install
    fi

    npm run build

    echo "Astro build complete: docs/astro/dist/"
}

sync_api_docs() {
    echo "Syncing Doxygen API docs to Astro public..."

    API_SOURCE="$DOCS_ROOT/api/html"
    API_DEST="$DOCS_ROOT/astro/public/api/html"

    if [ -d "$API_SOURCE" ]; then
        mkdir -p "$DOCS_ROOT/astro/public/api"
        cp -r "$API_SOURCE" "$DOCS_ROOT/astro/public/api/"
        echo "API docs synced."
    else
        echo "No API docs found. Run './build.sh doxygen' first."
    fi
}

start_dev() {
    print_header "Starting Astro Dev Server"

    # Sync API docs before starting dev server
    sync_api_docs

    cd "$DOCS_ROOT/astro"

    if [ ! -d "node_modules" ]; then
        echo "Installing dependencies..."
        npm install
    fi

    echo "Starting dev server at http://localhost:4321"
    npm run dev
}

merge_output() {
    print_header "Merging Documentation Output"

    OUTPUT_DIR="$DOCS_ROOT/dist"

    # Clean output directory
    rm -rf "$OUTPUT_DIR"
    mkdir -p "$OUTPUT_DIR"

    # Copy Astro output
    if [ -d "$DOCS_ROOT/astro/dist" ]; then
        cp -r "$DOCS_ROOT/astro/dist/"* "$OUTPUT_DIR/"
    fi

    # Copy Doxygen output
    if [ -d "$DOCS_ROOT/api/html" ]; then
        mkdir -p "$OUTPUT_DIR/api/html"
        cp -r "$DOCS_ROOT/api/html/"* "$OUTPUT_DIR/api/html/"
    fi

    echo "Documentation merged to: docs/dist/"
}

# Main
case "$COMMAND" in
    dev)
        start_dev
        ;;
    doxygen)
        build_doxygen
        ;;
    astro)
        build_astro
        ;;
    build|all)
        build_doxygen
        build_astro
        merge_output
        ;;
    *)
        echo "Usage: ./build.sh [command]"
        echo ""
        echo "Commands:"
        echo "  dev      Start Astro dev server"
        echo "  doxygen  Build only Doxygen API docs"
        echo "  astro    Build only Astro site"
        echo "  build    Build everything"
        echo "  all      Build everything (default)"
        ;;
esac
