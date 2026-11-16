// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    twin.ts
 * @brief   A shader source with the WGSL its GLSL translates to, for a device that draws through WebGPU.
 */
import { ENGINE_SHADER_API } from './engineApi.generated';
import { transpileFragment, transpileVertexHook } from './transpile';

const GLSL_FRAGMENT = /^#pragma fragment[ \t]*\r?$/m;
const WGSL_FRAGMENT = /^#pragma fragment wgsl\b/m;
const GLSL_VERTEX = /^#pragma vertex[ \t]*\r?$/m;
const WGSL_VERTEX = /^#pragma vertex wgsl\b/m;
const GLSL_HOOK = /^#pragma vertexoffset[ \t]*\r?$/m;
const WGSL_HOOK = /^#pragma vertexoffset wgsl\b/m;

/** Twins by source: a shader compiles once per permutation, and the twin of one source is the same for all of them. */
const twins = new Map<string, string>();
const refused = new Set<string>();

/**
 * `source` with the WGSL of each GLSL section that has none: its fragment (`#pragma fragment wgsl`) and its vertex hook
 * (`#pragma vertexoffset wgsl`). A section that already has its WGSL keeps it. A source whose own vertex stage has no WGSL (which
 * this does not write) is returned as it is, and so is one the transpiler cannot read, with a warning naming why, once.
 */
export function withWgslTwin(source: string): string {
    const fragment = GLSL_FRAGMENT.test(source) && !WGSL_FRAGMENT.test(source);
    const hook = GLSL_HOOK.test(source) && !WGSL_HOOK.test(source);
    if (!fragment && !hook) return source;
    if (GLSL_VERTEX.test(source) && !WGSL_VERTEX.test(source)) return source;
    const cached = twins.get(source);
    if (cached !== undefined) return cached;
    if (refused.has(source)) return source;
    try {
        let out = source.trimEnd();
        if (fragment) out += `\n\n#pragma fragment wgsl\n${transpileFragment(source, ENGINE_SHADER_API)}\n#pragma end`;
        if (hook) out += `\n\n#pragma vertexoffset wgsl\n${transpileVertexHook(source, ENGINE_SHADER_API)}\n#pragma end`;
        out += '\n';
        twins.set(source, out);
        return out;
    } catch (e) {
        refused.add(source);
        const name = /^#pragma shader\s+"([^"]*)"/m.exec(source)?.[1] ?? 'a shader';
        console.warn(`[wgsl] ${name} has no WGSL twin and could not be given one: ${(e as Error).message}`);
        return source;
    }
}
