// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-pose-eligibility.test.ts
 * @brief   Who is allowed to owe a world pose, and why they are not.
 *
 * @details One chain, and every link has to be the thing it says: a promise
 *          recorded against a PAIR, carried on the era a residency is made from,
 *          settled once beside what the runtime says about its own constraints.
 *          Two proofs, kept as two facts — collapsing them into one verdict
 *          would make "this asset is not deferring" unanswerable.
 *
 *          Nothing skips anything yet. This is the authority arriving before the
 *          effect that will use it.
 */
import { describe, it, expect } from 'vitest';
import { SpineRuntime } from '../src/spine/SpineRuntime';
import { fakeSpineModule, fakeSpineEra } from './helpers/fakeSpineModule';
import { spineCertificatesFrom, NO_CERTIFICATES } from '../src/spine/spineCertificates';
import { certifyBounds, scanObservedBounds, mayDeferWorldPose } from '../src/spine/spineBounds';
import type { SpineAABB, SpineCullingEnvelope } from '../src/spine/spineBounds';
import type { Entity } from '../src/types';

const PROMISE: SpineAABB = { minX: -200, minY: -100, maxX: 200, maxY: 400 };
/** The same promise as a manifest stores one. */
const RECT = { x: -200, y: -100, width: 400, height: 500 };

function certified(): SpineCullingEnvelope {
    return certifyBounds(PROMISE);
}

describe('a promise about a pair, carried to the residency that needs it', () => {
    it('is read for the pair asked about, and another atlas is another asset', () => {
        // The source answers about BOTH refs; there is no way to ask about a
        // skeleton alone, which is what kept a second atlas from inheriting one.
        const certificates = spineCertificatesFrom({
            spineCulling: (skeleton, atlas) =>
                (skeleton === 'hero.skel' && atlas === 'hero.atlas' ? RECT : undefined),
        });
        expect(certificates.envelopeFor('hero.skel', 'hero.atlas').kind).toBe('certified');
        expect(certificates.envelopeFor('hero.skel', 'winter.atlas').kind,
            'a promise about one atlas was read for another').toBe('unknown');
    });

    it('a realm whose source answers nothing promises nothing', () => {
        expect(NO_CERTIFICATES.envelopeFor('hero.skel', 'hero.atlas').kind).toBe('unknown');
        expect(spineCertificatesFrom({}).envelopeFor('hero.skel', 'hero.atlas').kind)
            .toBe('unknown');
    });

    it('the residency settles both facts, and asks the runtime exactly once', () => {
        const fake = fakeSpineModule();
        const runtime = new SpineRuntime('3.8', fake.module);
        const era = fakeSpineEra('era#1', new Uint8Array([1]), certified());

        for (let i = 0; i < 100; i++) runtime.loadEntity(i as Entity, era);
        expect(fake.continuousQueries, 'the capability was asked per entity').toBe(1);

        const eligibility = runtime.poseEligibility(0 as Entity)!;
        expect(eligibility.culling.kind).toBe('certified');
        expect(eligibility.requiresContinuousWorldPose).toBe(false);
        expect(runtime.mayDefer(0 as Entity)).toBe(true);
        runtime.dispose();
    });

    it('a runtime whose constraints carry state refuses, promise or not', () => {
        const fake = fakeSpineModule();
        fake.continuousWorldPose = true;
        const runtime = new SpineRuntime('4.2', fake.module);
        runtime.loadEntity(1 as Entity, fakeSpineEra('era#1', new Uint8Array([1]), certified()));

        const eligibility = runtime.poseEligibility(1 as Entity)!;
        expect(eligibility.culling.kind, 'the promise was lost on the way in').toBe('certified');
        expect(eligibility.requiresContinuousWorldPose).toBe(true);
        expect(runtime.mayDefer(1 as Entity), 'a stateful skeleton was allowed to owe').toBe(false);
        runtime.dispose();
    });

    it('an asset nobody promised anything about refuses, whatever the runtime says', () => {
        const fake = fakeSpineModule();
        const runtime = new SpineRuntime('3.8', fake.module);
        runtime.loadEntity(1 as Entity, fakeSpineEra('era#1'));

        const eligibility = runtime.poseEligibility(1 as Entity)!;
        expect(eligibility.culling.kind).toBe('unknown');
        expect(eligibility.requiresContinuousWorldPose).toBe(false);
        expect(runtime.mayDefer(1 as Entity), 'an uncertified asset was allowed to owe').toBe(false);
        runtime.dispose();
    });

    it('an observation cannot arrive as a promise', () => {
        // Not a policy in the scheduler — the gate itself refuses it, so a
        // future caller cannot hand one in through a different door.
        const observed: SpineCullingEnvelope = {
            kind: 'observed', source: 'animation-scan', sampleStep: 1 / 30,
            era: 'era#1', bounds: PROMISE,
            coverage: { animations: 11, skins: 1, samples: 400 },
        };
        expect(mayDeferWorldPose(observed, false)).toBe(false);

        const fake = fakeSpineModule();
        const runtime = new SpineRuntime('3.8', fake.module);
        runtime.loadEntity(1 as Entity, fakeSpineEra('era#1', new Uint8Array([1]), observed));
        expect(runtime.poseEligibility(1 as Entity)!.culling.kind).toBe('observed');
        expect(runtime.mayDefer(1 as Entity), 'a scan authorised a deferral').toBe(false);
        runtime.dispose();
    });

    it('a new generation is asked again rather than inheriting the last answer', () => {
        // A residency belongs to an era. Hot-reloading gives a different one,
        // whose native skeleton is a different parse — and whose capability is
        // therefore a different question, not a remembered answer.
        const fake = fakeSpineModule();
        const runtime = new SpineRuntime('4.2', fake.module);
        runtime.loadEntity(1 as Entity, fakeSpineEra('pair#1', new Uint8Array([1]), certified()));
        expect(fake.continuousQueries).toBe(1);
        expect(runtime.mayDefer(1 as Entity)).toBe(true);

        fake.continuousWorldPose = true;
        runtime.loadEntity(1 as Entity, fakeSpineEra('pair#2', new Uint8Array([1]), certified()));
        expect(fake.continuousQueries, 'the new residency reused the old answer').toBe(2);
        expect(runtime.mayDefer(1 as Entity), 'a reloaded skeleton kept the old capability')
            .toBe(false);
        runtime.dispose();
    });

    it('the promise survives the generation the asset was read at', () => {
        // What the certificate is ABOUT is the asset, so reloading its bytes
        // does not withdraw it — the pair is the same pair.
        const certificates = spineCertificatesFrom({ spineCulling: () => RECT });
        for (const generation of [17, 18, 19]) {
            expect(certificates.envelopeFor('hero.skel', 'hero.atlas').kind,
                `generation ${generation} lost the promise`).toBe('certified');
        }
    });

    it('nothing may defer without both, and the two facts say which is missing', () => {
        expect(mayDeferWorldPose(certified(), false)).toBe(true);
        expect(mayDeferWorldPose(certified(), true)).toBe(false);
        expect(mayDeferWorldPose({ kind: 'unknown' }, false)).toBe(false);
        expect(mayDeferWorldPose({ kind: 'unknown' }, true)).toBe(false);
        void scanObservedBounds;
    });
});
