# Versioning Policy

Estella follows [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).
This document is a **public commitment**: it defines what our version numbers mean,
what counts as a breaking change, and how we deprecate and migrate. All notable
changes are recorded in [CHANGELOG.md](CHANGELOG.md).

A version is `MAJOR.MINOR.PATCH`:

- **MAJOR** — incompatible/breaking changes to a public surface (below).
- **MINOR** — backward-compatible new functionality.
- **PATCH** — backward-compatible bug fixes.

## What "public API" means for Estella

Estella is more than one library, so "breaking change" is defined per surface.
A MAJOR bump is triggered by a breaking change to **any** of these:

1. **SDK API** — the symbols exported from the `esengine` TypeScript/JavaScript
   package (`defineComponent`, `defineSystem`, `Query`, `Commands`, components,
   resources, and documented types). Removing/renaming an export, changing a
   signature incompatibly, or changing documented runtime behavior is breaking.
2. **Project & asset formats** — the on-disk formats the editor reads and writes
   (`.esproject`, `.esscene`, `.estileset`, and related asset/metadata files).
   A newer engine **must** open projects created by an older engine of the same
   MAJOR line; dropping that guarantee is breaking. (Forward compatibility — old
   engine opening a newer project — is *not* guaranteed.)
3. **Runtime / WASM ABI** — the module-loading contract used by the web loader
   (`@esengine/web-loader`) and the exported WASM entry points the SDK binds to.
   Changing it so an existing loader/SDK pairing stops working is breaking.
4. **Build CLI** — the documented `build-tools` commands and their flags
   (`build`, `sync`, `watch`, target names, etc.).

Things that are explicitly **not** part of the public API and may change in any
release: internal C++ headers under `src/`, unexported SDK internals, editor
internals, the embedded origin signatures (see [PROVENANCE.md](PROVENANCE.md)),
private fields, and anything marked `@internal` or `experimental`.

## Pre-1.0 (the `0.x` line)

Estella is currently in the `0.x` series. Plain SemVer allows anything to change in
`0.x`, but we commit to a stricter, predictable rule while we get to 1.0:

- **Breaking changes** bump the **MINOR** (`0.13.x` → `0.14.0`).
- **Features and fixes** bump the **PATCH** (`0.14.0` → `0.14.1`).
- Every breaking change is called out in the CHANGELOG under **Changed/Removed**,
  with a migration note where one is needed.

We will release **1.0.0** when the SDK API and the project format are stable enough
to promise full MAJOR-line compatibility. From 1.0.0 onward, standard SemVer applies
(breaking changes require a MAJOR bump).

## Deprecation & migration

- We **deprecate before we remove**. A deprecated API keeps working and emits a
  warning (a console/log warning in the SDK; a `@deprecated` tag in the types) for
  at least one MINOR release before removal.
- **Project files migrate forward automatically.** When the format changes, the
  editor upgrades older projects on open and records the format version in the file
  so the migration is deterministic and one-way within a MAJOR line.
- Removals and migrations are always documented in the CHANGELOG.

## Releases & tags

- Releases are Git tags of the form `vMAJOR.MINOR.PATCH` (e.g. `v0.14.0`) and appear
  on [GitHub Releases](https://github.com/esengine/estella/releases).
- The `esengine` SDK is published to npm with its **own** version number; consult the
  SDK notes in each CHANGELOG entry to map an Estella release to an SDK version.
- Pre-releases use SemVer pre-release suffixes (e.g. `v0.15.0-rc.1`) and are not
  covered by the compatibility promises above.
