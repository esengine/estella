// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    api.ts
 * @brief   The shape of what the transpiler knows of the engine's shader headers (see engineApi.generated.ts).
 */

/** How a parameter is passed. */
export type ParamQualifier = 'in' | 'out' | 'inout';

/** One domain's header (Lit, Unlit, PostProcess), as a shader's own GLSL sees it and where each name lives in WGSL. */
export interface DomainApi {
    /** GLSL functions with a WGSL counterpart: name -> [return type, [type, qualifier, array size, name][]]. */
    fns: Record<string, [string, [string, ParamQualifier, number | null, string][]]>;
    /** GLSL structs: name -> [field, type, array size][] (the WGSL side declares the same fields). */
    structs: Record<string, [string, string, number | null][]>;
    /** Uniform block fields, samplers, privates and consts: name -> [type, array size, WGSL expression (null for a sampler)]. */
    globals: Record<string, [string, number | null, string | null]>;
    /** The VSOut the engine hands a fragment: field -> WGSL type. Empty where the domain gives none. */
    varyings: Record<string, string>;
    /** The engine's own samplers: GLSL name -> [unit, kind]. A twin names one by its unit (`t<unit>`, `s<unit>`); a depth texture
     *  has no sampler and is read by texel. */
    samplers: Record<string, [number, 'color' | 'depth']>;
}

export interface EngineShaderApi {
    /** How many parameters each WGSL function of the engine takes. */
    wgslArity: Record<string, number>;
    /** The fields of the struct an engine WGSL function returns, for one that returns one. A GLSL function that writes `out`
     *  parameters is called on the WGSL side as one returning them, by the same names. */
    wgslReturnFields: Record<string, string[]>;
    domains: Record<string, DomainApi>;
}
