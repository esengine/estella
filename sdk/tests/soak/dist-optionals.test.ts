// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The optional subsystems survive bundling — asserted against dist, not src.
 *
 * The same shape as dist-probes: every other test imports `../../src`, where the
 * wiring was never in doubt, and 6,272 of them were green while the SHIPPED
 * bundle registered nothing. The editor's play realm loaded a scene full of
 * rigid bodies and logged "this build ships without the 3D physics runtime".
 *
 * Registration is a call now rather than a module's side effect, which is what
 * makes it survive; this is the gate that says it still does. The lean entry's
 * side of the claim — that it ships NONE of them — is check-entries-install-options'.
 *
 * Skips when dist is absent, because a source-only checkout has nothing to say.
 * CI builds the SDK before running tests, so there it is the real gate.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DIST = resolve(__dirname, '../../dist/index.js');
const HAS_DIST = existsSync(DIST);

describe.skipIf(!HAS_DIST)('the built SDK', () => {
    /** Content, not load time: importing this bundle is ~1s on its own, and at
     *  the 5s default the timeout fired on the import rather than the claim. */
    it('ships every optional subsystem its entry installs', async () => {
        const sdk = await import(DIST) as { shippedOptionalSubsystems: () => string[] };

        expect(typeof sdk.shippedOptionalSubsystems).toBe('function');
        // Named, not counted: a bundler that drops one leaves the others
        // answering, and a length check would still pass.
        expect(sdk.shippedOptionalSubsystems().sort()).toEqual(
            ['dragonBones', 'physics', 'physics3d', 'spine', 'video'],
        );
    }, 30_000);
});
