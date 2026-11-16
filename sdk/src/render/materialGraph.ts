// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    materialGraph.ts
 * @brief   Material Graph → `.esshader` compiler (REARCH_MATERIAL §4.4, P5).
 * @details A material graph is a **visual frontend that generates a `.esshader`**, not a parallel
 *          pipeline: `compileMaterialGraph` emits GLSL whose backend is the same ShaderParser
 *          path (`compileEsshader` → MaterialConstants block + sampler units + variants). Const /
 *          texture nodes become `#pragma param`s, so a graph's inputs are ordinary, reflected,
 *          editable material parameters — one reflection model for hand-written and graph shaders
 *          alike. The vertex stage is fixed (2D bakes the transform into the batch vertices); the
 *          programmable surface is the fragment, which this compiler builds by topologically
 *          walking the node DAG from the output.
 *
 * @beta   Pre-1.0: the material-graph node set and serialized shape may still change.
 */

/** A node's GLSL output type. Determines how it combines and how it promotes to fragColor. */
export type GraphType = 'float' | 'vec2' | 'vec3' | 'vec4';

import { RENAMED_DOMAINS } from './shaderReflect';
import { NOISE2D_GLSL, NOISE2D_WGSL } from './shaderLib';

export type GraphNodeType =
  | 'output' // the root: its `color` input becomes fragColor
  | 'subgraph' // another graph used as one node (inlined before compile)
  | 'subInput' // inside a subgraph: one of its inputs, read by the nodes that use it
  | 'subOutput' // inside a subgraph: its result
  | 'normalMap' // sample a tangent-space normal map (read as data, unpacked like the standard material)
  | 'channel' // one component (r/g/b/a) of a value, as a scalar
  | 'literal' // a constant the compiler makes when a subgraph input is left unconnected
  | 'uvTransform' // uv × tiling + offset
  | 'switch' // a compile-time variant: one of two values, chosen by a #pragma switch the material turns on or off
  | 'uv' // v_texCoord
  | 'vertexColor' // v_color (the sprite's per-instance tint)
  | 'time' // u_time.x — the injected engine frame clock (seconds)
  | 'screenUV' // gl_FragCoord over the canvas size (0..1, y-up)
  | 'constFloat' // a scalar material param (#pragma param ... float)
  | 'constColor' // an RGBA material param (#pragma param ... color)
  | 'textureSample' // sample a texture material param at a UV (#pragma param ... texture)
  | 'multiply'
  | 'add'
  | 'lerp'
  | 'oneMinus' // 1 - x (invert a mask)
  | 'saturate' // clamp(x, 0, 1)
  | 'sin'
  | 'smoothstep' // smoothstep(edge0, edge1, x) — edges are node literals
  | 'noise' // procedural value noise over a UV (scale is a node literal)
  | 'panner'; // uv + time × speed (speed is a node literal pair)

export interface MaterialGraphNode {
  id: string;
  type: GraphNodeType;
  /** Node literals: param `name`, scalar/color `value`, texture `default`. */
  params?: Record<string, unknown>;
  /** Input slot → source node id (e.g. multiply: `{ a, b }`; textureSample: `{ uv? }`). */
  inputs?: Record<string, string>;
  /** Editor canvas position (px). Ignored by the compiler — layout only. */
  x?: number;
  y?: number;
}

export interface MaterialGraph {
  /** `'subgraph'` for a `.esmatsub` — a graph meant to be used as a node, ending in a `subOutput`. */
  kind?: 'subgraph';
  name?: string;
  /** Material domain (Unlit default; Lit etc. flow through unchanged, under its current name). */
  domain?: string;
  /** Id of the `output` node — the compile root. */
  output: string;
  nodes: MaterialGraphNode[];
}

const TYPE_RANK: Record<GraphType, number> = { float: 1, vec2: 2, vec3: 3, vec4: 4 };

/** The wider of two types (vecN op float broadcasts in both languages; mixing vec2 with vec4 is invalid). */
function widen(a: GraphType, b: GraphType): GraphType {
  return TYPE_RANK[a] >= TYPE_RANK[b] ? a : b;
}

/** GraphType → WGSL type name (the GLSL names are the GraphType strings themselves). */
const WGSL_TYPE: Record<GraphType, string> = { float: 'f32', vec2: 'vec2f', vec3: 'vec3f', vec4: 'vec4f' };

/** Promote a GLSL expression of @p type to a vec4 (for fragColor / mix endpoints). */
function toVec4(expr: string, type: GraphType): string {
  switch (type) {
    case 'vec4': return expr;
    case 'vec3': return `vec4(${expr}, 1.0)`;
    case 'vec2': return `vec4(${expr}, 0.0, 1.0)`;
    case 'float': return `vec4(vec3(${expr}), 1.0)`;
  }
}

/** WGSL twin of toVec4. */
function toVec4W(expr: string, type: GraphType): string {
  switch (type) {
    case 'vec4': return expr;
    case 'vec3': return `vec4f(${expr}, 1.0)`;
    case 'vec2': return `vec4f(${expr}, 0.0, 1.0)`;
    case 'float': return `vec4f(vec3f(${expr}), 1.0)`;
  }
}

/** A node's compiled value: one expression per language, one shared type. */
interface Emitted {
  expr: string;   // GLSL
  wexpr: string;  // WGSL
  type: GraphType;
}

/**
 * Compile a material graph into a `.esshader` source string (assembled by the engine's
 * ShaderParser like any hand-written shader). Emits BOTH stage languages — the GLSL fragment
 * and its `#pragma fragment wgsl` twin — from one DAG walk, so a graph material runs on
 * either backend. Throws on a missing node/input, a cycle, an unknown node type, or an
 * output root that isn't an `output` node.
 */
export function compileMaterialGraph(source: MaterialGraph, resolve?: SubgraphResolver): string {
  const graph = resolve ? flattenSubgraphs(source, resolve) : source;
  if (graph.nodes.some((n) => n.type === 'subgraph')) throw new Error('material graph: a subgraph node needs a resolver to compile');
  const nodes = new Map(graph.nodes.map((n) => [n.id, n] as const));
  let memo = new Map<string, Emitted>();
  let visiting = new Set<string>();
  const params: string[] = [];
  let helpers = new Set<string>();
  let whelpers = new Set<string>();
  let body: string[] = [];
  let wbody: string[] = [];
  // The vertex offset is compiled in a second pass over the same nodes, into its own body, where the
  // fragment's inputs (the interpolated UV, a texture sample, the screen) do not exist.
  let vertexMode = false;
  const fragUv = (): Emitted => (vertexMode
    ? { expr: 'uv', wexpr: 'uv', type: 'vec2' }
    : { expr: 'v_texCoord', wexpr: 'v.v_texCoord', type: 'vec2' });
  const needsFragment = (n: MaterialGraphNode, what: string): void => {
    if (vertexMode) throw new Error(`material graph: node "${n.id}" (${n.type}) ${what}, which the vertex offset cannot`);
  };
  let tmp = 0;

  const numParam = (n: MaterialGraphNode, key: string, fallback: number): string => {
    const v = n.params?.[key];
    const f = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    return f.toFixed(4);
  };

  const paramName = (n: MaterialGraphNode) =>
    typeof n.params?.name === 'string' ? (n.params.name as string) : `u_${n.id}`;

  /** Append the same SSA temp to both bodies and return its Emitted value. */
  const line = (type: GraphType, glsl: string, wgsl: string): Emitted => {
    const t = `n${tmp++}`;
    body.push(`${type} ${t} = ${glsl};`);
    wbody.push(`let ${t} : ${WGSL_TYPE[type]} = ${wgsl};`);
    return { expr: t, wexpr: t, type };
  };

  function emit(id: string): Emitted {
    const cached = memo.get(id);
    if (cached) return cached;
    if (visiting.has(id)) throw new Error(`material graph: cycle through node "${id}"`);
    const n = nodes.get(id);
    if (!n) throw new Error(`material graph: missing node "${id}"`);
    visiting.add(id);

    const input = (slot: string): Emitted => {
      const src = n.inputs?.[slot];
      if (!src) throw new Error(`material graph: node "${id}" (${n.type}) missing input "${slot}"`);
      return emit(src);
    };

    let out: Emitted;
    switch (n.type) {
      case 'uv':
        out = fragUv();
        break;
      case 'vertexColor':
        needsFragment(n, 'reads the vertex colour');
        out = { expr: 'v_color', wexpr: 'v.v_color', type: 'vec4' };
        break;
      case 'time':
        out = { expr: 'u_time.x', wexpr: 'tc.u_time.x', type: 'float' };
        break;
      case 'screenUV': {
        needsFragment(n, 'reads the screen position');
        // 0..1, y-up on both backends: gl_FragCoord has a bottom-left origin,
        // the WGSL position builtin a top-left one — flip y before normalizing.
        out = line('vec2',
          'gl_FragCoord.xy * u_viewport.zw',
          'vec2f(v.pos.x, tc.u_viewport.y - v.pos.y) * tc.u_viewport.zw');
        break;
      }
      case 'constFloat': {
        const name = paramName(n);
        const v = typeof n.params?.value === 'number' ? n.params.value : 0;
        if (!params.includes(`#pragma param ${name} float default(${v})`)) params.push(`#pragma param ${name} float default(${v})`);
        out = { expr: name, wexpr: `mc.${name}`, type: 'float' };
        break;
      }
      case 'constColor': {
        const name = paramName(n);
        const c = Array.isArray(n.params?.value) ? (n.params!.value as number[]) : [1, 1, 1, 1];
        if (!params.includes(`#pragma param ${name} color default(${c.slice(0, 4).join(',')})`)) params.push(`#pragma param ${name} color default(${c.slice(0, 4).join(',')})`);
        out = { expr: name, wexpr: `mc.${name}`, type: 'vec4' };
        break;
      }
      case 'textureSample': {
        needsFragment(n, 'samples a texture');
        const name = paramName(n);
        const def = typeof n.params?.default === 'string' ? n.params.default : 'white';
        // A map that holds numbers (metal / rough / occlusion) must not be decoded as a colour.
        params.push(`#pragma param ${name} texture default(${def})${n.params?.data === true ? ' texel(data)' : ''}`);
        const uv = n.inputs?.uv ? input('uv') : fragUv();
        out = line('vec4',
          `texture(${name}, ${uv.expr})`,
          `textureSampleLevel(${name}, ${name}_s, ${uv.wexpr}, 0.0)`);
        break;
      }
      case 'multiply':
      case 'add': {
        const a = input('a');
        const b = input('b');
        const op = n.type === 'multiply' ? '*' : '+';
        // vecN op float broadcasts in both languages; vec2 op vec4 is invalid in both.
        out = line(widen(a.type, b.type),
          `${a.expr} ${op} ${b.expr}`,
          `${a.wexpr} ${op} ${b.wexpr}`);
        break;
      }
      case 'lerp': {
        const a = input('a');
        const b = input('b');
        const f = input('t');
        out = line('vec4',
          `mix(${toVec4(a.expr, a.type)}, ${toVec4(b.expr, b.type)}, ${f.expr})`,
          `mix(${toVec4W(a.wexpr, a.type)}, ${toVec4W(b.wexpr, b.type)}, ${f.wexpr})`);
        break;
      }
      case 'oneMinus':
      case 'saturate':
      case 'sin': {
        // Single-input, type-preserving — both languages broadcast scalar-vector
        // arithmetic; WGSL's saturate() replaces GLSL's mixed-type clamp.
        const a = input('x');
        const glsl = n.type === 'oneMinus' ? `1.0 - ${a.expr}`
          : n.type === 'saturate' ? `clamp(${a.expr}, 0.0, 1.0)`
          : `sin(${a.expr})`;
        const wgsl = n.type === 'oneMinus' ? `1.0 - ${a.wexpr}`
          : n.type === 'saturate' ? `saturate(${a.wexpr})`
          : `sin(${a.wexpr})`;
        out = line(a.type, glsl, wgsl);
        break;
      }
      case 'smoothstep': {
        // GLSL takes scalar edges for any genType x; WGSL wants all three the
        // same type, so the edges splat to x's type.
        const a = input('x');
        const e0 = numParam(n, 'edge0', 0);
        const e1 = numParam(n, 'edge1', 1);
        const wSplat = (e: string) => (a.type === 'float' ? e : `${WGSL_TYPE[a.type]}(${e})`);
        out = line(a.type,
          `smoothstep(${e0}, ${e1}, ${a.expr})`,
          `smoothstep(${wSplat(e0)}, ${wSplat(e1)}, ${a.wexpr})`);
        break;
      }
      case 'noise': {
        helpers.add(NOISE2D_GLSL);
        whelpers.add(NOISE2D_WGSL);
        const uv = n.inputs?.uv ? input('uv') : fragUv();
        const scale = numParam(n, 'scale', 12);
        out = line('float',
          `noise2d(${uv.expr} * ${scale})`,
          `noise2d(${uv.wexpr} * ${scale})`);
        break;
      }
      case 'panner': {
        const uv = n.inputs?.uv ? input('uv') : fragUv();
        const sx = numParam(n, 'speedX', 0.1);
        const sy = numParam(n, 'speedY', 0);
        out = line('vec2',
          `fract(${uv.expr} + u_time.x * vec2(${sx}, ${sy}))`,
          `fract(${uv.wexpr} + tc.u_time.x * vec2f(${sx}, ${sy}))`);
        break;
      }
      case 'normalMap': {
        needsFragment(n, 'samples a texture');
        const name = paramName(n);
        params.push(`#pragma param ${name} texture default(flatnormal) texel(data)`);
        const uv = n.inputs?.uv ? input('uv') : { expr: 'v_texCoord', wexpr: 'v.v_texCoord', type: 'vec2' as GraphType };
        out = line('vec3', `sampleNormal(${name}, ${uv.expr})`, `sampleNormal(${name}, ${name}_s, ${uv.wexpr})`);
        break;
      }
      case 'channel': {
        const a = input('v');
        const ch = (['r', 'g', 'b', 'a'] as const).find((c) => c === n.params?.channel) ?? 'r';
        const idx = 'rgba'.indexOf(ch);
        if (a.type === 'float') { out = a; break; }
        // A vec2 has no b / a, and a vec3 has no a: say so rather than emit a swizzle neither language accepts.
        if (idx >= TYPE_RANK[a.type]) throw new Error(`material graph: node "${id}" takes .${ch} of a ${a.type}`);
        out = line('float', `${a.expr}.${ch}`, `${a.wexpr}.${ch}`);
        break;
      }
      case 'uvTransform': {
        const uv = n.inputs?.uv ? input('uv') : fragUv();
        const tx = numParam(n, 'tileX', 1), ty = numParam(n, 'tileY', 1);
        const ox = numParam(n, 'offsetX', 0), oy = numParam(n, 'offsetY', 0);
        out = line('vec2', `${uv.expr} * vec2(${tx}, ${ty}) + vec2(${ox}, ${oy})`, `${uv.wexpr} * vec2f(${tx}, ${ty}) + vec2f(${ox}, ${oy})`);
        break;
      }
      case 'switch': {
        // Which value the material gets is decided when its shader is compiled, so the other side costs
        // nothing at run time: both languages' #ifdef is resolved before the stage is assembled.
        const feature = typeof n.params?.feature === 'string' ? n.params.feature : '';
        if (!/^[A-Z][A-Z0-9_]*$/.test(feature)) throw new Error(`material graph: node "${id}" (switch) needs a name in capitals, digits and underscores, got "${feature}"`);
        const on = input('on');
        const off = input('off');
        const same = on.type === off.type;
        const type: GraphType = same ? on.type : 'vec4';
        const gOn = same ? on.expr : toVec4(on.expr, on.type);
        const gOff = same ? off.expr : toVec4(off.expr, off.type);
        const wOn = same ? on.wexpr : toVec4W(on.wexpr, on.type);
        const wOff = same ? off.wexpr : toVec4W(off.wexpr, off.type);
        const decl = `#pragma switch ${feature}${n.params?.default === true ? ' default(on)' : ''}`;
        if (!params.includes(decl)) params.push(decl);
        const t = `n${tmp++}`;
        body.push(`${type} ${t};`, `#ifdef ${feature}`, `${t} = ${gOn};`, '#else', `${t} = ${gOff};`, '#endif');
        wbody.push(`var ${t} : ${WGSL_TYPE[type]};`, `#ifdef ${feature}`, `${t} = ${wOn};`, '#else', `${t} = ${wOff};`, '#endif');
        out = { expr: t, wexpr: t, type };
        break;
      }
      case 'literal': {
        const v = typeof n.params?.value === 'number' && Number.isFinite(n.params.value) ? n.params.value : 0;
        const ty = (['float', 'vec2', 'vec3', 'vec4'] as const).find((t) => t === n.params?.type) ?? 'float';
        const f = v.toFixed(4);
        out = ty === 'float'
          ? { expr: f, wexpr: f, type: 'float' }
          : { expr: `${ty}(${f})`, wexpr: `${WGSL_TYPE[ty]}(${f})`, type: ty };
        break;
      }
      case 'subInput': {
        // Only reached compiling a subgraph on its own (validation): it reads as its default.
        const inp = subgraphInputs({ nodes: [n], output: n.id })[0]!;
        const f = inp.default.toFixed(4);
        out = inp.type === 'float'
          ? { expr: f, wexpr: f, type: 'float' }
          : { expr: `${inp.type}(${f})`, wexpr: `${WGSL_TYPE[inp.type]}(${f})`, type: inp.type };
        break;
      }
      case 'output': {
        const c = input('color');
        out = { expr: toVec4(c.expr, c.type), wexpr: toVec4W(c.wexpr, c.type), type: 'vec4' };
        break;
      }
      default:
        throw new Error(`material graph: unknown node type "${(n as MaterialGraphNode).type}"`);
    }

    visiting.delete(id);
    memo.set(id, out);
    return out;
  }

  const root = nodes.get(graph.output);
  if (!root || root.type !== 'output') {
    throw new Error('material graph: `output` must reference an "output" node');
  }
  const result = emit(graph.output);

  // Standard-material surface: the `output` node's PBR ports (or a literal typed on one) turn this
  // graph into the Lit mesh shading the built-in `Model` shader uses — the same normal unpack, the
  // same metal-in-B / rough-in-G packing, occlusion on the ambient term only, emission after light.
  const outNode = nodes.get(graph.output)!;
  const PBR_SLOTS = ['normal', 'metallic', 'roughness', 'occlusion', 'emission'] as const;
  const hasLiteral = (slot: string): boolean => typeof outNode.params?.[`lit_${slot}`] === 'number';
  const pbr = PBR_SLOTS.some((s) => outNode.inputs?.[s] || hasLiteral(s));

  // The scalar / vec3 an optional port or its typed literal says; null when neither is there.
  const scalarOf = (slot: string, fallback: number): Emitted => {
    const src = outNode.inputs?.[slot];
    if (src) {
      const e = emit(src);
      return e.type === 'float' ? e : { expr: `${e.expr}.x`, wexpr: `${e.wexpr}.x`, type: 'float' };
    }
    const v = typeof outNode.params?.[`lit_${slot}`] === 'number' ? (outNode.params![`lit_${slot}`] as number) : fallback;
    return { expr: v.toFixed(4), wexpr: v.toFixed(4), type: 'float' };
  };
  const alphaE = scalarOf('alpha', 1);
  let surface: { glsl: string; wgsl: string } | null = null;
  if (pbr) {
    const base = emit(outNode.inputs!.color!);
    const baseGl = `${toVec4(base.expr, base.type)}.rgb`;
    const baseWg = `${toVec4W(base.wexpr, base.type)}.rgb`;
    const nrm = outNode.inputs?.normal ? emit(outNode.inputs.normal) : null;
    const nrmGl = nrm ? (nrm.type === 'vec3' ? nrm.expr : `${toVec4(nrm.expr, nrm.type)}.xyz`) : null;
    const nrmWg = nrm ? (nrm.type === 'vec3' ? nrm.wexpr : `${toVec4W(nrm.wexpr, nrm.type)}.xyz`) : null;
    const metal = scalarOf('metallic', 0);
    const rough = scalarOf('roughness', 1);
    const occ = scalarOf('occlusion', 1);
    let emisGl = 'vec3(0.0)';
    let emisWg = 'vec3f(0.0)';
    if (outNode.inputs?.emission) {
      const e = emit(outNode.inputs.emission);
      emisGl = `${toVec4(e.expr, e.type)}.rgb`;
      emisWg = `${toVec4W(e.wexpr, e.type)}.rgb`;
    }
    surface = {
      glsl: `#ifdef MESH_NORMALS
    highp vec3 sN = normalize(v_worldNormal);
${nrmGl ? `    sN = perturbNormal(sN, v_worldXYZ, v_texCoord, ${nrmGl});\n` : ''}    if (!gl_FrontFacing) sN = -sN;
    highp vec3 sP = v_worldXYZ;
#else
    vec3 sN = ${nrmGl ?? 'vec3(0.0, 0.0, 1.0)'};
    highp vec3 sP = vec3(v_worldPos, 0.0);
#endif
    vec3 lit = applyLightingPBR(${baseGl}, sN, sP, viewDirection(sP), ${metal.expr}, ${rough.expr}, 1.0, ${occ.expr});
    fragColor = vec4(lit + ${emisGl}, ${alphaE.expr});`,
      wgsl: `#ifdef MESH_NORMALS
    var sN = normalize(v.v_worldNormal);
${nrmWg ? `    sN = perturbNormal(sN, v.v_worldXYZ, v.v_texCoord, ${nrmWg});\n` : ''}    if (!front) { sN = -sN; }
    let sP = v.v_worldXYZ;
#else
    let sN = ${nrmWg ?? 'vec3f(0.0, 0.0, 1.0)'};
    let sP = vec3f(v.v_worldPos, 0.0);
#endif
    let lit = applyLightingPBR(${baseWg}, sN, sP, viewDirection(sP), ${metal.wexpr}, ${rough.wexpr}, 1.0, ${occ.wexpr});
    return vec4f(lit + ${emisWg}, ${alphaE.wexpr});`,
    };
  }
  const alphaOnly = !pbr && outNode.inputs?.alpha ? alphaE : null;

  // The vertex offset: its own DAG, compiled into `esMaterialVertex`, which the engine's mesh vertex stage
  // calls on each local-space vertex. A float moves the vertex along its normal; a vec2 / vec3 / vec4 is
  // a displacement (vec2 in x and y).
  let vertexHook = '';
  let wgslVertexHook = '';
  let vertexBounds = 0;
  const offsetSrc = outNode.inputs?.vertexOffset;
  if (offsetSrc) {
    const fragMemo = { memo, visiting, helpers, whelpers, body, wbody };
    memo = new Map(); visiting = new Set(); helpers = new Set(); whelpers = new Set(); body = []; wbody = [];
    vertexMode = true;
    const o = emit(offsetSrc);
    const disp = o.type === 'float' ? { gl: `localNormal * ${o.expr}`, wg: `(*localNormal) * ${o.wexpr}` }
      : o.type === 'vec2' ? { gl: `vec3(${o.expr}, 0.0)`, wg: `vec3f(${o.wexpr}, 0.0)` }
      : o.type === 'vec3' ? { gl: o.expr, wg: o.wexpr }
      : { gl: `${o.expr}.xyz`, wg: `${o.wexpr}.xyz` };
    const indent = (lines: string[]): string => lines.map((l) => '    ' + l).join('\n');
    vertexHook = `${helpers.size ? [...helpers].join('\n') + '\n' : ''}void esMaterialVertex(inout vec3 local, inout vec3 localNormal, in vec2 uv) {
${indent(body)}
    local += ${disp.gl};
}`;
    wgslVertexHook = `${whelpers.size ? [...whelpers].join('\n') + '\n' : ''}fn esMaterialVertex(local : ptr<function, vec3f>, localNormal : ptr<function, vec3f>, uv : vec2f) {
${indent(wbody)}
    *local = *local + ${disp.wg};
}`;
    ({ memo, visiting, helpers, whelpers, body, wbody } = fragMemo);
    vertexMode = false;
    const b = outNode.params?.lit_vertexBounds;
    vertexBounds = typeof b === 'number' && Number.isFinite(b) && b > 0 ? b : 0;
  }

  const name = graph.name ?? 'Graph';
  const domain = pbr ? 'Lit' : (RENAMED_DOMAINS[graph.domain ?? ''] ?? graph.domain ?? 'Unlit');
  const paramBlock = params.length ? params.join('\n') + '\n' : '';
  const helperBlock = helpers.size ? [...helpers].join('\n') + '\n\n' : '';
  const whelperBlock = whelpers.size ? [...whelpers].join('\n') + '\n\n' : '';
  const bodyBlock = body.map((l) => '    ' + l).join('\n');
  const wbodyBlock = wbody.map((l) => '    ' + l).join('\n');

  // Fragment-only: the canonical 2D vertex stage (and, for the twin, the VSOut
  // interface + batch textures + tc/mc blocks) is injected by the ShaderParser.
  return `#pragma shader "${name}"
#pragma version 300 es
#pragma domain ${domain}
${paramBlock}${vertexHook ? `${vertexBounds > 0 ? `#pragma vertexbounds ${vertexBounds}\n` : ''}\n#pragma vertexoffset\n${vertexHook}\n#pragma end\n\n#pragma vertexoffset wgsl\n${wgslVertexHook}\n#pragma end\n` : ''}
#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;
${pbr ? `in highp vec2 v_worldPos;
#ifdef MESH_NORMALS
in highp vec3 v_worldNormal;
in highp vec3 v_worldXYZ;
#endif
` : ''}
${helperBlock}out vec4 fragColor;

void main() {
${bodyBlock}
${surface ? surface.glsl : `    fragColor = ${alphaOnly ? `vec4((${result.expr}).rgb, ${alphaOnly.expr})` : result.expr};`}
}
#pragma end

#pragma fragment wgsl
${whelperBlock}@fragment fn fs_main(v : VSOut${pbr ? ', @builtin(front_facing) front : bool' : ''}) -> @location(0) vec4f {
${pbr ? `    g_probeSlot = v.v_probeSlot;
#ifdef MESH_LIGHTMAP
    g_lightmap = v.v_lightmap;
#endif
` : ''}${wbodyBlock}
${surface ? surface.wgsl : `    return ${alphaOnly ? `vec4f((${result.wexpr}).rgb, ${alphaOnly.wexpr})` : result.wexpr};`}
}
#pragma end
`;
}

// =============================================================================
// Editor schema + graph operations (the visual node editor, P5b)
// =============================================================================

/** A node input/output port. `type` drives the port's color hint; connections coerce freely. */
export interface NodePort {
  name: string;
  type: GraphType;
}

/** An editable node literal, surfaced as a node-inspector field. */
export interface NodeParamSpec {
  key: string;
  label: string;
  kind: 'color' | 'float' | 'texture' | 'bool' | 'channel' | 'text';
}

/** Static schema for a node type — the single source the palette, ports, and node inspector
 *  all read, kept beside the compiler so the editor and codegen never drift. */
export interface NodeSpec {
  label: string;
  inputs: NodePort[];
  /** Output port type, or null for the `output` sink (no output port). */
  output: GraphType | null;
  params: NodeParamSpec[];
  /** Whether the palette offers it (the singleton `output` node is not addable). */
  addable: boolean;
}

export const NODE_SPECS: Record<GraphNodeType, NodeSpec> = {
  // The ports of these three come from the subgraph a node names, so their specs are placeholders.
  subgraph: { label: 'Subgraph', inputs: [], output: 'float', params: [], addable: false },
  subInput: { label: 'Subgraph Input', inputs: [], output: 'float', params: [], addable: false },
  subOutput: { label: 'Subgraph Output', inputs: [{ name: 'value', type: 'float' }], output: null, params: [], addable: false },
  uvTransform: { label: 'Tiling & Offset', inputs: [{ name: 'uv', type: 'vec2' }], output: 'vec2', params: [{ key: 'tileX', label: 'Tiling X', kind: 'float' }, { key: 'tileY', label: 'Tiling Y', kind: 'float' }, { key: 'offsetX', label: 'Offset X', kind: 'float' }, { key: 'offsetY', label: 'Offset Y', kind: 'float' }], addable: true },
  switch: { label: 'Switch', inputs: [{ name: 'on', type: 'vec4' }, { name: 'off', type: 'vec4' }], output: 'vec4', params: [{ key: 'feature', label: 'Switch', kind: 'text' }, { key: 'default', label: 'Default on', kind: 'bool' }], addable: true },
  literal: { label: 'Literal', inputs: [], output: 'float', params: [], addable: false },
  output: {
    label: 'Output',
    inputs: [
      { name: 'color', type: 'vec4' }, { name: 'normal', type: 'vec3' }, { name: 'metallic', type: 'float' }, { name: 'roughness', type: 'float' },
      { name: 'occlusion', type: 'float' }, { name: 'emission', type: 'vec3' }, { name: 'alpha', type: 'float' },
      { name: 'vertexOffset', type: 'vec3' },
    ],
    output: null, params: [], addable: false,
  },
  normalMap: { label: 'Normal Map', inputs: [{ name: 'uv', type: 'vec2' }], output: 'vec3', params: [{ key: 'name', label: 'Param', kind: 'texture' }], addable: true },
  channel: { label: 'Channel', inputs: [{ name: 'v', type: 'vec4' }], output: 'float', params: [{ key: 'channel', label: 'Channel', kind: 'channel' }], addable: true },
  uv: { label: 'UV', inputs: [], output: 'vec2', params: [], addable: true },
  vertexColor: { label: 'Vertex Color', inputs: [], output: 'vec4', params: [], addable: true },
  time: { label: 'Time', inputs: [], output: 'float', params: [], addable: true },
  screenUV: { label: 'Screen UV', inputs: [], output: 'vec2', params: [], addable: true },
  constFloat: { label: 'Float', inputs: [], output: 'float', params: [{ key: 'value', label: 'Value', kind: 'float' }], addable: true },
  constColor: { label: 'Color', inputs: [], output: 'vec4', params: [{ key: 'value', label: 'Color', kind: 'color' }], addable: true },
  textureSample: { label: 'Texture', inputs: [{ name: 'uv', type: 'vec2' }], output: 'vec4', params: [{ key: 'name', label: 'Param', kind: 'texture' }, { key: 'data', label: 'Data', kind: 'bool' }], addable: true },
  multiply: { label: 'Multiply', inputs: [{ name: 'a', type: 'vec4' }, { name: 'b', type: 'vec4' }], output: 'vec4', params: [], addable: true },
  add: { label: 'Add', inputs: [{ name: 'a', type: 'vec4' }, { name: 'b', type: 'vec4' }], output: 'vec4', params: [], addable: true },
  lerp: { label: 'Lerp', inputs: [{ name: 'a', type: 'vec4' }, { name: 'b', type: 'vec4' }, { name: 't', type: 'float' }], output: 'vec4', params: [], addable: true },
  oneMinus: { label: 'One Minus', inputs: [{ name: 'x', type: 'vec4' }], output: 'vec4', params: [], addable: true },
  saturate: { label: 'Saturate', inputs: [{ name: 'x', type: 'vec4' }], output: 'vec4', params: [], addable: true },
  sin: { label: 'Sin', inputs: [{ name: 'x', type: 'float' }], output: 'float', params: [], addable: true },
  smoothstep: { label: 'Smoothstep', inputs: [{ name: 'x', type: 'float' }], output: 'float', params: [{ key: 'edge0', label: 'Edge 0', kind: 'float' }, { key: 'edge1', label: 'Edge 1', kind: 'float' }], addable: true },
  noise: { label: 'Noise', inputs: [{ name: 'uv', type: 'vec2' }], output: 'float', params: [{ key: 'scale', label: 'Scale', kind: 'float' }], addable: true },
  panner: { label: 'Panner', inputs: [{ name: 'uv', type: 'vec2' }], output: 'vec2', params: [{ key: 'speedX', label: 'Speed X', kind: 'float' }, { key: 'speedY', label: 'Speed Y', kind: 'float' }], addable: true },
};

/** A default starter graph: a white texture sample straight into the output. */
export function newMaterialGraph(): MaterialGraph {
  return {
    name: 'Graph',
    output: 'out',
    nodes: [
      { id: 'tex', type: 'textureSample', x: 60, y: 120, params: { name: 'u_albedo', default: 'white' } },
      { id: 'out', type: 'output', x: 360, y: 140, inputs: { color: 'tex' } },
    ],
  };
}

const clone = (g: MaterialGraph): MaterialGraph => JSON.parse(JSON.stringify(g)) as MaterialGraph;

/** A node id unused in @p g, of the form `<type><n>`. */
function freshId(g: MaterialGraph, type: GraphNodeType): string {
  const used = new Set(g.nodes.map((n) => n.id));
  for (let i = 1; ; i++) {
    const id = `${type}${i}`;
    if (!used.has(id)) return id;
  }
}

/** Default literal params for a freshly-added node (so its #pragma param compiles). */
function defaultParams(type: GraphNodeType, id: string): Record<string, unknown> | undefined {
  switch (type) {
    case 'constFloat': return { name: `u_${id}`, value: 1 };
    case 'constColor': return { name: `u_${id}`, value: [1, 1, 1, 1] };
    case 'textureSample': return { name: `u_${id}`, default: 'white' };
    case 'normalMap': return { name: `u_${id}` };
    case 'channel': return { channel: 'r' };
    case 'uvTransform': return { tileX: 1, tileY: 1, offsetX: 0, offsetY: 0 };
    case 'switch': return { feature: `ES_${id.toUpperCase()}`, default: false };
    case 'smoothstep': return { edge0: 0, edge1: 1 };
    case 'noise': return { scale: 12 };
    case 'panner': return { speedX: 0.1, speedY: 0 };
    default: return undefined;
  }
}

/** Add a node of @p type at canvas (@p x,@p y); returns the new graph + the new node id. */
export function addNode(g: MaterialGraph, type: GraphNodeType, x: number, y: number): { graph: MaterialGraph; id: string } {
  const next = clone(g);
  const id = freshId(g, type);
  next.nodes.push({ id, type, x, y, params: defaultParams(type, id) });
  return { graph: next, id };
}

/** Move a node to (@p x,@p y) on the canvas (layout only). */
export function moveNode(g: MaterialGraph, id: string, x: number, y: number): MaterialGraph {
  const next = clone(g);
  const n = next.nodes.find((m) => m.id === id);
  if (n) {
    n.x = x;
    n.y = y;
  }
  return next;
}

// =============================================================================
// Subgraphs: a graph used as one node, inlined before compile
// =============================================================================

/** How a graph finds a subgraph it names: by the `ref` its `subgraph` node carries. Null = not found. */
export type SubgraphResolver = (ref: string) => MaterialGraph | null;

/** One input a subgraph takes, read from its `subInput` nodes — what a node using it shows as ports. */
export interface SubgraphInput {
  /** The node id inside the subgraph, and the slot name on a `subgraph` node that uses it. */
  name: string;
  type: GraphType;
  /** What an unconnected input reads as, unless the using node overrides it with `params["in_<name>"]`. */
  default: number;
}

const MAX_SUBGRAPH_DEPTH = 8;

/** The inputs a subgraph exposes, in the order its nodes list them. */
export function subgraphInputs(sub: MaterialGraph): SubgraphInput[] {
  const out: SubgraphInput[] = [];
  for (const n of sub.nodes) {
    if (n.type !== 'subInput') continue;
    const name = typeof n.params?.name === 'string' && n.params.name ? n.params.name : n.id;
    const type = (['float', 'vec2', 'vec3', 'vec4'] as const).find((t) => t === n.params?.type) ?? 'float';
    out.push({ name, type, default: typeof n.params?.default === 'number' ? n.params.default : 0 });
  }
  return out;
}

/** The `ref`s a graph names, directly (not through the subgraphs those name). */
export function subgraphRefs(graph: MaterialGraph): string[] {
  return [...new Set(graph.nodes.filter((n) => n.type === 'subgraph').map((n) => String(n.params?.ref ?? '')).filter(Boolean))];
}

/**
 * Replace every `subgraph` node with the nodes of the graph it names, so the compiler only ever sees
 * plain nodes. An unconnected input becomes a literal (the subgraph's default, or the using node's
 * `in_<name>`); a connected one is the wire itself. Ids and explicit param names are prefixed with the
 * using node's id, so one subgraph used twice makes two independent copies — not one shared param.
 * Throws on a missing subgraph, a subgraph that contains itself, or nesting past 8 levels.
 */
export function flattenSubgraphs(graph: MaterialGraph, resolve: SubgraphResolver, stack: readonly string[] = []): MaterialGraph {
  if (!graph.nodes.some((n) => n.type === 'subgraph')) return graph;
  const nodes: MaterialGraphNode[] = [];
  const alias = new Map<string, string>();
  for (const n of graph.nodes) {
    if (n.type !== 'subgraph') {
      nodes.push({ ...n, inputs: n.inputs ? { ...n.inputs } : undefined });
      continue;
    }
    const ref = typeof n.params?.ref === 'string' ? n.params.ref : '';
    if (!ref) throw new Error(`material graph: subgraph node "${n.id}" names no subgraph`);
    if (stack.includes(ref)) throw new Error(`material graph: subgraph "${ref}" contains itself`);
    if (stack.length >= MAX_SUBGRAPH_DEPTH) throw new Error(`material graph: subgraphs nested deeper than ${MAX_SUBGRAPH_DEPTH}`);
    const sub = resolve(ref);
    if (!sub) throw new Error(`material graph: subgraph "${ref}" (node "${n.id}") not found`);
    const flat = flattenSubgraphs(sub, resolve, [...stack, ref]);
    const pre = (id: string): string => `${n.id}__${id}`;
    for (const sn of flat.nodes) {
      if (sn.type === 'subInput') {
        const inp = subgraphInputs({ ...flat, nodes: [sn] })[0]!;
        const src = n.inputs?.[inp.name];
        if (src) alias.set(pre(sn.id), src);
        else {
          const over = n.params?.[`in_${inp.name}`];
          nodes.push({ id: pre(sn.id), type: 'literal', params: { value: typeof over === 'number' ? over : inp.default, type: inp.type } });
        }
      } else if (sn.type === 'subOutput') {
        const value = sn.inputs?.value;
        if (!value) throw new Error(`material graph: subgraph "${ref}" has no value connected to its output`);
        alias.set(n.id, pre(value));
      } else {
        const params = sn.params ? { ...sn.params } : undefined;
        if (params && typeof params.name === 'string' && params.name) params.name = `${n.id}_${params.name}`;
        const inputs = sn.inputs ? Object.fromEntries(Object.entries(sn.inputs).map(([k, v]) => [k, pre(v)])) : undefined;
        nodes.push({ ...sn, id: pre(sn.id), params, inputs });
      }
    }
  }
  const settle = (id: string): string => {
    for (let i = 0; i < 64 && alias.has(id); i++) id = alias.get(id)!;
    return id;
  };
  for (const n of nodes) {
    if (!n.inputs) continue;
    for (const [k, v] of Object.entries(n.inputs)) n.inputs[k] = settle(v);
  }
  // A subgraph used inside another is expanded in the recursive call, so none remain here.
  return flattenSubgraphs({ ...graph, output: settle(graph.output), nodes }, resolve, stack);
}

/** A starter subgraph: one input, passed straight through. */
export function newMaterialSubgraph(): MaterialGraph {
  return {
    kind: 'subgraph',
    name: 'Subgraph',
    output: 'out',
    nodes: [
      { id: 'in1', type: 'subInput', x: 60, y: 80, params: { name: 'value', type: 'float', default: 0 } },
      { id: 'out', type: 'subOutput', x: 360, y: 80, inputs: { value: 'in1' } },
    ],
  };
}

/** What a node hands to those that read it, as far as the editor can tell without opening a subgraph. */
function outputTypeOf(n: MaterialGraphNode): GraphType {
  if (n.type === 'literal') return (['float', 'vec2', 'vec3', 'vec4'] as const).find((t) => t === n.params?.type) ?? 'float';
  if (n.type === 'subInput') return subgraphInputs({ nodes: [n], output: n.id })[0]!.type;
  return NODE_SPECS[n.type]?.output ?? 'float';
}

/**
 * The type a subgraph hands back, worked out from its nodes without compiling — what the editor
 * colours the using node's wire with. Falls back to float for anything it cannot tell.
 */
export function subgraphOutputType(sub: MaterialGraph): GraphType {
  const byId = new Map(sub.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const typeOf = (id: string): GraphType => {
    const n = byId.get(id);
    if (!n || seen.has(id)) return 'float';
    seen.add(id);
    try {
      const inp = (slot: string): GraphType => (n.inputs?.[slot] ? typeOf(n.inputs[slot]!) : 'float');
      switch (n.type) {
        case 'subOutput': return inp('value');
        case 'multiply': case 'add': return widen(inp('a'), inp('b'));
        case 'oneMinus': case 'saturate': return inp('x');
        case 'switch': { const a = inp('on'); return a === inp('off') ? a : 'vec4'; }
        case 'subgraph': return 'float';
        default: return outputTypeOf(n);
      }
    } finally { seen.delete(id); }
  };
  return typeOf(sub.output);
}

export interface ExtractedSubgraph {
  /** The new `.esmatsub`: the selection, with a `subInput` for each wire that came in from outside. */
  sub: MaterialGraph;
  /** The graph with the selection replaced by one `subgraph` node naming @p ref. */
  graph: MaterialGraph;
  /** The id of that node. */
  nodeId: string;
}

/**
 * Turn the nodes @p ids into a subgraph, and put one node using it in their place.
 *
 * Every wire from outside into the selection becomes an input (one per source node, named after the
 * slot it fed), and the one selected node that something outside reads becomes the result. Throws if
 * there is not exactly one such node — a subgraph has one result — or if the selection holds the
 * output. A node's own param names carry over unchanged; the subgraph node prefixes them, so a
 * material that set `u_tint` now finds it as `<node>_u_tint`.
 */
export function extractSubgraph(g: MaterialGraph, ids: readonly string[], ref: string, name = 'Subgraph'): ExtractedSubgraph {
  const chosen = new Set(ids);
  const picked = g.nodes.filter((n) => chosen.has(n.id));
  if (picked.length === 0) throw new Error('material graph: nothing selected to extract');
  if (picked.some((n) => n.type === 'output' || n.type === 'subOutput')) throw new Error('material graph: the output node cannot be moved into a subgraph');
  if (g.kind === 'subgraph' && picked.some((n) => n.type === 'subInput')) throw new Error('material graph: a subgraph input cannot be moved into another subgraph');

  // The selected nodes something outside reads: the result, and anything else is an error.
  const readFromOutside = new Set<string>();
  for (const n of g.nodes) {
    if (chosen.has(n.id)) continue;
    for (const src of Object.values(n.inputs ?? {})) if (chosen.has(src)) readFromOutside.add(src);
  }
  if (readFromOutside.size !== 1) {
    throw new Error(readFromOutside.size === 0
      ? 'material graph: nothing outside reads the selection, so it has no result'
      : `material graph: the selection has ${readFromOutside.size} results (${[...readFromOutside].join(', ')}); a subgraph has one`);
  }
  const result = [...readFromOutside][0]!;

  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const subNodes: MaterialGraphNode[] = [];
  const inputOf = new Map<string, string>(); // outside source id → the subInput that stands for it
  const taken = new Set<string>();
  const inputs: Record<string, string> = {};   // the subgraph node's slot → outside source id
  let k = 0;
  for (const n of picked) {
    const rewired: Record<string, string> = {};
    for (const [slot, src] of Object.entries(n.inputs ?? {})) {
      if (chosen.has(src)) { rewired[slot] = src; continue; }
      let inId = inputOf.get(src);
      if (!inId) {
        inId = `in${++k}`;
        inputOf.set(src, inId);
        let nm = slot;
        for (let i = 2; taken.has(nm); i++) nm = `${slot}${i}`;
        taken.add(nm);
        const source = byId.get(src);
        subNodes.push({ id: inId, type: 'subInput', params: { name: nm, type: source ? outputTypeOf(source) : 'float', default: 0 } });
        inputs[nm] = src;
      }
      rewired[slot] = inId;
    }
    subNodes.push({ ...n, inputs: Object.keys(rewired).length ? rewired : undefined, params: n.params ? { ...n.params } : undefined });
  }
  const resultId = result === 'result' ? 'sub_result' : 'result';
  subNodes.push({ id: resultId, type: 'subOutput', inputs: { value: result } });

  // Lay the new graph out from the selection's own corner, inputs to the left of what they feed.
  const placed = picked.filter((n) => typeof n.x === 'number' && typeof n.y === 'number');
  const left = placed.length ? Math.min(...placed.map((n) => n.x!)) : 0;
  const top = placed.length ? Math.min(...placed.map((n) => n.y!)) : 0;
  const right = placed.length ? Math.max(...placed.map((n) => n.x!)) : 0;
  for (const n of subNodes) {
    if (typeof n.x === 'number') n.x = n.x - left + 260;
    if (typeof n.y === 'number') n.y = n.y - top + 40;
  }
  let row = 0;
  for (const n of subNodes) if (n.type === 'subInput') { n.x = 40; n.y = 40 + 110 * row++; }
  const out = subNodes.find((n) => n.id === resultId)!;
  out.x = right - left + 260 + 340;
  out.y = 40;

  const sub: MaterialGraph = { kind: 'subgraph', name, output: resultId, nodes: subNodes };

  const used = new Set(g.nodes.map((n) => n.id));
  let nodeId = 'subgraph1';
  for (let i = 2; used.has(nodeId); i++) nodeId = `subgraph${i}`;
  const rest: MaterialGraphNode[] = g.nodes.filter((n) => !chosen.has(n.id)).map((n) => ({
    ...n,
    inputs: n.inputs ? Object.fromEntries(Object.entries(n.inputs).map(([slot, src]) => [slot, src === result ? nodeId : src])) : undefined,
  }));
  rest.push({ id: nodeId, type: 'subgraph', x: placed.length ? right : undefined, y: placed.length ? top : undefined, params: { ref }, inputs: Object.keys(inputs).length ? inputs : undefined });
  return { sub, graph: { ...g, nodes: rest }, nodeId };
}

/** Whether @p sub compiles when used — checked by wrapping its output in a throwaway material output. */
export function validateSubgraph(sub: MaterialGraph, resolve: SubgraphResolver): void {
  const probe: MaterialGraph = {
    name: 'probe', output: 'probe_out',
    nodes: [...sub.nodes.map((n) => ({ ...n })), { id: 'probe_out', type: 'output', inputs: { color: sub.output } }],
  };
  // The subOutput is a pass-through of its `value`; point the probe at that value directly.
  const so = sub.nodes.find((n) => n.id === sub.output && n.type === 'subOutput');
  if (!so) throw new Error('material graph: a subgraph\'s `output` must reference a "subOutput" node');
  probe.nodes[probe.nodes.length - 1]!.inputs = { color: so.inputs?.value ?? '' };
  compileMaterialGraph(probe, resolve);
}

/** Whether a path from @p fromId back to @p toId exists (so connecting them would loop). */
function reaches(g: MaterialGraph, fromId: string, toId: string): boolean {
  const byId = new Map(g.nodes.map((n) => [n.id, n] as const));
  const stack = [fromId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === toId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = byId.get(id);
    if (n?.inputs) stack.push(...Object.values(n.inputs));
  }
  return false;
}

/**
 * Connect @p fromId's output into @p toId's @p toSlot input. Rejected (returns the graph
 * unchanged) if it would create a cycle or the slot is unknown — so the canvas can't author an
 * uncompilable graph.
 */
export function connect(g: MaterialGraph, fromId: string, toId: string, toSlot: string): MaterialGraph {
  if (fromId === toId) return g;
  const to = g.nodes.find((n) => n.id === toId);
  // A subgraph node's slots are the inputs of the graph it names — checked when it compiles.
  if (!to || (to.type !== 'subgraph' && !NODE_SPECS[to.type].inputs.some((p) => p.name === toSlot))) return g;
  if (reaches(g, fromId, toId)) return g; // the source already depends on the target → cycle
  const next = clone(g);
  const n = next.nodes.find((m) => m.id === toId)!;
  (n.inputs ??= {})[toSlot] = fromId;
  return next;
}

/** Clear @p toId's @p toSlot input connection. */
export function disconnect(g: MaterialGraph, toId: string, toSlot: string): MaterialGraph {
  const next = clone(g);
  const n = next.nodes.find((m) => m.id === toId);
  if (n?.inputs) delete n.inputs[toSlot];
  return next;
}

/** Remove a node (and every edge into/out of it). The `output` node can't be removed. */
export function removeNode(g: MaterialGraph, id: string): MaterialGraph {
  if (g.output === id) return g;
  const next = clone(g);
  next.nodes = next.nodes.filter((n) => n.id !== id);
  for (const n of next.nodes) {
    if (!n.inputs) continue;
    for (const [slot, src] of Object.entries(n.inputs)) {
      if (src === id) delete n.inputs[slot];
    }
  }
  return next;
}
