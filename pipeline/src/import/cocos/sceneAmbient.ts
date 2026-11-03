// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The ambient light most of a project's scenes share, as the values Cocos hands a fragment (`cc_ambientSky`, `cc_ambientGround`).
 *
 * A converted effect reads these as parameters of its material, which start at a value that changes nothing. A scene that lights its models by the
 * ambient (a fake light that adds the ground colour times the sky's illumination) comes out as bright as that value is wrong, so the parameters
 * start at what the project's scenes set: one value for every material, the one most of them agree on.
 */
import { readFileSync } from 'node:fs';
import type { CocosAssetIndex } from './assets';

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Scenes that are tools and tests of the editor: what they set is not what the game draws with. */
const NOT_THE_GAME = /(?:^|\/)(?:editor|test|tools?)(?:\/|$)|(?:^|\/)(?:MapEditor|scene-test)/i;

export interface SceneAmbient {
    /** `cc_ambientSky`: the sky colour and, in w, the illumination it is lit by. */
    sky: [number, number, number, number];
    /** `cc_ambientGround`: the ground albedo, and 1. */
    ground: [number, number, number, number];
}

const three = (v: unknown): [number, number, number] | null =>
    isObj(v) && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number' ? [v.x, v.y, v.z] : null;

/** The ambient of one scene file, or null when it sets none. */
export function ambientOfScene(file: string): SceneAmbient | null {
    try {
        const objs = JSON.parse(readFileSync(file, 'utf8')) as unknown[];
        const head = objs[0];
        const scene = isObj(head) && isObj(head.scene) && typeof head.scene.__id__ === 'number' ? objs[head.scene.__id__] : null;
        const globals = isObj(scene) && isObj(scene._globals) && typeof scene._globals.__id__ === 'number' ? objs[scene._globals.__id__] : null;
        const info = isObj(globals) && isObj(globals.ambient) && typeof globals.ambient.__id__ === 'number' ? objs[globals.ambient.__id__] : null;
        if (!isObj(info)) return null;
        const sky = three(info._skyColorLDR);
        const ground = three(info._groundAlbedoLDR);
        if (!sky || !ground) return null;
        const illum = typeof info._skyIllumLDR === 'number' ? info._skyIllumLDR : 1;
        return { sky: [sky[0], sky[1], sky[2], illum], ground: [ground[0], ground[1], ground[2], 1] };
    } catch {
        return null;
    }
}

/** The ambient most of the project's game scenes set, or null when none does. */
export function dominantAmbient(index: CocosAssetIndex): SceneAmbient | null {
    const tally = new Map<string, { count: number; ambient: SceneAmbient }>();
    const seen = new Set<string>();
    for (const entry of index.byUuid.values()) {
        if (seen.has(entry.file) || !entry.rel.endsWith('.scene') || NOT_THE_GAME.test(entry.rel)) continue;
        seen.add(entry.file);
        const ambient = ambientOfScene(entry.file);
        if (!ambient) continue;
        const key = [...ambient.sky, ...ambient.ground].map((x) => x.toFixed(4)).join(',');
        const held = tally.get(key);
        if (held) held.count++;
        else tally.set(key, { count: 1, ambient });
    }
    let best: { count: number; ambient: SceneAmbient } | null = null;
    for (const t of tally.values()) if (!best || t.count > best.count) best = t;
    return best?.ambient ?? null;
}
