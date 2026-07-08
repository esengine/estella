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
 */

/** A node's GLSL output type. Determines how it combines and how it promotes to fragColor. */
export type GraphType = 'float' | 'vec2' | 'vec3' | 'vec4';

export type GraphNodeType =
  | 'output' // the root: its `color` input becomes fragColor
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
  name?: string;
  /** Material domain (Unlit2D default; Lit2D etc. flow through unchanged). */
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
export function compileMaterialGraph(graph: MaterialGraph): string {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const memo = new Map<string, Emitted>();
  const visiting = new Set<string>();
  const params: string[] = [];
  const helpers = new Set<string>();
  const whelpers = new Set<string>();
  const body: string[] = [];
  const wbody: string[] = [];
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
        out = { expr: 'v_texCoord', wexpr: 'v.v_texCoord', type: 'vec2' };
        break;
      case 'vertexColor':
        out = { expr: 'v_color', wexpr: 'v.v_color', type: 'vec4' };
        break;
      case 'time':
        out = { expr: 'u_time.x', wexpr: 'tc.u_time.x', type: 'float' };
        break;
      case 'screenUV': {
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
        params.push(`#pragma param ${name} float default(${v})`);
        out = { expr: name, wexpr: `mc.${name}`, type: 'float' };
        break;
      }
      case 'constColor': {
        const name = paramName(n);
        const c = Array.isArray(n.params?.value) ? (n.params!.value as number[]) : [1, 1, 1, 1];
        params.push(`#pragma param ${name} color default(${c.slice(0, 4).join(',')})`);
        out = { expr: name, wexpr: `mc.${name}`, type: 'vec4' };
        break;
      }
      case 'textureSample': {
        const name = paramName(n);
        const def = typeof n.params?.default === 'string' ? n.params.default : 'white';
        params.push(`#pragma param ${name} texture default(${def})`);
        const uv = n.inputs?.uv ? input('uv') : { expr: 'v_texCoord', wexpr: 'v.v_texCoord', type: 'vec2' as GraphType };
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
        helpers.add(NOISE_HELPER);
        whelpers.add(NOISE_HELPER_WGSL);
        const uv = n.inputs?.uv ? input('uv') : { expr: 'v_texCoord', wexpr: 'v.v_texCoord', type: 'vec2' as GraphType };
        const scale = numParam(n, 'scale', 12);
        out = line('float',
          `noise2d(${uv.expr} * ${scale})`,
          `noise2d(${uv.wexpr} * ${scale})`);
        break;
      }
      case 'panner': {
        const uv = n.inputs?.uv ? input('uv') : { expr: 'v_texCoord', wexpr: 'v.v_texCoord', type: 'vec2' as GraphType };
        const sx = numParam(n, 'speedX', 0.1);
        const sy = numParam(n, 'speedY', 0);
        out = line('vec2',
          `fract(${uv.expr} + u_time.x * vec2(${sx}, ${sy}))`,
          `fract(${uv.wexpr} + tc.u_time.x * vec2f(${sx}, ${sy}))`);
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

  const name = graph.name ?? 'Graph';
  const domain = graph.domain ?? 'Unlit2D';
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
${paramBlock}
#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;

${helperBlock}out vec4 fragColor;

void main() {
${bodyBlock}
    fragColor = ${result.expr};
}
#pragma end

#pragma fragment wgsl
${whelperBlock}@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
${wbodyBlock}
    return ${result.wexpr};
}
#pragma end
`;
}

const NOISE_HELPER = `float hash2d(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise2d(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2d(i), hash2d(i + vec2(1.0, 0.0)), f.x),
               mix(hash2d(i + vec2(0.0, 1.0)), hash2d(i + vec2(1.0, 1.0)), f.x), f.y);
}`;

const NOISE_HELPER_WGSL = `fn hash2d(p : vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123); }
fn noise2d(p : vec2f) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2d(i), hash2d(i + vec2f(1.0, 0.0)), f.x),
               mix(hash2d(i + vec2f(0.0, 1.0)), hash2d(i + vec2f(1.0, 1.0)), f.x), f.y);
}`;

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
  kind: 'color' | 'float' | 'texture';
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
  output: { label: 'Output', inputs: [{ name: 'color', type: 'vec4' }], output: null, params: [], addable: false },
  uv: { label: 'UV', inputs: [], output: 'vec2', params: [], addable: true },
  vertexColor: { label: 'Vertex Color', inputs: [], output: 'vec4', params: [], addable: true },
  time: { label: 'Time', inputs: [], output: 'float', params: [], addable: true },
  screenUV: { label: 'Screen UV', inputs: [], output: 'vec2', params: [], addable: true },
  constFloat: { label: 'Float', inputs: [], output: 'float', params: [{ key: 'value', label: 'Value', kind: 'float' }], addable: true },
  constColor: { label: 'Color', inputs: [], output: 'vec4', params: [{ key: 'value', label: 'Color', kind: 'color' }], addable: true },
  textureSample: { label: 'Texture', inputs: [{ name: 'uv', type: 'vec2' }], output: 'vec4', params: [{ key: 'name', label: 'Param', kind: 'texture' }], addable: true },
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
  if (!to || !NODE_SPECS[to.type].inputs.some((p) => p.name === toSlot)) return g;
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
