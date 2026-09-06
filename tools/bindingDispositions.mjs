// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  bindingDispositions.mjs — what each hand-registered wasm binding is FOR.
 *
 * Two gates were each right and together impossible to satisfy. The binding
 * handshake says every `emscripten::function` registration must be mirrored by a
 * declaration in the production TS surface; the test-probe rule says an adapter
 * that exists only to be measured must never reach a release ABI. A binding that
 * is both — registered, and deliberately absent from `ESEngineModule` — had no
 * legal shape, and the handshake simply failed.
 *
 * The census that resolves it is not a list of excused names. It is a class per
 * binding, and each class owes obligations a gate can check:
 *
 *   production   must be declared in the production TS surface
 *   test-probe   must NOT be; must be registered behind the probe guard, and
 *                must be declared in the probe-only header
 *
 * `production` is the DEFAULT, so nothing has to be listed to be held to the
 * strict rule and a new binding cannot slip in unmirrored. Only the exception
 * is enumerated, which is what keeps this from becoming a list of things
 * somebody once wanted to stop failing.
 */

/** The guard a probe-only registration must sit behind, and the header its
 *  declaration must live in — both are what keep it out of a release build. */
export const PROBE_GUARD = 'ES_ENABLE_TEST_PROBES';
export const PROBE_HEADER = 'bindings/TestProbeBindings.hpp';

export const DISPOSITIONS = {
    production: {
        inProductionSurface: true,
        means: 'a capability the shipping SDK calls; the TS surface is its contract',
    },
    'test-probe': {
        inProductionSurface: false,
        means: 'an adapter that exists to be measured or cross-checked, never shipped',
    },
};

/**
 * Every binding that is NOT production, and why.
 *
 * `why` is owed: a class alone is a label, and the sentence beside it says what
 * a later reader checks it against — above all whether the thing it measures has
 * acquired a production consumer, the moment a probe should stop being one.
 */
export const TEST_PROBE_BINDINGS = [
    {
        id: 'engine_prewarmMeshVariants',
        why: 'the EQUIVALENCE oracle: it derives program requirements from live ECS'
            + ' entities so a test can check them against what the prepared document'
            + ' derived. Production never has entities at that moment — the whole point'
            + ' of preparing a cell is that it is readied before it has any — so this'
            + ' side exists only to be the independent judge of the other.',
    },
    {
        id: 'engine_prewarmMeshVariantsFromDocument',
        why: 'the document-side derivation, still probe-only while the residency'
            + ' lifecycle calls it from nowhere. It is the half with a production'
            + ' consumer coming, so when preparation starts requiring a readiness'
            + ' stamp this row is what has to be removed rather than amended.',
    },
];
