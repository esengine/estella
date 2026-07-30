# CI Workflows

Shared toolchain setup (pnpm + Node + a frozen install) lives in the
`./.github/actions/setup` composite action, so pnpm/Node versions are pinned in
exactly one place; every job just `uses: ./.github/actions/setup` after its
checkout.

## Emscripten Version

**Current pinned version**: 5.0.0

This version is used across all workflows to ensure consistent WASM builds.

### Updating Emscripten

To update to a new version:

1. Test locally with the new version:
   ```bash
   emsdk install <version>
   emsdk activate <version>
   source path/to/emsdk/emsdk_env.sh
   node build-tools/cli.js build -t all
   ```

2. Update the `version:` under the **Setup Emscripten** step in:
   - `.github/workflows/build.yml`
   - `.github/workflows/release-desktop.yml`

   and the matching references in `CONTRIBUTING.md` (Prerequisites) and
   `build-tools/utils/emscripten.js` (error message).

3. Run CI build on a test branch to verify

4. Monitor for any compatibility issues with:
   - WASM output sizes
   - WebGL bindings
   - Dynamic linking (MAIN_MODULE/SIDE_MODULE)

### Version History

- **5.0.0**: Current pinned version.
- **3.1.51** (2026-02-15): Initial pinned version, stable for WebGL2 + dynamic linking

## Compiler Cache (ccache)

The Emscripten jobs use [ccache](https://ccache.dev/) to speed up C++ compilation.

### Configuration

- **Action**: `hendrikmuhs/ccache-action@v1.2.23`
- **Cache key**: `${{ runner.os }}-emscripten` — shared by `build.yml`'s
  `build-emscripten` job and `release-desktop.yml`'s `engine` job, so every
  master push keeps the release engine build's cache warm.
- **Max cache size**: 500MB

### Emscripten-specific Settings

For Emscripten builds, ccache uses special configuration (set in `cmake/CompilerCache.cmake`):
- `CCACHE_COMPILERCHECK=content` - Use content-based hashing instead of mtime
- `CCACHE_NOHASHDIR=true` - Ignore build directory paths
- `CCACHE_MAXSIZE=2G` - Larger cache for WASM outputs

### Troubleshooting

If cache becomes corrupted or stale:
1. Bump the cache key version in workflow files
2. Or manually clear via GitHub Actions UI: Settings → Actions → Caches
