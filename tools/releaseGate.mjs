// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  releaseGate.mjs — what 0.49 has to be able to say, and what says it.
 *
 * "Do not open 0.50 until these hold" is only a rule if the list is somewhere a
 * machine reads. Written down anywhere else it decays the usual way: a criterion
 * loses the check that answered it and nobody notices, because nothing was ever
 * holding the two together.
 *
 * So each criterion names the command that settles it. A criterion no command
 * answers is allowed — as `manual`, with who does it and why a machine cannot —
 * and check-release-gate refuses the third case, a criterion with neither.
 *
 * This says the criteria are OWNED. Whether they PASS is what running them says.
 */

export const RELEASE = '0.49';

/**
 * `answeredBy` is a shell command run from the repo root; `needs` are the files
 * it lives in, so deleting a verifier fails the gate rather than the release.
 */
export const CRITERIA = [
  {
    id: 'golden-packages',
    says: 'every golden project packages and launches on every target it declares',
    answeredBy: 'node tools/verify-golden.mjs --tier release',
    needs: ['tools/verify-golden.mjs', 'tools/goldenProjects.mjs'],
  },
  {
    id: 'package-matches-editor',
    says: 'a packaged game shows what the editor showed',
    answeredBy: 'node tools/verify-golden.mjs --tier release',
    needs: ['tools/frameCompare.mjs'],
  },
  {
    id: 'package-answers-input',
    says: 'a packaged game visibly answers the input its project declares',
    answeredBy: 'node tools/verify-golden.mjs --tier release',
    needs: ['desktop/scripts/inputScript.mjs'],
  },
  {
    id: 'launch-smoke-every-platform',
    says: 'every shipping platform launches a package and draws',
    answeredBy: 'node tools/verify-golden.mjs --tier release'
      + ' && node tools/verify-desktop-render.mjs --tier pr'
      + ' && node tools/verify-native-boot.mjs --platform android --examples all',
    needs: [
      'desktop/scripts/launch-export.mjs',
      'desktop/scripts/launch-minigame.mjs',
      'tools/verify-desktop-render.mjs',
      'tools/verify-native-boot.mjs',
    ],
  },
  {
    id: 'old-projects-open',
    says: 'projects released by older versions still open, with nothing dropped',
    answeredBy: 'node tools/verify-legacy.mjs --tier release',
    needs: ['tools/verify-legacy.mjs'],
  },
  {
    id: 'play-stop-conserves',
    says: 'Play/Stop 100 times returns every conserved counter to baseline, GL objects included',
    // The check defaults to 12 cycles for a PR; the criterion is 100, so the
    // command that answers it is the one that asks for 100.
    answeredBy: 'cd desktop && SOAK_CYCLES=100 node scripts/editor-checks/run.mjs soak',
    needs: ['desktop/scripts/editor-checks/soak.mjs', 'desktop/scripts/lib/censusJudge.mjs'],
  },
  {
    id: 'scene-churn-flat',
    says: 'opening and closing scenes shows no upward trend in GPU resources',
    answeredBy: 'cd desktop && SOAK_CYCLES=40 node scripts/editor-checks/run.mjs scene-churn',
    needs: ['desktop/scripts/editor-checks/scene-churn.mjs'],
  },
  {
    id: 'headless-soak',
    says: 'entity and prefab churn holds its bounded resources flat',
    answeredBy: 'pnpm run soak',
    needs: ['sdk/tests/soak/churn.test.ts', 'sdk/tests/soak/dist-probes.test.ts'],
  },
  {
    id: 'lifecycle-torture',
    says: 'asset and scene lifecycles survive interleaved load/unload/reload',
    answeredBy: 'pnpm run torture',
    needs: ['sdk/tests/torture/asset-lifecycle.test.ts', 'sdk/tests/torture/scene-lifecycle.test.ts'],
  },
  {
    id: 'performance-ceilings',
    says: 'no benchmark regresses past its recorded ceiling',
    answeredBy: 'pnpm run perf && pnpm run scale',
    needs: ['tools/perf-guard.mjs', 'tools/perf-budget.mjs'],
  },
  {
    id: 'static-gates',
    says: 'every declared contract still holds (api surface, layers, corpus, host shim…)',
    answeredBy: 'pnpm run verify',
    needs: ['tools/check-golden.mjs', 'tools/check-minigame-host.mjs'],
  },
  {
    id: 'no-engine-gaps-at-ship',
    says: 'the flagship game had to route around the engine nowhere that is still open',
    answeredBy: 'node tools/check-engine-gaps.mjs --empty',
    needs: ['tools/check-engine-gaps.mjs', 'examples/celestial-heights/engine-gaps.mjs'],
  },
  {
    id: 'site-shows-the-real-game',
    says: 'the README and landing hero are frames of the game that ships, not a mock-up',
    // A machine can compare two images; deciding that one of them is honest
    // marketing is not a thing to compute. Whether the frame is sound is the
    // flagship's parity run; whether it is the frame on the site is a person's.
    manual: 'release captain, over docs/assets + docs/landing: the hero comes from a build of examples/celestial-heights',
  },
  {
    id: 'diagnostics-from-a-release-build',
    says: 'a shipped build can export a diagnostic bundle',
    // No runner: it needs an installed, signed application, which is the one
    // artifact CI produces and cannot then run as a user would.
    manual: 'release captain, on the downloaded build: Help → Export Diagnostics',
  },
  {
    id: 'no-p0-packaging-bugs',
    says: 'no open P0 against packaging or launch',
    manual: 'release captain, over the tracker — a count of issues is not a thing to compute here',
  },
];
