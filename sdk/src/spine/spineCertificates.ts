// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spineCertificates.ts
 * @brief   Where a promise about a spine asset's extent comes from.
 *
 * @details A certified envelope is a statement somebody made about an asset, so
 *          it belongs to the asset and not to a generation of its bytes: a hot
 *          reload replaces what the skeleton does, not what was promised about
 *          it. And it is about the PAIR — an atlas decides how its regions were
 *          trimmed and so what geometry the attachments end up with — which is
 *          why nothing here answers about a skeleton alone.
 *
 *          It is a READ, not a table. This was a mutable projection somebody had
 *          to remember to fill, and the thing that went wrong with it is the
 *          only thing that can: nobody filled it, in any realm, ever. So the
 *          question now goes straight to the authority a realm already ships —
 *          the manifest the cook wrote from the `.meta` — and there is no moment
 *          at which the projection can be out of date with it, because there is
 *          no projection.
 */
import type { SpineCullingEnvelope } from './spineBounds';
import { certifyBounds } from './spineBounds';

/** What a runtime asks when it is about to make a residency. */
export interface SpineCertificateSource {
    /** The promise recorded for this PAIR, or unknown where there is none. */
    envelopeFor(skeleton: string, atlas: string): SpineCullingEnvelope;
}

/** The slice of a realm's asset source a certificate is read from. */
export interface SpineCullingProvider {
    spineCulling?(skeleton: string, atlas: string):
        { x: number; y: number; width: number; height: number } | undefined;
}

/**
 * The promises a realm ships, read from the source that serves its assets.
 *
 * A realm whose source answers nothing certifies nothing — which is what makes
 * an unconfigured project behave exactly as it did, and what makes an editor
 * preview (not a product runtime) simply not defer.
 */
export function spineCertificatesFrom(source: SpineCullingProvider): SpineCertificateSource {
    const read = source.spineCulling?.bind(source);
    if (!read) return NO_CERTIFICATES;
    return {
        envelopeFor(skeleton, atlas) {
            const bounds = read(skeleton, atlas);
            return bounds
                ? certifyBounds({
                    minX: bounds.x, minY: bounds.y,
                    maxX: bounds.x + bounds.width, maxY: bounds.y + bounds.height,
                })
                : { kind: 'unknown' };
        },
    };
}

/** A realm with no recorded promises: everything materialises. */
export const NO_CERTIFICATES: SpineCertificateSource = {
    envelopeFor: () => ({ kind: 'unknown' }),
};
