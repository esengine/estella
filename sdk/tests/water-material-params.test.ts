// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { reflectEsshader } from '../src/render/shaderReflect';
import { WATER_SHADER_TEMPLATE } from '../src/water/waterShader';

const params = reflectEsshader(WATER_SHADER_TEMPLATE.source).params;
const plugin = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'water', 'waterPlugin.ts'), 'utf8');
/** Every uniform the water plugin writes onto the surface's material instances. */
const written = new Set([...plugin.matchAll(/(?:set|Material\.setUniform\([^,]+,)\s*\(?'(u_\w+)'/g)].map((m) => m[1]!));

describe('the Water material, as Details shows it', () => {
    it('hides every parameter the water writes each frame: an edit to one would be overwritten', () => {
        expect(written.size).toBeGreaterThan(20);
        const shown = params.filter((p) => written.has(p.name) && p.ui !== 'hidden').map((p) => p.name);
        expect(shown).toEqual([]);
    });

    it('puts every parameter an author sets in a group, so the inspector is sections and not one list of seventy', () => {
        const loose = params.filter((p) => p.ui !== 'hidden' && !p.group).map((p) => p.name);
        expect(loose).toEqual([]);
        expect(new Set(params.filter((p) => p.ui !== 'hidden').map((p) => p.group))).toEqual(new Set(['Colour', 'Surface', 'Ripples', 'Foam', 'Detail', 'Caustics']));
    });

    it('gives a new material none of the hidden parameters, only what an author sets', () => {
        const hidden = params.filter((p) => p.ui === 'hidden').map((p) => p.name);
        expect(hidden.length).toBeGreaterThan(20);
        for (const name of hidden) expect(WATER_SHADER_TEMPLATE.defaults).not.toHaveProperty(name);
        expect(WATER_SHADER_TEMPLATE.defaults).toHaveProperty('u_shallowColor');
        expect(WATER_SHADER_TEMPLATE.defaults).toHaveProperty('u_foamWidth');
    });
});
