// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import {
    BUILTIN_SHADER_TEMPLATES, BUILTIN_SHADER_MODULE, builtinShaderTemplate, registerBuiltinShaderTemplate, makeBuiltinShaderTemplate,
} from '../src/render/builtinShaders';
import { registerWaterSupport } from '../src/water/waterSupport';
import { registerTerrainSupport } from '../src/terrain/terrainSupport';
import { registerFoliageSupport } from '../src/foliage/foliageSupport';
import { registerCharacterShaders } from '../src/character/characterSupport';

const MODULE_IDS = ['water', 'underwater', 'terrain', 'terrain-layers', 'foliage', 'hair', 'skin', 'eye'];

describe('the built-in shaders that ship with modules', () => {
    it('are the module\'s to install, not the core list\'s', () => {
        // The core list carries the sprite and model shaders; water, terrain, foliage and the character shaders arrive when their module is installed.
        const coreIds = BUILTIN_SHADER_TEMPLATES.map((t) => t.id).filter((id) => !MODULE_IDS.includes(id));
        expect(coreIds).toEqual(expect.arrayContaining(['sprite-unlit', 'sprite-lit', 'model', 'toon', 'matcap']));
        // Whole shaders, not stubs: their fragment is GLSL, and a WebGPU device is given its WGSL as it compiles (esengine/wgsl).
        for (const id of ['toon', 'matcap']) expect(builtinShaderTemplate(id)!.source).toMatch(/^#pragma fragment[ \t]*\r?$/m);
        expect(Object.keys(BUILTIN_SHADER_MODULE).sort()).toEqual([...MODULE_IDS].sort());
    });

    it('appear once each module is installed, in a fixed order, and installing twice changes nothing', () => {
        registerWaterSupport(); registerTerrainSupport(); registerFoliageSupport(); registerCharacterShaders();
        const once = BUILTIN_SHADER_TEMPLATES.map((t) => t.id);
        registerCharacterShaders(); registerWaterSupport();
        expect(BUILTIN_SHADER_TEMPLATES.map((t) => t.id)).toEqual(once);
        expect(once.filter((id) => MODULE_IDS.includes(id))).toEqual(MODULE_IDS);
        // The module ones follow the core's.
        expect(once.indexOf('model')).toBeLessThan(once.indexOf('water'));
        for (const id of MODULE_IDS) {
            const t = builtinShaderTemplate(id)!;
            expect(t.source.startsWith('#pragma shader')).toBe(true);
            expect(Object.keys(t.defaults).length).toBeGreaterThan(0);
        }
    });

    it('can be registered by anyone, and the same id replaces', () => {
        const mine = makeBuiltinShaderTemplate('water', 'Mine', 'x', builtinShaderTemplate('sprite-unlit')!.source);
        const before = builtinShaderTemplate('water');
        registerBuiltinShaderTemplate(mine);
        expect(builtinShaderTemplate('water')!.label).toBe('Mine');
        registerBuiltinShaderTemplate(before!);
        expect(builtinShaderTemplate('water')!.label).toBe('Water');
    });
});
