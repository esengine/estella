# Contributing to Estella

Estella does not accept pull requests. Bug reports and feature requests are welcome as
[issues](https://github.com/esengine/estella/issues) — see [Reporting Issues](#reporting-issues).
The rest of this guide covers building the engine from source and the conventions the
maintainers follow.

## Development Environment

### Prerequisites

- **Node.js** >= 18
- **pnpm** >= 8
- **Emscripten** 5.0.0 (for C++/WASM builds, exact version required for CI compatibility)
- **ccache** (optional, recommended for faster C++ rebuilds)

### Setup

```bash
git clone https://github.com/esengine/estella.git
cd estella
```

### Optional: Install ccache for Faster Builds

For significantly faster incremental C++ builds (10x speedup), install ccache:

**macOS**:
```bash
brew install ccache
```

**Ubuntu/Debian**:
```bash
sudo apt-get install ccache
```

**Windows** (via Chocolatey):
```bash
choco install ccache
```

CMake will automatically detect and use ccache if available. To disable:
```bash
cmake -B build -DES_ENABLE_CCACHE=OFF
```

### Build Commands

```bash
# Full build (WASM + SDK, synced to an editor checkout if there is one)
node build-tools/cli.js build -t all

# SDK only
node build-tools/cli.js build -t sdk

# Core WASM only
node build-tools/cli.js build -t web

# Debug build
node build-tools/cli.js build -t web -d

# Watch mode
node build-tools/cli.js watch -t web

# Run the editor (a separate, private repository — mounted at desktop/ when you
# have access; the engine builds, tests and gates all run without it)
cd desktop && npm run dev
```

## Making Changes

### Windows WASM optimizer workers

The build tools default to `BINARYEN_CORES=1` on Windows to avoid crashes in the
bundled Binaryen optimizer's multi-worker execution. Release optimization
flags, including `-O3`, remain unchanged. Explicit `BINARYEN_CORES` values take
precedence; other platforms keep Binaryen's default behavior.

When invoking Emscripten or CMake directly outside the build tools, set the same
environment variable in PowerShell before building:

```powershell
$env:BINARYEN_CORES = '1'
```

### Commit Convention

We follow a strict commit message format:

```
<type>: <subject>
```

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Code style (formatting, no logic change) |
| `refactor` | Code refactoring |
| `perf` | Performance improvement |
| `test` | Add or update tests |
| `chore` | Build, config, tooling changes |

**Rules:**
- Write commit messages in English
- Use lowercase for the subject, no period at the end
- Use imperative mood (e.g., "add feature" not "added feature")
- Keep subject under 72 characters

### Code Style

- **C++**: See naming conventions and formatting rules in [`docs/CODING_STYLE.md`](docs/CODING_STYLE.md)
- **TypeScript**: Strict mode, use `defineComponent()` and `defineSystem()`
- **Comments**: Code should be self-documenting. Only add comments for non-obvious logic.
- **One path sandbox**: "is this path inside that root?" is `isInsideRoot` /
  `resolveInside` from `desktop/electron/pathSandbox.ts`. Do not open-code
  `path.relative(...).startsWith('..')` — lexical containment is not containment,
  because a symlink or junction inside the root holds no `..`. Enforced by
  `node tools/check-path-sandbox.mjs` (in `pnpm verify`); a use that is genuinely
  not a boundary opts out with a `path-sandbox: <why>` comment above it.
- **No prose in comments**: state the fact, not the story. One or two lines. No narrating
  the bug that led here, no "previously X, now Y", no essay paragraphs — that belongs in
  the commit message. A comment that needs a paragraph is a sign the code needs a name.
  Enforced by `node tools/check-comment-style.mjs` (in `pnpm verify`): it reads the lines
  your change ADDS and rejects history, roadmap codenames, and over-long blocks. Run it
  with `--all` to see the tree's existing debt, which is reported but not gated — the
  convention is applied to the file you touch, not in one sweep.

### Checking a Change Locally

1. Build, then run the gates with `pnpm run verify`
2. If C++ or SDK code changed, check bundle sizes against the tracked baselines:
   ```bash
   node build-tools/cli.js build -t all --manifest
   node build-tools/track-bundle-size.js check
   ```

## Reporting Issues

When reporting a bug, please include:

- Estella version (editor version or SDK version)
- Operating system and browser
- Steps to reproduce the issue
- Expected vs actual behavior
- Screenshots or error logs if applicable

For feature requests, describe the use case and the desired behavior.

## Community

- [Discord](https://discord.gg/sAX6PXZ9)
- [QQ Group: 481923584](https://qm.qq.com/q/BONa5LXQ0U)

## License

Estella is distributed under the [Apache License, Version 2.0](LICENSE).

Contributions follow the standard **inbound = outbound** model: unless you state
otherwise in writing, any contribution you intentionally submit for inclusion in
Estella is provided under the same Apache License, Version 2.0 that covers the
project (see Apache-2.0 §5). You retain copyright in your contribution.

By submitting a contribution, you confirm that:

1. You own, or otherwise have the right to submit, your contribution, and you
   license it to the project and its users under Apache-2.0.
2. To the extent your contribution is covered by patents you can license, you
   grant the patent license described in Apache-2.0 §3.
3. If your contribution includes third-party code, you identify it and its license
   so it can be attributed correctly in [NOTICE](NOTICE).

There is **no** separate Contributor License Agreement and **no** relicensing
grant. The project is permissively licensed, so the copyright holder neither needs
nor asks for the right to relicense your work under other terms.
