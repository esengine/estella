# CI Workflows

## Emscripten Version

**Current pinned version**: 3.1.51

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

2. Update version in the following files:
   - `.github/workflows/build.yml` (line 52)
   - `.github/workflows/release-desktop.yml` (line 49)
   - `CONTRIBUTING.md` (Prerequisites section)
   - `build-tools/utils/emscripten.js` (error message)

3. Run CI build on a test branch to verify

4. Monitor for any compatibility issues with:
   - WASM output sizes
   - WebGL bindings
   - Dynamic linking (MAIN_MODULE/SIDE_MODULE)

### Version History

- **3.1.51** (2026-02-15): Initial pinned version, stable for WebGL2 + dynamic linking

## Compiler Cache (ccache)

All CI workflows use [ccache](https://ccache.dev/) to speed up C++ compilation.

### Configuration

- **Action**: `hendrikmuhs/ccache-action@v1.2`
- **Cache keys**:
  - Linux build: `${{ runner.os }}-build-linux`
  - Emscripten build: `${{ runner.os }}-emscripten`
  - Release builds: `${{ matrix.platform }}-release`
- **Max cache size**:
  - CI builds: 500MB
  - Release builds: 1GB

### Performance Impact

- **First build** (cold cache): No change
- **Incremental builds** (warm cache): 5-10x faster
- **Full rebuild** (no code changes): ~90% time saved

### Emscripten-specific Settings

For Emscripten builds, ccache uses special configuration (set in `cmake/CompilerCache.cmake`):
- `CCACHE_COMPILERCHECK=content` - Use content-based hashing instead of mtime
- `CCACHE_NOHASHDIR=true` - Ignore build directory paths
- `CCACHE_MAXSIZE=2G` - Larger cache for WASM outputs

### Troubleshooting

If cache becomes corrupted or stale:
1. Bump the cache key version in workflow files
2. Or manually clear via GitHub Actions UI: Settings → Actions → Caches

## Bundle Size Tracking

CI automatically tracks WASM and SDK bundle sizes on every build.

### Current Baselines

Baseline sizes are stored in `.github/bundle-size-baselines.json`:

| File | Size | Threshold |
|------|------|-----------|
| wasm/web/esengine.wasm | 658KB | 800KB |
| wasm/web/physics.wasm | 159KB | 200KB |
| wasm/web/spine42.wasm | - | 300KB |
| wasm/web/spine38.wasm | - | 300KB |
| wasm/web/spine41.wasm | - | 300KB |
| sdk/esm/esengine.js | 105KB | 150KB |

### How It Works

1. **Build with manifest**: `node build-tools/cli.js build -t all --manifest`
2. **Track sizes**: `node build-tools/track-bundle-size.js check`
3. **On PR**: Posts a comment with size changes
4. **On threshold exceeded**: CI fails with error

### Updating Baselines

After intentional size changes (new features, optimizations):

```bash
node build-tools/cli.js build -t all --manifest
node build-tools/track-bundle-size.js update
git add .github/bundle-size-baselines.json
git commit -m "chore: update bundle size baselines"
```

### PR Comment Format

On pull requests, CI posts a comment showing size changes:

```
## 📦 Bundle Size Report

| File | Size | Baseline | Change | Threshold | Status |
|------|------|----------|--------|-----------|--------|
| wasm/web/esengine.wasm | 658KB | 658KB | - | 800KB | ✓ OK |
| wasm/web/physics.wasm | 162KB | 159KB | +3KB (+1.89%) | 200KB | ✓ OK |
| sdk/esm/esengine.js | 105KB | 105KB | - | 150KB | ✓ OK |
```

### Adjusting Thresholds

Edit thresholds in `build-tools/track-bundle-size.js`:

```javascript
const THRESHOLDS = {
    'wasm/web/esengine.wasm': 800 * 1024,  // 800KB
    'wasm/web/physics.wasm': 200 * 1024,   // 200KB
    // ...
};
```
