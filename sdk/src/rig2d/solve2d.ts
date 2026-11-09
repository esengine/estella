// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    solve2d.ts
 * @brief   Bending a chain of bones towards a point, in one plane. Pure, so the runtime and an authoring view move a limb the same way.
 *
 * @details Two bones have an exact answer, which is also the only one that keeps a knee bending the way it was told. Longer chains
 *          take cyclic coordinate descent: it respects a joint's limits directly, where a position-based solver would have to project them back afterwards.
 */

/** One bone of a chain. `x, y` is where it starts in its parent's space and `rotation` its turn there. @experimental */
export interface ChainBone {
    x: number;
    y: number;
    rotation: number;
    /** Radians the local rotation must stay between. */
    min?: number;
    max?: number;
}

/** @experimental */
export interface ChainSolveOptions {
    /** How far past the last bone's origin the point being aimed is, along its +x. */
    tipLength: number;
    /** Two bones only: which way the middle joint bends, +1 counter-clockwise. Defaults to the way it already bends. */
    bend?: number;
    iterations?: number;
    /** Close enough, in the chain's units. */
    tolerance?: number;
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** A rotation within a joint's limits, measured the short way round from the middle of them so a limit can cross ±180°. @experimental */
export function clampAngle(angle: number, min?: number, max?: number): number {
    if (min === undefined || max === undefined) return angle;
    const middle = (min + max) / 2, half = (max - min) / 2, off = wrap(angle - middle);
    return middle + Math.max(-half, Math.min(half, off));
}

/** Where the chain's tip ends up, in the space the first bone's `x, y` are in. @experimental */
export function chainTip(chain: readonly ChainBone[], tipLength: number): { x: number; y: number } {
    let x = 0, y = 0, angle = 0;
    chain.forEach((bone, i) => {
        const c = Math.cos(angle), s = Math.sin(angle);
        x += c * bone.x - s * bone.y;
        y += s * bone.x + c * bone.y;
        angle += bone.rotation;
        if (i === chain.length - 1) { x += Math.cos(angle) * tipLength; y += Math.sin(angle) * tipLength; }
    });
    return { x, y };
}

function solveTwoBones(chain: ChainBone[], targetX: number, targetY: number, opts: ChainSolveOptions): void {
    const upper = chain[0]!, lower = chain[1]!;
    const a = Math.hypot(lower.x, lower.y), b = opts.tipLength;
    const lean = Math.atan2(lower.y, lower.x);
    const dx = targetX - upper.x, dy = targetY - upper.y;
    const reach = Math.hypot(dx, dy);
    if (reach === 0) return;
    // Past its reach the limb straightens towards the point; closer than it can fold, it folds fully.
    const d = Math.max(Math.abs(a - b), Math.min(a + b, reach));
    const sign = opts.bend ?? (wrap(lower.rotation - lean) >= 0 ? 1 : -1);
    const cosElbow = Math.max(-1, Math.min(1, (d * d - a * a - b * b) / (2 * a * b)));
    const elbow = Math.acos(cosElbow) * sign;
    const shoulder = Math.atan2(dy, dx) - Math.atan2(b * Math.sin(elbow), a + b * Math.cos(elbow));
    upper.rotation = clampAngle(shoulder - lean, upper.min, upper.max);
    lower.rotation = clampAngle(elbow + lean, lower.min, lower.max);
}

function solveCCD(chain: ChainBone[], targetX: number, targetY: number, opts: ChainSolveOptions): void {
    const iterations = opts.iterations ?? 12, tolerance = opts.tolerance ?? 0.01;
    for (let pass = 0; pass < iterations; pass++) {
        for (let i = chain.length - 1; i >= 0; i--) {
            let x = 0, y = 0, angle = 0;
            for (let j = 0; j <= i; j++) {
                const c = Math.cos(angle), s = Math.sin(angle);
                x += c * chain[j]!.x - s * chain[j]!.y;
                y += s * chain[j]!.x + c * chain[j]!.y;
                if (j < i) angle += chain[j]!.rotation;
            }
            const tip = chainTip(chain, opts.tipLength);
            const turn = wrap(Math.atan2(targetY - y, targetX - x) - Math.atan2(tip.y - y, tip.x - x));
            chain[i]!.rotation = clampAngle(chain[i]!.rotation + turn, chain[i]!.min, chain[i]!.max);
        }
        const tip = chainTip(chain, opts.tipLength);
        if (Math.hypot(tip.x - targetX, tip.y - targetY) <= tolerance) return;
    }
}

/**
 * Turns the chain's bones in place so its tip reaches `target`, in the space the first bone's `x, y` are in. A point out of reach
 * leaves the chain stretched towards it.
 * @experimental
 */
export function solveChain2D(chain: ChainBone[], targetX: number, targetY: number, opts: ChainSolveOptions): void {
    if (chain.length === 0) return;
    if (chain.length === 1) {
        const bone = chain[0]!;
        bone.rotation = clampAngle(Math.atan2(targetY - bone.y, targetX - bone.x), bone.min, bone.max);
    } else if (chain.length === 2 && opts.tipLength > 0 && (chain[1]!.x !== 0 || chain[1]!.y !== 0)) {
        solveTwoBones(chain, targetX, targetY, opts);
        // A limit can leave the exact answer short of a point the limb could still reach another way.
        if (chain.some(b => b.min !== undefined)) solveCCD(chain, targetX, targetY, opts);
    } else solveCCD(chain, targetX, targetY, opts);
}
