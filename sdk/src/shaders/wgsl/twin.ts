// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    twin.ts
 * @brief   A shader source with the WGSL twin its GLSL fragment translates to, for a device that draws through WebGPU.
 */
import { ENGINE_SHADER_API } from './engineApi.generated';
import { transpileFragment } from './transpile';

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
 * `source` with `#pragma fragment wgsl` written from its GLSL fragment, when it has the one and not the other. A source that
 * already has a twin, or whose own vertex stage or vertex hook has no WGSL (which this does not write yet), is returned as it is;
 * so is one the transpiler cannot read, with a warning naming why, once.
 */
export function withWgslTwin(source: string): string {
    if (!GLSL_FRAGMENT.test(source) || WGSL_FRAGMENT.test(source)) return source;
    if ((GLSL_VERTEX.test(source) && !WGSL_VERTEX.test(source)) || (GLSL_HOOK.test(source) && !WGSL_HOOK.test(source))) return source;
    const cached = twins.get(source);
    if (cached !== undefined) return cached;
    if (refused.has(source)) return source;
    try {
        const wgsl = transpileFragment(source, ENGINE_SHADER_API);
        const out = `${source.trimEnd()}\n\n#pragma fragment wgsl\n${wgsl}\n#pragma end\n`;
        twins.set(source, out);
        return out;
    } catch (e) {
        refused.add(source);
        const name = /^#pragma shader\s+"([^"]*)"/m.exec(source)?.[1] ?? 'a shader';
        console.warn(`[wgsl] ${name} has no WGSL twin and could not be given one: ${(e as Error).message}`);
        return source;
    }
}
