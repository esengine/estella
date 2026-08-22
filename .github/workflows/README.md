# CI Workflows

Shared toolchain setup (pnpm + Node + a frozen install) lives in the
`./.github/actions/setup` composite action, so pnpm/Node versions are pinned in
exactly one place; every job just `uses: ./.github/actions/setup` after its
checkout.

## The editor submodule (`desktop/`)

The editor is a **private** repository mounted at `desktop/`, so the workflow
token cannot read it. Three jobs need it — **Editor authoring checks**,
**Packages (golden + released)** and the release workflow's **electron-builder**
job — and they fetch it through `./.github/actions/editor-checkout`, which uses a
**read-only deploy key**:

- public half: a deploy key on `esengine/estella-editor` titled `estella CI (read-only)`
- private half: the `EDITOR_SSH_KEY` secret on `esengine/estella`

A deploy key rather than a PAT because it is scoped to that one repository and
cannot write: if it leaks, it reads one private repo and nothing else. It is also
the only option `gh` can issue end to end — GitHub has no API for minting a PAT.

Without the secret those three jobs **fail at checkout**, deliberately. They
drive an editor; reporting green with no editor present would be a lie about what
was checked. Every other job runs fine without it — see `--host engine` in
`tools/verify-render.mjs` and `needs: 'editor'` in `tools/gates.mjs`.

### Rotating the key

```bash
ssh-keygen -t ed25519 -N "" -C "estella CI" -f /tmp/k
gh repo deploy-key add /tmp/k.pub -R esengine/estella-editor -t "estella CI (read-only)"
gh secret set EDITOR_SSH_KEY -R esengine/estella < /tmp/k
gh repo deploy-key list -R esengine/estella-editor      # delete the old id
gh repo deploy-key delete <old-id> -R esengine/estella-editor
shred -u /tmp/k && rm -f /tmp/k.pub
```

`./.github/actions/engine-submodules` is the counterpart: it initialises every
submodule **except** the editor, for the jobs that only want `third_party`'s
vendored sources. `submodules: recursive` on checkout cannot be used any more —
it tries to clone the private one too and fails the whole job.

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
