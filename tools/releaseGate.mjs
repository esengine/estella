// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  releaseGate.mjs — what a release has to be able to say, and what says it.
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

export const RELEASE = '0.55';

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
    id: '3d-runs-where-it-ships',
    says: 'a game whose world is 3D packages, launches and answers input — on the web and on a device',
    // Two ways for the solver to be absent — a side module fetched beside the
    // engine, a library compiled into a native host — and both leave a game
    // that starts and draws an empty room.
    answeredBy: 'node tools/verify-golden.mjs --tier release'
      + ' && node tools/verify-native-boot.mjs --platform android --examples all',
    needs: ['examples/physics-3d/project.esproject', 'tools/verify-native-boot.mjs'],
  },
  {
    id: 'every-pixel-gate-runs',
    says: 'every declared pixel gate has run, not just the ones CI happens to list',
    // CI pays for the pr tier on each push. The rest — spine, video, particles,
    // every material scene, text, ktx2 — was declared and run by nothing at all
    // until the registry gave the whole set one runner.
    //
    // Both backends, because verify-render defaults to one: the scenes that
    // declare the second are dropped in silence, which is the hole this
    // criterion exists to close.
    answeredBy:
      'node tools/verify-render.mjs --tier nightly && node tools/verify-render.mjs --tier nightly --backend webgpu',
    needs: ['tools/renderScenes.mjs', 'tools/verify-render.mjs'],
  },
  {
    id: 'hot-update-lands-or-rolls-back',
    says: 'a shipped build takes an update from a CDN, and refuses a broken one whole',
    // The corpus can package hot-update-demo and launch it; neither says an
    // update ever applied. This one serves a second build as the CDN, then two
    // manifests that lie, and reads the pixel after each.
    answeredBy: 'pnpm --filter @estella/editor run verify:render:hotupdate',
    needs: [
      'desktop/scripts/headless-hotupdate-verify.mjs',
      'desktop/tests/hotupdate-verify-fixture.test.ts',
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
    id: 'flagship-plays-through',
    says: 'the flagship can be played from its first room to its boss, as a package',
    // Every other gate asks whether something works. This asks the only thing a
    // player asks — and a game whose second door cannot be opened passes all of
    // the others.
    answeredBy: 'node tools/verify-playthrough.mjs',
    needs: [
      'tools/verify-playthrough.mjs',
      'desktop/scripts/play-through.mjs',
      'examples/celestial-heights/playthrough.json',
    ],
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
    id: 'frozen-api-earned',
    says: 'every @public symbol is documented, pinned by a test, and called by a golden project',
    answeredBy: 'node tools/check-freeze-bar.mjs',
    needs: ['tools/check-freeze-bar.mjs', 'tools/goldenProjects.mjs'],
  },
  {
    id: 'frozen-api-kept',
    says: 'the @public promises the last release shipped are all still kept',
    answeredBy: 'node tools/api-surface.mjs --check-baseline',
    needs: ['tools/api-surface.mjs', 'tools/lib/apiSnapshot.mjs'],
  },
  {
    id: 'frozen-api-spelled-in-frozen-types',
    says: 'no @public signature names a type at a weaker tier except where the gap is declared',
    answeredBy: 'node tools/check-tier-leaks.mjs',
    needs: ['tools/check-tier-leaks.mjs'],
  },
  {
    id: 'tiers-reach-the-creator',
    says: 'the stability tier is in the .d.ts a project compiles against, not only in our snapshot',
    // The 17 @beta symbols index claimed while the built declarations carried 3
    // is what this is for: a tier nobody can see is a tier nobody can act on.
    answeredBy: 'node tools/api-surface.mjs --check-dts',
    needs: ['tools/api-surface.mjs', 'tools/lib/sdkProgram.mjs'],
  },
  {
    id: 'plugin-api-answers-for-itself',
    says: 'the editor plugin API states which side of the 1.x contract it is on, everywhere it is read',
    // The question 0.50 had to answer, and the answer is "experimental, outside
    // the contract". What fails a release is not the answer but its absence from
    // one of the places somebody acts on it.
    answeredBy: 'node tools/check-plugin-api-contract.mjs',
    needs: ['tools/check-plugin-api-contract.mjs', 'editor-api/index.ts'],
  },
  {
    id: 'every-subsystem-has-a-verdict',
    says: 'every part of the engine publishes a tier at the size a creator builds in, and the tags carry it',
    // The per-symbol tiers are enforced above. This is the same answer at the
    // size somebody actually asks it: 1462 experimental symbols read the same
    // whether a subsystem was weighed or nobody looked.
    answeredBy: 'node tools/check-subsystem-tiers.mjs',
    needs: ['tools/apiSubsystems.mjs', 'tools/check-subsystem-tiers.mjs'],
  },
  {
    id: 'creator-can-say-what-is-safe',
    says: 'the docs name the four tiers and which APIs are in each, in both languages',
    // What a tier MEANS is a promise to people, and the sentence making it is
    // not something to compute from a snapshot.
    manual: 'release captain, over docs/astro: the stability page matches sdk/etc and VERSIONING.md',
  },
  {
    id: 'no-p0-packaging-bugs',
    says: 'no open P0 against packaging or launch',
    manual: 'release captain, over the tracker — a count of issues is not a thing to compute here',
  },
];
