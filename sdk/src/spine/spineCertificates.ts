// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spineCertificates.ts
 * @brief   Where a promise about a spine asset's extent comes from.
 *
 * @details A certified envelope is a statement somebody made about an asset, so
 *          it belongs to the asset and not to a generation of its bytes: a hot
 *          reload replaces what the skeleton does, not what was promised about
 *          it. That makes the key the PAIR — skeleton and atlas, the identity
 *          spine assets already have — and never a path on its own, because an
 *          atlas decides how its regions were trimmed and so what geometry the
 *          attachments end up with.
 *
 *          This is the read seam and nothing more. Where the promises are
 *          persisted is the project's business — import metadata today, an
 *          inspector writing that metadata later — and neither of them may
 *          reach past this to hand a runtime an envelope it did not certify.
 */
import type { SpineAABB, SpineCullingEnvelope } from './spineBounds';
import { certifyBounds } from './spineBounds';
import { spineImportSettingsFrom } from '../asset/spineImportSettings';
import { spinePairKey } from './prepareSpine';

/** What a runtime asks when it is about to make a residency. */
export interface SpineCertificateSource {
    /** The promise recorded for this pair, or unknown where there is none. */
    envelopeFor(pairKey: string): SpineCullingEnvelope;
}

/**
 * The promises a realm knows about, by pair.
 *
 * Only `certify` puts one in, and it takes a rectangle: an observation cannot
 * become a promise by being stored somewhere that returns promises.
 */
export class SpineCertificates implements SpineCertificateSource {
    private byPair_ = new Map<string, SpineAABB>();

    /** Record that nothing this pair can pose leaves `bounds`. */
    certify(pairKey: string, bounds: SpineAABB): void {
        this.byPair_.set(pairKey, { ...bounds });
    }

    /** Withdraw a promise: a pair with no contract has no envelope. */
    revoke(pairKey: string): void {
        this.byPair_.delete(pairKey);
    }

    /** Forget every promise — what a rebuild from metadata starts with. */
    clear(): void {
        this.byPair_.clear();
    }

    envelopeFor(pairKey: string): SpineCullingEnvelope {
        const bounds = this.byPair_.get(pairKey);
        return bounds ? certifyBounds(bounds) : { kind: 'unknown' };
    }
}

/**
 * Rebuild the projection from what the project persists — the ONLY way promises
 * get in, and everything absent from `entries` loses its permission. `atlasOf`
 * names the atlas a skeleton pairs with, because the promise is about the pair:
 * the same skeleton against another atlas inherits nothing.
 */
export function projectSpineCertificates(
    into: SpineCertificates,
    entries: ReadonlyArray<{ path: string; importer?: Record<string, unknown> }>,
    atlasOf: (skeletonPath: string) => string | null,
): void {
    into.clear();
    for (const entry of entries) {
        const settings = spineImportSettingsFrom(entry.importer);
        if (!settings?.cullingBounds) continue;
        const atlas = atlasOf(entry.path);
        if (!atlas) continue;
        const { x, y, width, height } = settings.cullingBounds;
        into.certify(spinePairKey(entry.path, atlas),
                     { minX: x, minY: y, maxX: x + width, maxY: y + height });
    }
}

/** A realm with no recorded promises: everything materialises. */
export const NO_CERTIFICATES: SpineCertificateSource = {
    envelopeFor: () => ({ kind: 'unknown' }),
};
