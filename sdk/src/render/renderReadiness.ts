// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What it means for content to have its render programs ready.
 *
 * Publishing content whose shaders are not built pays for them in the first
 * frame that shows it. A preparation that readies assets and not programs is a
 * promise half kept; this is the other half's shape.
 */

/**
 * A claim that some content's render programs are ready.
 *
 * Two facts, never one: the digest says WHICH programs, so a claim cannot cover
 * content it was not made about, and the epoch says those programs still exist.
 * The device generation guards the act of claiming, not the claim.
 *
 * @experimental
 */
export interface RenderReadinessStamp {
    /** The requirement digest in two halves — 64 bits do not survive a JS number. */
    digestLo: number;
    digestHi: number;
    /** The program epoch the digest holds under. */
    programEpoch: number;
}

/**
 * The outcome of trying to ready some content's render programs.
 *
 * `applicable: false` is the honest answer where there is no renderer, and must
 * never be spelled as a claim that succeeded. `stamp: null` is a debt: it can be
 * attempted again, and until one succeeds nothing is ready.
 *
 * @experimental
 */
export type RenderReadiness =
    | { applicable: false }
    | { applicable: true; stamp: RenderReadinessStamp | null };

/** Whether two claims describe the same requirements under the same epoch. */
export function sameReadiness(a: RenderReadinessStamp, b: RenderReadinessStamp): boolean {
    return a.digestLo === b.digestLo && a.digestHi === b.digestHi
        && a.programEpoch === b.programEpoch;
}
