// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  gates.mjs — the static gates, in order, and where each one runs.
 *
 * There were two lists again. `pnpm run verify` (what the pre-push hook runs)
 * held eighteen gates and CI's Tests job held six, overlapping in one. So
 * seventeen gates only ever ran on a machine with the hook installed, and five
 * only ran in CI — which is how a push went out green and CI failed on
 * check-examples, and how every gate written this year could have been silently
 * skipped by pushing from anywhere else.
 *
 * One ordered list, then, with `where` saying which scope pays for each. Order
 * is load-bearing: the declaration checks and the example type-check both read
 * what `sdk-build` emits.
 */

/** Scopes a gate can run in. `both` is the default and needs no excuse. */
export const SCOPES = ['local', 'ci'];

/**
 * `run` is a shell command from the repo root. `where` narrows a gate to one
 * scope and then owes a `why` — a gate that quietly runs in one place is the
 * thing this file exists to stop.
 *
 * `needs: 'editor'` marks a gate whose SUBJECT is the editor. The editor is an
 * optional submodule, so those cannot run in a checkout without one — and a
 * skipped gate has to say so, since silence there reads as a clean bill.
 */
export const GATES = [
  { id: 'tsc-sdk', run: 'pnpm --filter ./sdk exec tsc --noEmit' },
  // Up here rather than beside `tsc-pipeline`: the compiler resolves `esengine`
  // to its own stub (compiler/tsconfig.json), so it needs nothing built and has
  // no reason to wait for `sdk-build`.
  { id: 'tsc-compiler', run: 'pnpm --filter @estella/compiler exec tsc --noEmit -p tsconfig.json' },
  { id: 'gl-boundary', run: 'node tools/check-gl-boundary.mjs' },
  { id: 'draw-command-boundary', run: 'node tools/check-draw-command-boundary.mjs' },
  { id: 'shadow-pass', run: 'node tools/check-shadow-pass.mjs' },
  { id: 'sidemodule-gates', run: 'node tools/check-sidemodule-gates.mjs' },
  { id: 'engine-exports', run: 'node tools/check-engine-exports.mjs' },
  { id: 'fixture-scenes', run: 'node tools/check-fixture-scenes.mjs' },
  { id: 'doc-imports', run: 'node tools/check-doc-imports.mjs' },
  { id: 'architecture-doc', run: 'node tools/check-architecture-doc.mjs' },
  {
    id: 'native-bindings',
    run: 'node tools/check-native-bindings.mjs',
    where: 'ci',
    why: 'the EHT generator shells out to `python`, which macOS does not ship a runnable one of; run it by hand where you have one',
  },
  { id: 'api-surface', run: 'node tools/api-surface.mjs --check' },
  // Reads the snapshot the gate above just proved current, against the one the
  // last release tag shipped — drift says the surface moved, this says a promise did.
  { id: 'api-surface-baseline', run: 'node tools/api-surface.mjs --check-baseline' },
  { id: 'freeze-bar', run: 'node tools/check-freeze-bar.mjs' },
  { id: 'tier-leaks', run: 'node tools/check-tier-leaks.mjs' },
  // The three above ask what the surface IS. This asks what it is missing: a
  // subsystem whose plugin reaches no entry is one the engine has and a game
  // cannot add — which is what 3D physics was for four releases.
  { id: 'plugin-door', run: 'node tools/check-plugin-door.mjs' },
  // A component tagged @beta whose Data interface is untagged promises the name
  // and not the fields, which is no promise at all.
  { id: 'data-tiers', run: 'node tools/check-data-tiers.mjs' },
  // The SDK's tiers are enforced by the three gates above. The editor plugin API
  // has no snapshot to enforce, so what is enforced there is the ANSWER: that it
  // is experimental, said the same way in every place someone reads it.
  { id: 'plugin-api-contract', run: 'node tools/check-plugin-api-contract.mjs' },
  // Everything below reads what this emits: the declaration snapshot, the
  // editor's own type-check and the examples all resolve `esengine` from dist.
  { id: 'sdk-build', run: 'pnpm --filter ./sdk build' },
  { id: 'api-surface-dts', run: 'node tools/api-surface.mjs --check-dts' },
  // Both read `esengine` from dist, and the editor reads the pipeline.
  { id: 'tsc-pipeline', run: 'pnpm --filter @estella/pipeline exec tsc --noEmit' },
  // needs: 'editor' is load-bearing here rather than merely tidy: `pnpm --filter`
  // prints "No projects matched the filters" and exits 0, so without a checkout
  // this gate reported success having type-checked nothing at all.
  { id: 'tsc-editor', run: 'pnpm --filter @estella/editor exec tsc --noEmit', needs: 'editor' },
  // The shipped plugins type-check against the editor's LIVE plugin API surface
  // (types.ts, the file authors are handed), so a change to it that no plugin
  // could survive fails here rather than in someone else's project.
  { id: 'tsc-plugins', run: 'pnpm -r --filter "./plugins/*" exec tsc --noEmit' },
  { id: 'plugin-tests', run: 'pnpm -r --filter "./plugins/*" test' },
  // The engine's own TS suites (pipeline + tooling). They lived in desktop/tests
  // until the editor split, where a checkout without the editor ran none of them.
  { id: 'engine-tests', run: 'pnpm run test' },
  // The AOT compiler carries its own oracle: a real example system lowered to
  // EIR must move a world exactly the way node moves it.
  // It also compiles the emitted C and requires the same bytes back: natively
  // with any C compiler, and as wasm where emsdk is unpacked. Without either it
  // still passes and PRINTS that the differential did not run — read the log.
  { id: 'compiler-tests', run: 'pnpm --filter @estella/compiler test' },
  // The plugins we ship prove the public API only if they are held to it.
  { id: 'plugin-boundary', run: 'node tools/check-plugin-boundary.mjs' },
  // Same shape of rule, other direction: what builds a project may not need the
  // process that edits one.
  { id: 'pipeline-boundary', run: 'node tools/check-pipeline-boundary.mjs' },
  // And the boundary holds in practice: a real project packages from the command
  // line with no editor built.
  { id: 'headless-export', run: 'node tools/check-headless-export.mjs' },
  { id: 'cycles', run: 'node tools/check-cycles.mjs' },
  { id: 'layers', run: 'node tools/check-layers.mjs' },
  // A system's parameters are what the schedule knows about it; the World
  // escape hatch has to say what it reaches for or the schedule knows nothing.
  { id: 'system-access', run: 'node tools/check-system-access.mjs' },
  { id: 'project-settings', run: 'node tools/check-project-settings.mjs', needs: 'editor' },
  { id: 'workflows', run: 'node tools/check-workflows.mjs' },
  { id: 'tool-spawn', run: 'node tools/check-tool-spawn.mjs' },
  { id: 'tool-calls', run: 'node tools/check-tool-calls.mjs', needs: 'editor' },
  { id: 'capabilities', run: 'node tools/check-capabilities.mjs', needs: 'editor' },
  { id: 'inspector-door', run: 'node tools/check-inspector-door.mjs', needs: 'editor' },
  { id: 'component-fields', run: 'node tools/check-component-fields.mjs' },
  // A field declares that it carries an asset in one place; everything that acts
  // on live assets has to read THAT rather than keep a list of components beside it.
  { id: 'live-asset-rebind', run: 'node tools/check-live-asset-rebind.mjs' },
  // A scene that unloads and a load that failed halfway own the same things;
  // two implementations of giving them back is how one came to miss four steps.
  { id: 'scene-teardown', run: 'node tools/check-scene-teardown.mjs' },
  // The subsystem that held all four retired shapes at once: a module-global
  // asset cache, an ownerless texture, an "active runtime" pointer, and
  // World-local state on a plugin object several Apps share.
  { id: 'tilemap-realm', run: 'node tools/check-tilemap-realm.mjs' },
  // The five spine lifetime invariants, each with the judgment that proves it:
  // what they replaced were teardown protocols, and a protocol comes back quietly.
  { id: 'spine-lifetimes', run: 'node tools/check-spine-lifetimes.mjs' },
  // …and that each of them can be reached on a device, where the registry is
  // assembled from ptr accessors rather than from embind.
  { id: 'native-components', run: 'node tools/check-native-components.mjs' },
  { id: 'shader-conditionals', run: 'node tools/check-shader-conditionals.mjs' },
  { id: 'mesh-vocabulary', run: 'node tools/check-mesh-vocabulary.mjs' },
  { id: 'shader-blocks', run: 'node tools/check-shader-blocks.mjs' },
  { id: 'wgsl-twin', run: 'node tools/check-wgsl-twin.mjs' },
  {
    // The twin's FRESHNESS, as opposed to its shape above: fifteen shaders reached
    // master carrying a stamp older than their own GLSL.
    id: 'wgsl-twin-fresh',
    run: "if [ -f build/wasm/web/esengine.js ]; then "
      + "node tools/gen-shader-twins.mjs --check fixtures/scenes examples; "
      + "else echo 'wgsl-twin-fresh: skipped — no built engine in build/wasm/web'; fi",
    where: 'local',
    why: 'the check cooks each shader to hash the ASSEMBLED GLSL, so it needs the built engine and skips a machine without one; the render CI job runs it where the binary is',
  },
  { id: 'shader-literals', run: 'node tools/check-shader-literals.mjs' },
  { id: 'import-settings', run: 'node tools/check-import-settings.mjs' },
  { id: 'gizmo-coverage', run: 'node tools/check-gizmo-coverage.mjs', needs: 'editor' },
  { id: 'dirty-source', run: 'node tools/check-dirty-source.mjs', needs: 'editor' },
  { id: 'path-sandbox', run: 'node tools/check-path-sandbox.mjs' },
  { id: 'key-codes', run: 'node tools/check-key-codes.mjs' },
  { id: 'comment-style', run: 'node tools/check-comment-style.mjs' },
  {
    id: 'cpp-tests',
    run: 'node tools/check-cpp-tests.mjs',
    where: 'local',
    why: 'it configures and builds a native cmake tree; CI compiles and RUNS those harnesses in its own C++ jobs',
  },
  {
    id: 'native-build',
    run: 'node tools/check-native-build.mjs',
    where: 'local',
    why: 'it builds the engine out of the tree `cli native` configured; CI builds every native target from scratch',
  },
  { id: 'verifier-exit', run: 'node tools/check-verifier-exit.mjs', needs: 'editor' },
  { id: 'render-scenes', run: 'node tools/check-render-scenes.mjs' },
  { id: 'release-metadata', run: 'node tools/check-release-metadata.mjs' },
  { id: 'shipped-resources', run: 'node tools/check-shipped-resources.mjs', needs: 'editor' },
  { id: 'golden', run: 'node tools/check-golden.mjs' },
  {
    id: 'physics2d',
    run: 'node tools/check-physics2d.mjs',
    where: 'local',
    why: 'it runs the built 2D physics wasm and skips a machine without one; the engine-coupled CI job runs it where the binary is, under ESTELLA_REQUIRE_WASM',
  },
  {
    id: 'physics3d',
    run: 'node tools/check-physics3d.mjs',
    where: 'local',
    why: 'it runs the built 3D physics wasm and skips a machine without one; the engine-coupled CI job runs it where the binary is, under ESTELLA_REQUIRE_WASM',
  },
  { id: 'engine-gaps', run: 'node tools/check-engine-gaps.mjs' },
  { id: 'minigame-host', run: 'node tools/check-minigame-host.mjs' },
  { id: 'release-gate', run: 'node tools/check-release-gate.mjs' },
  // release-gate says every criterion has something answering it; this says the
  // other direction — every checker has something RUNNING it. `verify:aot` spent
  // two releases broken because nothing did.
  { id: 'verifier-owners', run: 'node tools/check-verifier-owners.mjs' },
  { id: 'component-reference', run: 'node tools/component-reference.mjs --check' },
  { id: 'api-stability-page', run: 'node tools/api-stability.mjs --check' },
  // The per-symbol tiers say what is frozen; this says what a creator can build
  // on, and refuses a published verdict the tags do not carry.
  { id: 'subsystem-tiers', run: 'node tools/check-subsystem-tiers.mjs' },
  // And whether the verdict was earned. subsystem-tiers holds the table against
  // the tags; this holds a tier above experimental against the same evidence
  // check-freeze-bar asks of a @public symbol.
  { id: 'tier-bar', run: 'node tools/check-tier-bar.mjs' },
  // A TS enum that restates a C++ one crosses as a bare number: drift is not an
  // error, it is a picture that is merely wrong. cpp-contract pins the ones
  // somebody remembered; this says which ones nobody did.
  { id: 'enum-twins', run: 'node tools/check-enum-twins.mjs' },
  { id: 'examples', run: 'node build-tools/cli.js check-examples' },
  { id: 'documents', run: 'node build-tools/cli.js validate-documents' },
];

/** The gates a scope runs, in declaration order. `hasEditor` gates the editor ones. */
export function gatesFor(scope, hasEditor = true) {
  if (!SCOPES.includes(scope)) throw new Error(`unknown scope "${scope}" (have: ${SCOPES.join(', ')})`);
  return GATES.filter((g) => (!g.where || g.where === scope) && (hasEditor || g.needs !== 'editor'));
}
