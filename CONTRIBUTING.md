# Contributing to ESEngine

Thank you for your interest in contributing to ESEngine! This guide will help you get started.

## Development Environment

### Prerequisites

- **Node.js** >= 18
- **pnpm** >= 8
- **Emscripten** 3.1.51 (for C++/WASM builds, exact version required for CI compatibility)
- **Rust** >= 1.75 (for Tauri editor)
- **ccache** (optional, recommended for faster C++ rebuilds)

### Setup

```bash
git clone https://github.com/esengine/microes.git
cd microes
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
# Full build (WASM + SDK + sync to editor)
node build-tools/cli.js build -t all

# SDK only
node build-tools/cli.js build -t sdk

# Core WASM only
node build-tools/cli.js build -t web

# Debug build
node build-tools/cli.js build -t web -d

# Watch mode
node build-tools/cli.js watch -t web

# Run editor
cd desktop && npm run dev
```

## Making Changes

### Branch Naming

Create a branch from `master` with a descriptive name:

```
feat/prefab-system
fix/transform-calculation
docs/update-readme
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

- **C++**: See naming conventions and formatting rules in `CLAUDE.md`
- **TypeScript**: Strict mode, use `defineComponent()` and `defineSystem()`
- **Comments**: Code should be self-documenting. Only add comments for non-obvious logic.

## Pull Request Process

1. Fork the repository and create your branch from `master`
2. Make your changes, following the code style guidelines
3. Test your changes locally (build, run editor, preview)
4. Check bundle sizes if you modified C++ or SDK code:
   ```bash
   node build-tools/cli.js build -t all --manifest
   node build-tools/track-bundle-size.js check
   ```
5. Push your branch and open a Pull Request
6. Fill in the PR template with a clear description
7. CI will automatically post a bundle size report on your PR
8. Wait for review — maintainers may request changes

### Bundle Size Guidelines

CI tracks WASM and SDK bundle sizes. If your PR exceeds thresholds:

- **Explain why**: Add justification in PR description (new feature, dependencies, etc.)
- **Optimize if possible**: Consider lazy loading, code splitting, or removing unused code
- **Update baselines**: Maintainers will update baselines if the size increase is acceptable

## Reporting Issues

When reporting a bug, please include:

- ESEngine version (editor version or SDK version)
- Operating system and browser
- Steps to reproduce the issue
- Expected vs actual behavior
- Screenshots or error logs if applicable

For feature requests, describe the use case and the desired behavior.

## Community

- [Discord](https://discord.gg/sAX6PXZ9)
- [QQ Group: 481923584](https://qm.qq.com/q/BONa5LXQ0U)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
