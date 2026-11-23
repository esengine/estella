// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  groomSupport.ts — what a build that ships grooms tells the core.
 *
 * A call, not a file's side effect — see tilemap/tilemapSupport.ts.
 */
import { addEntryPlugin } from '../runtime/entryPlugins';
import { registerBuiltinShaderTemplate } from '../render/builtinShaders';
import { STRANDS_SHADER_TEMPLATE } from './groomShader';
import { GroomPlugin } from './groomPlugin';

export function registerGroomSupport(): void {
    registerBuiltinShaderTemplate(STRANDS_SHADER_TEMPLATE);
    addEntryPlugin('groom', () => new GroomPlugin());
}
