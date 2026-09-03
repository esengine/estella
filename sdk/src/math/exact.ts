// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    exact.ts
 * @brief   Trigonometry that answers the same bits everywhere.
 *
 * @details `Math.sin` is implementation-defined: two engines may both be right
 *          and disagree in the last bit. That is fine until a system is
 *          COMPILED, because then the interpreted build and the shipped one are
 *          two implementations, and a pixel gate goes red on trigonometry
 *          rather than on a bug.
 *
 *          So these are specified rather than delegated: one range reduction,
 *          one polynomial, one order of operations — written twice, in this file
 *          and in the compiler's runtime header, and held together by a
 *          bit-for-bit differential. `exact.sin` is what a system that wants to
 *          compile calls; `Math.sin` stays refused, and says so.
 *
 *          Determinism is the promise, not accuracy. The reduction is two-step
 *          Cody-Waite, so a very large argument loses digits — identically on
 *          both sides, which is the property that matters here.
 */

/** π/2 in two pieces, so `x - n·π/2` keeps the bits a single constant loses. */
const PIO2_HI = 1.5707963267341256;
const PIO2_LO = 6.077100506506192e-11;
/** 2/π, as one number both sides read from the same digits. */
const TWO_OVER_PI = 0.6366197723675814;

/** Minimax coefficients for sin on [-π/4, π/4] (fdlibm's kernel). */
const S1 = -1.6666666666666632e-01;
const S2 = 8.333333333324894e-03;
const S3 = -1.984126982985795e-04;
const S4 = 2.755731370707007e-06;
const S5 = -2.505076025340686e-08;
const S6 = 1.5896909952115501e-10;

/** The same, for cos. */
const C1 = 4.1666666666666602e-02;
const C2 = -1.3888888888874109e-03;
const C3 = 2.4801587289476730e-05;
const C4 = -2.7557314351390663e-07;
const C5 = 2.0875723212981748e-09;
const C6 = -1.1359647557788195e-11;

/**
 * Every constant the algorithm IS, under the name both sides call it. The
 * compiler writes the C half's coefficients from here: what is implemented
 * twice is the STRUCTURE, which a differential compares. Retyping a 17-digit
 * decimal is not a second implementation — it is a copy that drifts in silence.
 *
 * @internal
 */
export const EXACT_COEFFICIENTS = {
    PIO2_HI, PIO2_LO, TWO_OVER_PI,
    S1, S2, S3, S4, S5, S6,
    C1, C2, C3, C4, C5, C6,
} as const;

/**
 * The same, as a list the digest takes exactly — the ORDER is in the hash, so
 * reordering the record above is an ABI change and not a tidy-up. Sampling
 * answers alone would not do: a 1-ulp `S3` moved none of 250 probed answers
 * (measured) while still being arithmetic a long run disagrees on.
 *
 * @internal
 */
export const EXACT_CONSTANTS: readonly number[] = Object.values(EXACT_COEFFICIENTS);

/**
 * `Math.round`'s rule — ties toward +Infinity — spelled out, because C's
 * `round` breaks ties away from zero and would disagree on every .5.
 */
function roundTiesUp(x: number): number {
    return Math.floor(x + 0.5);
}

/** sin on [-π/4, π/4], by Horner in one fixed order. */
function kernelSin(x: number): number {
    const z = x * x;
    const r = S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6))));
    return x + x * z * r;
}

/** cos on [-π/4, π/4], likewise. */
function kernelCos(x: number): number {
    const z = x * x;
    const r = C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6))));
    return 1.0 - 0.5 * z + z * z * r;
}

/**
 * Trigonometry a compiled system may call, answering the same bits as the
 * interpreted build. `Math.sin` is refused by the AOT subset and says so.
 *
 * @beta
 */
export const exact = {
    /** Sine, to the same bits in an interpreted build and a compiled one. */
    sin(x: number): number {
        if (!Number.isFinite(x)) return NaN;
        const n = roundTiesUp(x * TWO_OVER_PI);
        const r = (x - n * PIO2_HI) - n * PIO2_LO;
        const q = ((n % 4) + 4) % 4;
        if (q === 0) return kernelSin(r);
        if (q === 1) return kernelCos(r);
        if (q === 2) return -kernelSin(r);
        return -kernelCos(r);
    },

    /** Cosine, to the same bits in an interpreted build and a compiled one. */
    cos(x: number): number {
        if (!Number.isFinite(x)) return NaN;
        const n = roundTiesUp(x * TWO_OVER_PI);
        const r = (x - n * PIO2_HI) - n * PIO2_LO;
        const q = ((n % 4) + 4) % 4;
        if (q === 0) return kernelCos(r);
        if (q === 1) return -kernelSin(r);
        if (q === 2) return -kernelCos(r);
        return kernelSin(r);
    },
};
