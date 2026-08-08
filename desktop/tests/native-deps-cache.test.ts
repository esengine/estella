// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The key CI stores prebuilt native dependencies under.
 *
 * Its failure mode is the quiet one: a key that omits a pin the build consumes
 * serves a stale Dawn or a stale SDL under a name that says it is current, and
 * the release ships whatever that was. So the key is derived from the manifest
 * rather than spelled out per workflow, and what it must contain is pinned here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { depsCacheKey } from '../../build-tools/tasks/nativeDeps.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pins = JSON.parse(readFileSync(path.join(ROOT, 'toolchain.manifest.json'), 'utf8')).native;

describe('the native dependency cache key', () => {
    it('carries every pin the target actually builds', () => {
        const windows = depsCacheKey('windows');
        expect(windows).toContain(pins.dawn.commit);
        expect(windows).toContain(pins.quickjs.commit);
        expect(windows).toContain(pins.sdl.commit);
    });

    it('leaves SDL out of the phones, whose hosts never link it', () => {
        // Including it would cold-build Dawn for Android and iOS — a quarter hour
        // each — every time a desktop-only dependency moves.
        for (const target of ['android', 'ios']) {
            expect(depsCacheKey(target)).not.toContain(pins.sdl.commit);
        }
    });

    it('never lets two targets share one entry', () => {
        const keys = ['android', 'ios', 'macos', 'windows'].map((t) => depsCacheKey(t));
        expect(new Set(keys).size).toBe(keys.length);
    });
});
