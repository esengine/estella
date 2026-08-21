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
private fields, and anything marked `@internal` or `@experimental`.

## The Editor Plugin API

The editor's plugin API — `@estella/editor-api`, the shapes in
`editor-api/index.ts` that the editor writes into your project as
`.esengine/plugins/.types/editor-api.d.ts` — is **not** one of the four surfaces
above. It is **experimental**, and it is not covered by the MAJOR-line promise:
it will keep changing after 1.0.

This is a decision, not an omission. Three reasons:

- **The extension points are still converging.** The design is that a plugin
  registers through the same registries the editor's own features use, with one
  ownership mechanism behind all of them. Finishing that convergence changes the
  shape of contribution points, and freezing now would freeze the half-converged
  spelling.
- **The trust model is pre-isolation.** A plugin runs as trusted code inside the
  editor's renderer, at the same privilege as your project's game code. A real
  third-party ecosystem needs process isolation, and isolation makes an API
  asynchronous — so freezing today's synchronous surface would be promising the
  shape that has to change.
- **Nothing holds it up.** A symbol reaches `@public` in the SDK only once a game
  we certify releases against calls it. No shipped plugin exercises these shapes,
  so there is no evidence pinning them, and a promise with nothing holding it is
  the kind that gets broken by the first refactor.

What you **can** rely on while it is experimental:

- **`engines.editor` is honoured.** A plugin declares the editor range it works
  with, and one outside that range is refused with a stated reason rather than
  half-loaded. A breaking change therefore costs a plugin author a version bump —
  never a user a broken editor.
- **Breaking changes are written down.** Every one appears in the CHANGELOG under
  an **Editor plugin API** heading, with what to change.
- **Removal is deprecated first.** A contribution point being withdrawn keeps
  working, and says so, for at least one MINOR release.

The route out of experimental is the same bar the SDK uses: a contribution point
earns a compatibility promise once a shipped plugin exercises it. Parts of this
surface will be frozen that way, individually, rather than the whole of it at
once by a version number.

## Stability tiers

Surface 1 is large, and not all of it is equally settled. Every exported symbol
carries exactly one tier, written as a JSDoc tag on its declaration — so it
reaches the `.d.ts` your project compiles against, and your editor shows it on
hover. `sdk/etc/*.api.md` is the full inventory.

| Tier | Tag | What we promise |
| --- | --- | --- |
| Stable Candidate | `@public` | We expect 1.0 not to break it. Changing or removing one requires a deprecation release first. |
| Beta | `@beta` | Shipping and supported, but the shape may still adjust before 1.0. |
| Experimental | `@experimental` | No compatibility claim. It may change or disappear in any release. |
| Internal | `@internal` | Not for you to depend on; it is a policy error for one to be exported at all. |

**There is no stable-by-default.** An untagged symbol is `@experimental`:
freezing is something a maintainer decides, never something they forget to
prevent. A symbol reaches `@public` only after it is documented, pinned by a
test, and used by one of the games we certify releases against.

These tiers are enforced, not just described — `tools/api-surface.mjs` and
`tools/check-freeze-bar.mjs` run on every push, and `--check-baseline` compares
the tree against the last release tag so a broken `@public` promise fails the
build rather than being noticed by whoever upgrades.

## Pre-1.0 (the `0.x` line)

Estella is currently in the `0.x` series. Plain SemVer allows anything to change in
`0.x`, but we commit to a stricter, predictable rule while we get to 1.0:

- **Breaking changes and new functionality** bump the **MINOR** (`0.38.x` → `0.39.0`).
- **Fix-only releases** bump the **PATCH** (`0.34.0` → `0.34.1`).
- Because MINOR carries both, a MINOR bump on its own does **not** mean something
  broke. Every breaking change is called out in the CHANGELOG under
  **Changed/Removed**, with a migration note where one is needed — that entry, not
  the version number, is the signal to read before upgrading.

We will release **1.0.0** when the SDK API and the project format are stable enough
to promise full MAJOR-line compatibility. From 1.0.0 onward, standard SemVer applies
(breaking changes require a MAJOR bump). Reaching it means moving APIs up the
tiers above until the ones a game is built out of are all Stable Candidate; the
tier table is how you can see how far along that is at any point.

## Deprecation & migration

- We **deprecate before we remove**. A deprecated API keeps working and emits a
  warning (a console/log warning in the SDK; a `@deprecated` tag in the types) for
  at least one MINOR release before removal. For `@public` this is a build rule,
  not an intention: removing one that was not `@deprecated` in the previous
  release fails `api-surface --check-baseline`.
- **Project files migrate forward automatically.** When the format changes, the
  editor upgrades older projects on open and records the format version in the file
  so the migration is deterministic and one-way within a MAJOR line.
- Removals and migrations are always documented in the CHANGELOG.

## Releases & tags

- Releases are Git tags of the form `vMAJOR.MINOR.PATCH` (e.g. `v0.14.0`) and appear
  on [GitHub Releases](https://github.com/esengine/estella/releases).
- The `esengine` SDK is **not published to npm**. It ships inside the editor (every
  project created by the editor builds against the bundled SDK), so the Estella
  release version is the single product version. The SDK's public API surface is
  snapshotted in `sdk/etc/*.api.md` and governed by the release tags above — see
  `tools/api-surface.mjs`.
- Pre-releases use SemVer pre-release suffixes (e.g. `v0.15.0-rc.1`) and are not
  covered by the compatibility promises above.
