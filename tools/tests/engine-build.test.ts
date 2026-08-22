// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  engine-build.test.ts — is the binary a verifier judges the one this
 *        checkout builds, per BUILD VARIANT?
 *
 * The variants are separate builds that share one manifest. Dating them all from
 * the moment the manifest was written makes a `-t web` build vouch for a wechat
 * binary of any age — and a stale one does not fail as stale: the package boots,
 * fails its ABI handshake, and reads as the game being broken.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error — a .mjs tool module, typed by its own JSDoc
import { staleEngineBuild } from '../lib/engineBuild.mjs';

const HOUR = 3600_000;
let root = '';
let wasmDir = '';

/** A checkout whose newest engine source was touched at `sourceAt`. */
function checkout(sourceAt: number) {
    mkdirSync(path.join(root, 'src'), { recursive: true });
    const file = path.join(root, 'src', 'renderer.cpp');
    writeFileSync(file, '// engine\n');
    utimesSync(file, sourceAt / 1000, sourceAt / 1000);
}

const manifest = (body: Record<string, unknown>) =>
    writeFileSync(path.join(wasmDir, 'wasm.manifest.json'), JSON.stringify(body));

beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'engine-build-'));
    wasmDir = path.join(root, 'build', 'wasm', 'wechat');
    mkdirSync(wasmDir, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('staleEngineBuild, per variant', () => {
    it('dates a variant by its OWN build, not by when the manifest was written', () => {
        const now = Date.now();
        checkout(now - HOUR); // source changed an hour ago
        manifest({
            schema: 2,
            variants: { web: { builtAt: new Date(now).toISOString() },        // built since
                        wechat: { builtAt: new Date(now - 48 * HOUR).toISOString() } }, // two days behind
        });
        expect(staleEngineBuild(root, wasmDir, 'web')).toBeNull();
        const stale = staleEngineBuild(root, wasmDir, 'wechat');
        expect(stale).toContain('wechat engine binary');
        // The way out has to name the build that is behind — `-t web` would rebuild
        // the one that was already current and leave the failure exactly as it was.
        expect(stale).toContain('-t wechat');
    });

    it('is silent when the variant outlives the source', () => {
        const now = Date.now();
        checkout(now - 48 * HOUR);
        manifest({ schema: 2, variants: { wechat: { builtAt: new Date(now).toISOString() } } });
        expect(staleEngineBuild(root, wasmDir, 'wechat')).toBeNull();
    });

    // A manifest written before this was per-variant is still on disk in every
    // working tree that has not rebuilt; reading it as "no answer" would turn the
    // gate off silently, which is worse than the imprecision it replaces.
    it('falls back to a schema-1 manifest single stamp', () => {
        const now = Date.now();
        checkout(now - HOUR);
        manifest({ schema: 1, builtAt: new Date(now - 48 * HOUR).toISOString() });
        expect(staleEngineBuild(root, wasmDir, 'wechat')).toContain('wechat engine binary');
    });

    it('has nothing to say without a manifest, or with an unreadable one', () => {
        checkout(Date.now());
        expect(staleEngineBuild(root, wasmDir, 'web')).toBeNull();
        writeFileSync(path.join(wasmDir, 'wasm.manifest.json'), 'not json');
        expect(staleEngineBuild(root, wasmDir, 'web')).toBeNull();
    });

    // The variant asked about is the one answered about: a manifest that knows
    // only `web` must not date `wechat` by it.
    it('does not answer for a variant the manifest does not carry', () => {
        const now = Date.now();
        checkout(now - HOUR);
        manifest({ schema: 2, variants: { web: { builtAt: new Date(now - 48 * HOUR).toISOString() } } });
        expect(staleEngineBuild(root, wasmDir, 'wechat')).toBeNull();
    });
});
