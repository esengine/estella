// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spineBounds.ts
 * @brief   Three different things that all look like a rectangle.
 *
 * @details Skipping a world pose for something off camera is only safe if the
 *          "off camera" was decided without one, and the extent that decides it
 *          has to be one nothing can leave. Three kinds, and only one of them is
 *          allowed to answer that:
 *
 *          SETUP is what the skeleton was authored at. A fact about the data,
 *          and animations reach outside it.
 *
 *          OBSERVED is what a scan saw: every animation, every skin, sampled.
 *          Useful to look at and to propose, and it is not a proof — a mix of
 *          two animations is not the union of their extents, runtime code can
 *          move a bone the export never did, and an extreme between two samples
 *          is simply not seen. It may never authorise a skip.
 *
 *          CERTIFIED is somebody promising that nothing leaves this rectangle.
 *          A contract, not a measurement, which is why its only source is
 *          explicit. A scan can suggest one; accepting it is the promise.
 *
 *          Everything here is in the skeleton's own space. A certificate
 *          belongs to an era, which entities share; where one of them stands is
 *          not part of it.
 */

/** A rectangle in the skeleton's own space. */
export interface SpineAABB {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/** What a scan actually visited, so "it scanned everything" is checkable. */
export interface SpineScanCoverage {
    animations: number;
    skins: number;
    samples: number;
}

/**
 * The extent culling is allowed to trust, and how much that is worth.
 *
 * `observed` carries the era it was scanned from and retires with it: what one
 * generation's bytes did is no promise about the next. A certificate is about
 * the asset, so it carries no era at all.
 */
export type SpineCullingEnvelope =
    | { kind: 'certified'; bounds: SpineAABB; source: 'explicit' }
    | {
        kind: 'observed'; bounds: SpineAABB; source: 'animation-scan';
        sampleStep: number; era: string; coverage: SpineScanCoverage;
    }
    | { kind: 'unknown' };

/** The narrow slice of a controller a scan needs. */
export interface SpineBoundsSource {
    createInstance(skeletonHandle: number): number;
    destroyInstance(instanceId: number): void;
    getAnimations(instanceId: number): string[];
    getSkins(instanceId: number): string[];
    setSkin(instanceId: number, skin: string): void;
    play(instanceId: number, animation: string, loop?: boolean, track?: number): boolean;
    update(instanceId: number, dt: number): void;
    getBounds(instanceId: number): { x: number; y: number; width: number; height: number };
    animationDuration(skeletonHandle: number, animation: string): number;
    skeletonBounds(skeletonHandle: number): SpineAABB | null;
}

const EMPTY: SpineAABB = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

function union(into: SpineAABB, box: { x: number; y: number; width: number; height: number }): SpineAABB {
    if (box.width <= 0 && box.height <= 0) return into;
    return {
        minX: Math.min(into.minX, box.x),
        minY: Math.min(into.minY, box.y),
        maxX: Math.max(into.maxX, box.x + box.width),
        maxY: Math.max(into.maxY, box.y + box.height),
    };
}

/** What the skeleton was authored at. A fact, never an authority. */
export function setupBounds(source: SpineBoundsSource, skeletonHandle: number): SpineAABB | null {
    return source.skeletonBounds(skeletonHandle);
}

/**
 * Every animation, at `sampleStep` through its whole duration, in every skin.
 *
 * On its own scratch instance, so the entities using this skeleton keep the
 * pose they were in. The result is `observed`, and stays that whatever it finds.
 */
export function scanObservedBounds(
    source: SpineBoundsSource, skeletonHandle: number, era: string,
    sampleStep = 1 / 30,
): SpineCullingEnvelope {
    const instanceId = source.createInstance(skeletonHandle);
    try {
        const skins = source.getSkins(instanceId);
        const animations = source.getAnimations(instanceId);
        let bounds = EMPTY;
        let samples = 0;

        for (const skin of skins) {
            source.setSkin(instanceId, skin);
            source.update(instanceId, 0);
            bounds = union(bounds, source.getBounds(instanceId));
            samples++;

            for (const animation of animations) {
                const duration = source.animationDuration(skeletonHandle, animation);
                if (duration < 0) continue;
                source.play(instanceId, animation, false, 0);
                source.update(instanceId, 0);
                bounds = union(bounds, source.getBounds(instanceId));
                samples++;
                for (let t = 0; t < duration; t += sampleStep) {
                    source.update(instanceId, Math.min(sampleStep, duration - t));
                    bounds = union(bounds, source.getBounds(instanceId));
                    samples++;
                }
            }
        }

        return {
            kind: 'observed', source: 'animation-scan', sampleStep, era, bounds,
            coverage: { animations: animations.length, skins: skins.length, samples },
        };
    } finally {
        source.destroyInstance(instanceId);
    }
}

/**
 * Somebody promising that no pose of this skeleton leaves `bounds`.
 *
 * The only way to make a certificate, and it takes a rectangle rather than
 * another envelope: an observation cannot be upgraded into a promise by passing
 * it through a function, only by somebody deciding to make one.
 */
export function certifyBounds(bounds: SpineAABB): SpineCullingEnvelope {
    return { kind: 'certified', bounds: { ...bounds }, source: 'explicit' };
}

/**
 * The envelope as it stands for `era`. An observation of another generation is
 * not one of this one, and comes back unknown rather than being trusted.
 */
export function envelopeFor(envelope: SpineCullingEnvelope, era: string): SpineCullingEnvelope {
    if (envelope.kind !== 'observed') return envelope;
    return envelope.era === era ? envelope : { kind: 'unknown' };
}

/**
 * Whether this entity's world pose may be left unresolved when nothing can see
 * it. Two independent proofs, and the absence of either is a no: the runtime
 * saying its constraints carry no state across a pose, and an envelope somebody
 * certified. Anything else materialises, which costs time and cannot be wrong.
 */
export function mayDeferWorldPose(
    envelope: SpineCullingEnvelope, requiresContinuousWorldPose: boolean,
): boolean {
    return !requiresContinuousWorldPose && envelope.kind === 'certified';
}

/** A 2D affine transform, row-major `[a, b, c, d, tx, ty]`. */
export type SpineAffine = readonly [number, number, number, number, number, number];

/**
 * The local rectangle in world space, still conservative: all four corners are
 * transformed and re-bounded, because under rotation the corners of the result
 * are not the transformed corners of the input.
 */
export function worldBounds(local: SpineAABB, transform: SpineAffine): SpineAABB {
    const [a, b, c, d, tx, ty] = transform;
    const corners: Array<[number, number]> = [
        [local.minX, local.minY], [local.maxX, local.minY],
        [local.maxX, local.maxY], [local.minX, local.maxY],
    ];
    let out = EMPTY;
    for (const [x, y] of corners) {
        const wx = a * x + c * y + tx;
        const wy = b * x + d * y + ty;
        out = {
            minX: Math.min(out.minX, wx), minY: Math.min(out.minY, wy),
            maxX: Math.max(out.maxX, wx), maxY: Math.max(out.maxY, wy),
        };
    }
    return out;
}

/** Whether `outer` contains `inner`, which is what "did not leave it" means. */
export function contains(outer: SpineAABB, inner: SpineAABB): boolean {
    return inner.minX >= outer.minX && inner.minY >= outer.minY
        && inner.maxX <= outer.maxX && inner.maxY <= outer.maxY;
}
