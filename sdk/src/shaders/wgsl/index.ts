// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   esengine/wgsl — shaders written once, in GLSL, drawn through WebGPU.
 *
 * A shader is written in GLSL; a device that draws through WebGPU needs WGSL. Importing this subpath installs the transpiler that
 * writes a shader's GLSL fragment as WGSL as the shader is compiled, so a host imports it where it draws through WebGPU and nowhere
 * else: a package that only draws through WebGL carries none of it.
 */
import { installWgslTranspiler } from './install';

export { transpileFragment } from './transpile';
export { GlslError } from './parse';
export { withWgslTwin, wgslTwinProblem, type WgslTwinProblem } from './twin';
export { installWgslTranspiler } from './install';

// Importing this subpath INSTALLS the transpiler — see tilemap/index.ts.
installWgslTranspiler();
