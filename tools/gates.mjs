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
  // Everything below reads what this emits: the declaration snapshot, the
  // editor's own type-check and the examples all resolve `esengine` from dist.
  { id: 'sdk-build', run: 'pnpm --filter ./sdk build' },
  { id: 'api-surface-dts', run: 'node tools/api-surface.mjs --check-dts' },
  // The editor imports `esengine` — it reads dist, not the SDK's sources.
  { id: 'tsc-editor', run: 'pnpm --filter @estella/editor exec tsc --noEmit' },
  { id: 'cycles', run: 'node tools/check-cycles.mjs' },
  { id: 'layers', run: 'node tools/check-layers.mjs' },
  { id: 'project-settings', run: 'node tools/check-project-settings.mjs' },
  { id: 'workflows', run: 'node tools/check-workflows.mjs' },
  { id: 'tool-calls', run: 'node tools/check-tool-calls.mjs' },
  { id: 'inspector-door', run: 'node tools/check-inspector-door.mjs' },
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
  { id: 'verifier-exit', run: 'node tools/check-verifier-exit.mjs' },
  { id: 'render-scenes', run: 'node tools/check-render-scenes.mjs' },
  { id: 'release-metadata', run: 'node tools/check-release-metadata.mjs' },
  { id: 'golden', run: 'node tools/check-golden.mjs' },
  { id: 'engine-gaps', run: 'node tools/check-engine-gaps.mjs' },
  { id: 'minigame-host', run: 'node tools/check-minigame-host.mjs' },
  { id: 'release-gate', run: 'node tools/check-release-gate.mjs' },
  { id: 'component-reference', run: 'node tools/component-reference.mjs --check' },
  { id: 'examples', run: 'node build-tools/cli.js check-examples' },
  { id: 'prefabs', run: 'node build-tools/cli.js validate-prefabs' },
];

/** The gates a scope runs, in declaration order. */
export function gatesFor(scope) {
  if (!SCOPES.includes(scope)) throw new Error(`unknown scope "${scope}" (have: ${SCOPES.join(', ')})`);
  return GATES.filter((g) => !g.where || g.where === scope);
}
