// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  waterSupport.ts — what a build that ships water tells the core.
 *
 * A call, not a file's side effect — see tilemap/tilemapSupport.ts.
 */
import { addEntryPlugin } from '../runtime/entryPlugins';
import { registerBuiltinShaderTemplate, makeBuiltinShaderTemplate } from '../render/builtinShaders';
import { WATER_SHADER_TEMPLATE } from './waterShader';
import { WATERFALL_SHADER_TEMPLATE } from './waterfallShader';
import { WaterPlugin } from './waterPlugin';
import { FloatingPlugin } from './floating';
import { UNDERWATER_SHADER, UnderwaterPlugin, registerUnderwaterEffect } from './underwater';

export function registerWaterSupport(): void {
    registerBuiltinShaderTemplate(WATER_SHADER_TEMPLATE);
    registerBuiltinShaderTemplate(makeBuiltinShaderTemplate('underwater', 'Underwater', 'Submerged lens, scattering and wave caustics.', UNDERWATER_SHADER));
    registerBuiltinShaderTemplate(WATERFALL_SHADER_TEMPLATE);
    addEntryPlugin('water', () => new WaterPlugin());
    addEntryPlugin('floating', () => new FloatingPlugin());
    addEntryPlugin('underwater', () => new UnderwaterPlugin());
    registerUnderwaterEffect();
}
