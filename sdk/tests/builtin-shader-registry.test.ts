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
import { registerGroomSupport } from '../src/groom/groomSupport';
import { registerVoxelSupport } from '../src/voxel/voxelSupport';

const modules = [
    ['esengine/character-shaders', registerCharacterShaders],
    ['esengine/groom', registerGroomSupport],
    ['esengine/foliage', registerFoliageSupport],
    ['esengine/terrain', registerTerrainSupport],
    ['esengine/voxel', registerVoxelSupport],
    ['esengine/water', registerWaterSupport],
] as const;

describe('the built-in shaders that ship with modules', () => {
    it('are the module\'s to install, not the core list\'s', () => {
        const coreIds = BUILTIN_SHADER_TEMPLATES.map((t) => t.id);
        expect(coreIds).toEqual(expect.arrayContaining(['sprite-unlit', 'sprite-lit', 'model', 'toon', 'matcap']));
        expect(coreIds.filter(id => id in BUILTIN_SHADER_MODULE)).toEqual([]);
        // Whole shaders, not stubs: their fragment is GLSL, and a WebGPU device is given its WGSL as it compiles (esengine/wgsl).
        for (const id of ['toon', 'matcap']) expect(builtinShaderTemplate(id)!.source).toMatch(/^#pragma fragment[ \t]*\r?$/m);
    });

    it('appear once each module is installed, in a fixed order, and installing twice changes nothing', () => {
        const core = BUILTIN_SHADER_TEMPLATES.map(t => t.id);
        const installed: Record<string, string> = {};
        for (const [module, install] of modules) {
            const before = new Set(BUILTIN_SHADER_TEMPLATES.map(t => t.id));
            install();
            const added = BUILTIN_SHADER_TEMPLATES.filter(t => !before.has(t.id));
            expect(added.length).toBeGreaterThan(0);
            for (const template of added) installed[template.id] = module;
        }
        expect(BUILTIN_SHADER_MODULE).toEqual(installed);
        const moduleIds = Object.keys(BUILTIN_SHADER_MODULE);
        const once = BUILTIN_SHADER_TEMPLATES.map((t) => t.id);
        expect(once).toEqual([...core, ...moduleIds]);
        for (const [, install] of modules) install();
        expect(BUILTIN_SHADER_TEMPLATES.map((t) => t.id)).toEqual(once);
        for (const id of moduleIds) {
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
