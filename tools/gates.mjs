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
 */
export const GATES = [
  { id: 'tsc-sdk', run: 'pnpm --filter ./sdk exec tsc --noEmit' },
  { id: 'gl-boundary', run: 'node tools/check-gl-boundary.mjs' },
  { id: 'draw-command-boundary', run: 'node tools/check-draw-command-boundary.mjs' },
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
  { id: 'tsc-editor', run: 'pnpm --filter @estella/editor exec tsc --noEmit' },
  // The shipped plugins type-check against the editor's LIVE plugin API surface
  // (types.ts, the file authors are handed), so a change to it that no plugin
  // could survive fails here rather than in someone else's project.
  { id: 'tsc-plugins', run: 'pnpm -r --filter "./plugins/*" exec tsc --noEmit' },
  { id: 'plugin-tests', run: 'pnpm -r --filter "./plugins/*" test' },
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
  { id: 'project-settings', run: 'node tools/check-project-settings.mjs' },
  { id: 'workflows', run: 'node tools/check-workflows.mjs' },
  { id: 'tool-spawn', run: 'node tools/check-tool-spawn.mjs' },
  { id: 'tool-calls', run: 'node tools/check-tool-calls.mjs' },
  { id: 'capabilities', run: 'node tools/check-capabilities.mjs' },
  { id: 'inspector-door', run: 'node tools/check-inspector-door.mjs' },
  { id: 'component-fields', run: 'node tools/check-component-fields.mjs' },
  // …and that each of them can be reached on a device, where the registry is
  // assembled from ptr accessors rather than from embind.
  { id: 'native-components', run: 'node tools/check-native-components.mjs' },
  { id: 'shader-conditionals', run: 'node tools/check-shader-conditionals.mjs' },
  { id: 'mesh-vocabulary', run: 'node tools/check-mesh-vocabulary.mjs' },
  { id: 'shader-blocks', run: 'node tools/check-shader-blocks.mjs' },
  { id: 'wgsl-twin', run: 'node tools/check-wgsl-twin.mjs' },
  { id: 'shader-literals', run: 'node tools/check-shader-literals.mjs' },
  { id: 'import-settings', run: 'node tools/check-import-settings.mjs' },
  { id: 'dirty-source', run: 'node tools/check-dirty-source.mjs' },
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
  { id: 'verifier-exit', run: 'node tools/check-verifier-exit.mjs' },
  { id: 'render-scenes', run: 'node tools/check-render-scenes.mjs' },
  { id: 'release-metadata', run: 'node tools/check-release-metadata.mjs' },
  { id: 'shipped-resources', run: 'node tools/check-shipped-resources.mjs' },
  { id: 'golden', run: 'node tools/check-golden.mjs' },
  {
    id: 'physics3d',
    run: 'node tools/check-physics3d.mjs',
    where: 'local',
    why: 'it runs the built 3D physics wasm; CI builds that module in its own wasm job',
  },
  { id: 'engine-gaps', run: 'node tools/check-engine-gaps.mjs' },
  { id: 'minigame-host', run: 'node tools/check-minigame-host.mjs' },
  { id: 'release-gate', run: 'node tools/check-release-gate.mjs' },
  { id: 'component-reference', run: 'node tools/component-reference.mjs --check' },
  { id: 'api-stability-page', run: 'node tools/api-stability.mjs --check' },
  // The per-symbol tiers say what is frozen; this says what a creator can build
  // on, and refuses a published verdict the tags do not carry.
  { id: 'subsystem-tiers', run: 'node tools/check-subsystem-tiers.mjs' },
  { id: 'examples', run: 'node build-tools/cli.js check-examples' },
  { id: 'documents', run: 'node build-tools/cli.js validate-documents' },
];

/** The gates a scope runs, in declaration order. */
export function gatesFor(scope) {
  if (!SCOPES.includes(scope)) throw new Error(`unknown scope "${scope}" (have: ${SCOPES.join(', ')})`);
  return GATES.filter((g) => !g.where || g.where === scope);
}
