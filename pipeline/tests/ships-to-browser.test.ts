// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A web package carries the entry the page names and no other host's.
 *
 * `sdk/dist` holds every target's build side by side, so the staging step is the
 * only thing standing between a browser package and the Node, WeChat, mini-game
 * and native SDKs. The set it keeps is derived from the import map, because an
 * enumerated one went stale the first time an entry was added.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { shipsToBrowser } from '../src/export/exportGame';
import { IMPORT_MAP } from '../src/bundle/importMap';

const DIST = path.resolve('/tmp/does-not-need-to-exist/dist');
const at = (rel: string) => path.join(DIST, rel);

describe('what a web export stages from sdk/dist', () => {
    const keeps = shipsToBrowser(false, DIST);

    it('keeps exactly the top-level files the import map names', () => {
        const named = Object.values(IMPORT_MAP.imports)
            .map((t) => t.replace('./sdk/', ''))
            .filter((t) => !t.includes('/'));
        for (const f of named) expect(keeps(at(f)), f).toBe(true);
    });

    it.each([
        'index.node.js', 'index.wechat.js', 'index.wechat.cjs.js', 'index.wechat.lean.js',
        'index.minigame.js', 'index.native.js', 'index.native.bundled.js', 'index.bundled.js',
        'open-data.js',
    ])('drops %s — a browser page can never load it', (f) => {
        expect(keeps(at(f))).toBe(false);
    });

    it('keeps a subpath entry, which lives in its own directory', () => {
        for (const f of ['spine/index.js', 'physics/index.js', 'douyin/index.js']) {
            expect(keeps(at(f)), f).toBe(true);
        }
    });

    it('keeps the shared chunks, which are not entries and are named by nothing', () => {
        expect(keeps(at('shared/webAppFactory.js'))).toBe(true);
    });

    it('drops declarations and, without source maps, the maps', () => {
        expect(keeps(at('index.d.ts'))).toBe(false);
        expect(keeps(at('index.js.map'))).toBe(false);
        expect(shipsToBrowser(true, DIST)(at('index.js.map'))).toBe(true);
        expect(shipsToBrowser(true, DIST)(at('index.wechat.js.map'))).toBe(false);
    });
});
