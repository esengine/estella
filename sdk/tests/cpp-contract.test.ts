// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cpp-contract.test.ts
 * @brief   Handshake guard for the hand-written TS constants/enums that MUST
 *          stay byte-identical with a C++ definition across the WASM boundary.
 *
 * These cross-language contracts (tween wire enums, the particle color-LUT size,
 * the packed-Entity bit split, the tilemap cell encoding, the UI base layer) live
 * outside EHT's parsed component directory, so EHT does not generate them — they
 * are hand-copied with a "MUST match C++" comment and, until now, NO guard. A
 * silent drift here corrupts data at the boundary (mis-decoded entity handles,
 * wrong LUT stride, mis-rendered tiles) with no compile error.
 *
 * This test IS the guard: it parses the real C++ headers and asserts the shipping
 * TS values match. Add a value on one side and forget the other -> RED here, with
 * a message pointing at the drift. It is the test-time equivalent of the ABI-hash
 * handshake EHT already enforces for components.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { EasingType } from '../src/animation/Easing';
import { TweenState, LoopMode } from '../src/animation/TweenTypes';
import { TweenTarget } from '../src/animation/Tween';
import { GRADIENT_LUT_SIZE } from '../src/particle/gradient';
import { ENTITY_INDEX_BITS, ENTITY_GEN_BITS } from '../src/types';
import { TILE_ID_MASK, TILE_FLIP_H, TILE_FLIP_V, TILE_FLIP_D } from '../src/tilemap/tileBits';
import { CHUNK_SIZE } from '../src/tilemap/chunkCodec';

// Repo root is two levels up from sdk/tests/ (mirrors the spine integration tests).
const CPP = resolve(__dirname, '../../src/esengine');
const readCpp = (rel: string): string => {
    const p = resolve(CPP, rel);
    // Fail loud (not skip) if the source moved — a silently-disabled guard is
    // worse than no guard.
    if (!existsSync(p)) throw new Error(`C++ contract source missing: ${p}`);
    return readFileSync(p, 'utf8');
};

/** Strip C/C++ comments so they can't be mistaken for enum entries or values. */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * Parse a `enum class Name : type { ... }` body into ordered {name, value},
 * resolving implicit increments and explicit `= N` (decimal or 0x hex).
 */
function parseEnum(src: string, name: string): Array<{ name: string; value: number }> {
    const re = new RegExp(`enum\\s+class\\s+${name}\\s*(?::\\s*\\w+\\s*)?\\{([^}]*)\\}`);
    const m = re.exec(stripComments(src));
    if (!m) throw new Error(`C++ enum '${name}' not found`);
    const out: Array<{ name: string; value: number }> = [];
    let next = 0;
    for (const raw of m[1].split(',')) {
        const part = raw.trim();
        if (!part) continue;
        const em = /^(\w+)\s*(?:=\s*(.+))?$/.exec(part);
        if (!em) throw new Error(`C++ enum '${name}': cannot parse entry '${part}'`);
        const value = em[2] != null ? Number(em[2].trim()) : next;
        if (Number.isNaN(value)) throw new Error(`C++ enum '${name}': non-numeric value for '${em[1]}'`);
        out.push({ name: em[1], value });
        next = value + 1;
    }
    return out;
}

/** Parse a `[static|inline] constexpr <type> NAME = <value>;` integer constant. */
function parseConst(src: string, name: string): number {
    const m = new RegExp(`constexpr\\s+\\w+\\s+${name}\\s*=\\s*([^;]+);`).exec(stripComments(src));
    if (!m) throw new Error(`C++ constant '${name}' not found`);
    const v = Number(m[1].trim());
    if (Number.isNaN(v)) throw new Error(`C++ constant '${name}': non-numeric value '${m[1].trim()}'`);
    return v;
}

/** Drop a trailing sentinel (e.g. COUNT) and index the rest by name. */
function byName(entries: Array<{ name: string; value: number }>, sentinel = 'COUNT'): Map<string, number> {
    const map = new Map<string, number>();
    for (const e of entries) if (e.name !== sentinel) map.set(e.name, e.value);
    return map;
}

const sortedEntries = (m: Map<string, number>): Array<[string, number]> =>
    [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));

describe('C++ contract: animation tween enums (animation/TweenData.hpp)', () => {
    const src = readCpp('animation/TweenData.hpp');

    it('EasingType matches (same names + values, minus COUNT sentinel)', () => {
        // The TS easing dispatcher switches on these values; they are the wire
        // protocol for _anim_createTween's easing byte.
        expect(sortedEntries(new Map(Object.entries(EasingType))))
            .toEqual(sortedEntries(byName(parseEnum(src, 'EasingType'))));
    });

    it('TweenState matches', () => {
        expect(sortedEntries(new Map(Object.entries(TweenState))))
            .toEqual(sortedEntries(byName(parseEnum(src, 'TweenState'))));
    });

    it('LoopMode matches', () => {
        expect(sortedEntries(new Map(Object.entries(LoopMode))))
            .toEqual(sortedEntries(byName(parseEnum(src, 'LoopMode'))));
    });

    it('TweenTarget matches by value sequence (TS uses abbreviated names)', () => {
        // TS abbreviates the names (PositionX vs C++ TransformPositionX) but the
        // ordered numeric values ARE the boundary contract, so guard those.
        const cppValues = parseEnum(src, 'TweenTarget')
            .filter((e) => e.name !== 'COUNT')
            .map((e) => e.value);
        expect(Object.values(TweenTarget)).toEqual(cppValues);
    });
});

describe('C++ contract: particle color LUT (particle/ParticleSystem.hpp)', () => {
    it('GRADIENT_LUT_SIZE === kColorLutSize', () => {
        // The baked gradient is uploaded as a flat kColorLutSize*4 float array; a
        // mismatch would over/under-run the C++ ColorLut on setColorGradient.
        const cpp = parseConst(readCpp('particle/ParticleSystem.hpp'), 'kColorLutSize');
        expect(GRADIENT_LUT_SIZE).toBe(cpp);
    });
});

describe('C++ contract: packed Entity bit split (core/Types.hpp)', () => {
    it('ENTITY_INDEX_BITS / ENTITY_GEN_BITS === PackedId<index, gen>', () => {
        // Entity handles cross the boundary as a raw u32; the wrong split silently
        // mis-decodes index/generation -> stale-handle detection breaks.
        const m = /PackedId<\s*(\d+)\s*,\s*(\d+)\s*>/.exec(stripComments(readCpp('core/Types.hpp')));
        if (!m) throw new Error('C++ Entity::Layout PackedId<index, gen> not found');
        expect([ENTITY_INDEX_BITS, ENTITY_GEN_BITS]).toEqual([Number(m[1]), Number(m[2])]);
    });
});

describe('C++ contract: tilemap cell encoding (tilemap/TilemapSystem.hpp)', () => {
    const src = readCpp('tilemap/TilemapSystem.hpp');

    it('tile id mask + flip bits match', () => {
        expect({
            TILE_ID_MASK,
            TILE_FLIP_H,
            TILE_FLIP_V,
            TILE_FLIP_D,
        }).toEqual({
            TILE_ID_MASK: parseConst(src, 'TILE_ID_MASK'),
            TILE_FLIP_H: parseConst(src, 'TILE_FLIP_H'),
            TILE_FLIP_V: parseConst(src, 'TILE_FLIP_V'),
            TILE_FLIP_D: parseConst(src, 'TILE_FLIP_D'),
        });
    });

    it('CHUNK_SIZE matches (chunk codec stride)', () => {
        expect(CHUNK_SIZE).toBe(parseConst(src, 'CHUNK_SIZE'));
    });
});

describe('C++ contract: UI base layer (renderer/plugins/UIElementPlugin.hpp)', () => {
    it('UI_BASE_LAYER matches the TS text renderer', () => {
        // Not exported (module-private), so guard the source values directly:
        // the C++ plugin and the TS text plugin must agree on the UI layer base.
        const cpp = parseConst(readCpp('renderer/plugins/UIElementPlugin.hpp'), 'UI_BASE_LAYER');
        const tsSrc = readFileSync(resolve(__dirname, '../src/ui/text/plugin.ts'), 'utf8');
        const tsm = /UI_BASE_LAYER\s*=\s*(\d+)/.exec(stripComments(tsSrc));
        if (!tsm) throw new Error('TS UI_BASE_LAYER not found in ui/text/plugin.ts');
        expect(Number(tsm[1])).toBe(cpp);
    });
});
