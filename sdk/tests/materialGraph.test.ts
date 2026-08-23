// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import {
  compileMaterialGraph,
  newMaterialGraph,
  addNode,
  connect,
  disconnect,
  removeNode,
  moveNode,
  NODE_SPECS,
  type MaterialGraph,
} from '../src/render/materialGraph';

// TextureSample(u_albedo) × ConstColor(u_tint) → Output — a tint material as a graph.
const tintGraph: MaterialGraph = {
  name: 'GraphTint',
  output: 'out',
  nodes: [
    { id: 'tex', type: 'textureSample', params: { name: 'u_albedo', default: 'white' } },
    { id: 'tint', type: 'constColor', params: { name: 'u_tint', value: [1, 1, 1, 1] } },
    { id: 'mul', type: 'multiply', inputs: { a: 'tex', b: 'tint' } },
    { id: 'out', type: 'output', inputs: { color: 'mul' } },
  ],
};

describe('compileMaterialGraph', () => {
  it('emits const/texture nodes as reflected #pragma params', () => {
    const src = compileMaterialGraph(tintGraph);
    expect(src).toContain('#pragma param u_albedo texture default(white)');
    expect(src).toContain('#pragma param u_tint color default(1,1,1,1)');
    expect(src).toContain('#pragma domain Unlit');
    expect(src).toContain('#pragma shader "GraphTint"');
  });

  it('emits a topologically ordered fragment body ending at fragColor', () => {
    const src = compileMaterialGraph(tintGraph);
    expect(src).toContain('vec4 n0 = texture(u_albedo, v_texCoord);');
    expect(src).toContain('vec4 n1 = n0 * u_tint;');
    expect(src).toContain('fragColor = n1;');
    // the texture sample must precede the multiply that consumes it
    expect(src.indexOf('texture(u_albedo')).toBeLessThan(src.indexOf('n0 * u_tint'));
  });

  it('emits fragment-only shaders (the canonical vertex stage is engine-injected)', () => {
    expect(compileMaterialGraph(tintGraph)).not.toContain('#pragma vertex');
  });

  it('compiles time/sin/panner/noise/smoothstep nodes', () => {
    const g: MaterialGraph = {
      output: 'out',
      nodes: [
        { id: 'uv', type: 'uv' },
        { id: 'pan', type: 'panner', inputs: { uv: 'uv' }, params: { speedX: 0.25, speedY: 0 } },
        { id: 'tex', type: 'textureSample', inputs: { uv: 'pan' }, params: { name: 'u_albedo', default: 'white' } },
        { id: 't', type: 'time' },
        { id: 's', type: 'sin', inputs: { x: 't' } },
        { id: 'n', type: 'noise', inputs: { uv: 'uv' }, params: { scale: 8 } },
        { id: 'ss', type: 'smoothstep', inputs: { x: 'n' }, params: { edge0: 0.2, edge1: 0.8 } },
        { id: 'mask', type: 'multiply', inputs: { a: 'ss', b: 's' } },
        { id: 'mul', type: 'multiply', inputs: { a: 'tex', b: 'mask' } },
        { id: 'out', type: 'output', inputs: { color: 'mul' } },
      ],
    };
    const src = compileMaterialGraph(g);
    expect(src).toContain('fract(v_texCoord + u_time.x * vec2(0.2500, 0.0000))');
    expect(src).toContain('sin(u_time.x)');
    expect(src).toContain('noise2d(v_texCoord * 8.0000)');
    expect(src).toContain('smoothstep(0.2000, 0.8000,');
    expect(src.match(/float noise2d/g)?.length).toBe(1); // helper emitted once
  });

  it('compiles the screenUV node from the injected viewport', () => {
    const g: MaterialGraph = {
      output: 'out',
      nodes: [
        { id: 'suv', type: 'screenUV' },
        { id: 'tex', type: 'textureSample', inputs: { uv: 'suv' }, params: { name: 'u_albedo', default: 'white' } },
        { id: 'out', type: 'output', inputs: { color: 'tex' } },
      ],
    };
    expect(compileMaterialGraph(g)).toContain('gl_FragCoord.xy * u_viewport.zw');
  });

  it('reuses a shared node once (DAG, not a tree)', () => {
    const g: MaterialGraph = {
      output: 'out',
      nodes: [
        { id: 'c', type: 'constColor', params: { name: 'u_c', value: [1, 0, 0, 1] } },
        { id: 'm', type: 'multiply', inputs: { a: 'c', b: 'c' } }, // u_c used twice
        { id: 'out', type: 'output', inputs: { color: 'm' } },
      ],
    };
    const src = compileMaterialGraph(g);
    // The param is declared exactly once even though two edges reference it.
    expect(src.match(/#pragma param u_c color/g)?.length).toBe(1);
    expect(src).toContain('u_c * u_c');
  });

  it('promotes a non-vec4 output to vec4', () => {
    const g: MaterialGraph = {
      output: 'out',
      nodes: [
        { id: 'f', type: 'constFloat', params: { name: 'u_g', value: 0.5 } },
        { id: 'out', type: 'output', inputs: { color: 'f' } },
      ],
    };
    expect(compileMaterialGraph(g)).toContain('fragColor = vec4(vec3(u_g), 1.0);');
  });

  it('passes a Lit domain through, and a graph saved under the old name compiles to the new one', () => {
    expect(compileMaterialGraph({ ...tintGraph, domain: 'Lit' })).toContain('#pragma domain Lit');
    expect(compileMaterialGraph({ ...tintGraph, domain: 'Lit2D' })).toContain('#pragma domain Lit');
  });

  it('emits oneMinus / saturate preserving the input type', () => {
    const g: MaterialGraph = {
      output: 'out',
      nodes: [
        { id: 'tex', type: 'textureSample', params: { name: 'u_a', default: 'white' } },
        { id: 'inv', type: 'oneMinus', inputs: { x: 'tex' } },
        { id: 'sat', type: 'saturate', inputs: { x: 'inv' } },
        { id: 'out', type: 'output', inputs: { color: 'sat' } },
      ],
    };
    const src = compileMaterialGraph(g);
    expect(src).toContain('vec4 n1 = 1.0 - n0;');
    expect(src).toContain('vec4 n2 = clamp(n1, 0.0, 1.0);');
  });

  it('throws on a cycle', () => {
    const g: MaterialGraph = {
      output: 'out',
      nodes: [
        { id: 'a', type: 'multiply', inputs: { a: 'b', b: 'b' } },
        { id: 'b', type: 'multiply', inputs: { a: 'a', b: 'a' } },
        { id: 'out', type: 'output', inputs: { color: 'a' } },
      ],
    };
    expect(() => compileMaterialGraph(g)).toThrow(/cycle/);
  });

  it('throws on a missing node / input / bad output', () => {
    expect(() => compileMaterialGraph({ output: 'out', nodes: [{ id: 'out', type: 'output', inputs: { color: 'nope' } }] }))
      .toThrow(/missing node/);
    expect(() => compileMaterialGraph({ output: 'out', nodes: [{ id: 'out', type: 'output' }] }))
      .toThrow(/missing input/);
    expect(() => compileMaterialGraph({ output: 'x', nodes: [{ id: 'x', type: 'uv' }] }))
      .toThrow(/"output"/);
  });
});

describe('compileMaterialGraph WGSL twin', () => {
  it('every compile carries a fragment wgsl section mirroring the GLSL body', () => {
    const src = compileMaterialGraph(tintGraph);
    expect(src).toContain('#pragma fragment wgsl');
    const wgsl = src.slice(src.indexOf('#pragma fragment wgsl'));
    expect(wgsl).toContain('fn fs_main(v : VSOut)');
    // Same SSA temp names, twin spellings: texture params sample the name/name_s
    // pair, block params read through mc..
    expect(wgsl).toContain('let n0 : vec4f = textureSampleLevel(u_albedo, u_albedo_s, v.v_texCoord, 0.0);');
    expect(wgsl).toContain('let n1 : vec4f = n0 * mc.u_tint;');
    expect(wgsl).toContain('return n1;');
  });

  it('time/panner/noise/smoothstep/saturate spell their WGSL forms', () => {
    const g: MaterialGraph = {
      output: 'out',
      nodes: [
        { id: 'uv', type: 'uv' },
        { id: 'pan', type: 'panner', inputs: { uv: 'uv' }, params: { speedX: 0.25, speedY: 0 } },
        { id: 'tex', type: 'textureSample', inputs: { uv: 'pan' }, params: { name: 'u_albedo', default: 'white' } },
        { id: 'n', type: 'noise', inputs: { uv: 'uv' }, params: { scale: 8 } },
        { id: 'ss', type: 'smoothstep', inputs: { x: 'n' }, params: { edge0: 0.2, edge1: 0.8 } },
        { id: 'inv', type: 'oneMinus', inputs: { x: 'tex' } },
        { id: 'sat', type: 'saturate', inputs: { x: 'inv' } },
        { id: 'mul', type: 'multiply', inputs: { a: 'sat', b: 'ss' } },
        { id: 'out', type: 'output', inputs: { color: 'mul' } },
      ],
    };
    const src = compileMaterialGraph(g);
    const wgsl = src.slice(src.indexOf('#pragma fragment wgsl'));
    expect(wgsl).toContain('fract(v.v_texCoord + tc.u_time.x * vec2f(0.2500, 0.0000))');
    expect(wgsl).toContain('noise2d(v.v_texCoord * 8.0000)');
    expect(wgsl).toContain('smoothstep(0.2000, 0.8000,'); // float x keeps scalar edges
    expect(wgsl).toContain('saturate('); // WGSL builtin replaces mixed-type clamp
    expect(wgsl.match(/fn noise2d/g)?.length).toBe(1); // WGSL helper emitted once
    // The GLSL half keeps its own helper — one per language.
    expect(src.match(/float noise2d/g)?.length).toBe(1);
  });

  it('smoothstep splats its edges when x is a vector', () => {
    const g: MaterialGraph = {
      output: 'out',
      nodes: [
        { id: 'tex', type: 'textureSample', params: { name: 'u_a', default: 'white' } },
        { id: 'ss', type: 'smoothstep', inputs: { x: 'tex' }, params: { edge0: 0.2, edge1: 0.8 } },
        { id: 'out', type: 'output', inputs: { color: 'ss' } },
      ],
    };
    const wgsl = compileMaterialGraph(g).slice(compileMaterialGraph(g).indexOf('#pragma fragment wgsl'));
    expect(wgsl).toContain('smoothstep(vec4f(0.2000), vec4f(0.8000),');
  });

  it('screenUV flips y so both backends agree on a y-up 0..1 space', () => {
    const g: MaterialGraph = {
      output: 'out',
      nodes: [
        { id: 'suv', type: 'screenUV' },
        { id: 'tex', type: 'textureSample', inputs: { uv: 'suv' }, params: { name: 'u_a', default: 'white' } },
        { id: 'out', type: 'output', inputs: { color: 'tex' } },
      ],
    };
    const src = compileMaterialGraph(g);
    expect(src).toContain('gl_FragCoord.xy * u_viewport.zw');
    expect(src).toContain('vec2f(v.pos.x, tc.u_viewport.y - v.pos.y) * tc.u_viewport.zw');
  });

  it('promotes a non-vec4 output to vec4 in both languages', () => {
    const g: MaterialGraph = {
      output: 'out',
      nodes: [
        { id: 'f', type: 'constFloat', params: { name: 'u_g', value: 0.5 } },
        { id: 'out', type: 'output', inputs: { color: 'f' } },
      ],
    };
    const src = compileMaterialGraph(g);
    expect(src).toContain('fragColor = vec4(vec3(u_g), 1.0);');
    expect(src).toContain('return vec4f(vec3f(mc.u_g), 1.0);');
  });
});

describe('material graph editor ops', () => {
  it('the default graph compiles', () => {
    expect(() => compileMaterialGraph(newMaterialGraph())).not.toThrow();
  });

  it('addNode gives a fresh id + default params and stays immutable', () => {
    const g = newMaterialGraph();
    const { graph, id } = addNode(g, 'constColor', 10, 20);
    expect(g.nodes).toHaveLength(2); // original untouched
    const node = graph.nodes.find((n) => n.id === id)!;
    expect(node.type).toBe('constColor');
    expect(node.params).toEqual({ name: `u_${id}`, value: [1, 1, 1, 1] });
    expect(node.x).toBe(10);
  });

  it('connect wires an input and the result compiles', () => {
    let g = newMaterialGraph();
    const added = addNode(g, 'constColor', 0, 0);
    g = added.graph;
    g = connect(g, added.id, 'tex', 'uv'); // not meaningful but valid slot... use a real one:
    // wire the color node into a multiply, then into output
    const mul = addNode(g, 'multiply', 0, 0);
    g = mul.graph;
    g = connect(g, 'tex', mul.id, 'a');
    g = connect(g, added.id, mul.id, 'b');
    g = connect(g, mul.id, 'out', 'color');
    expect(g.nodes.find((n) => n.id === 'out')!.inputs!.color).toBe(mul.id);
    expect(() => compileMaterialGraph(g)).not.toThrow();
  });

  it('connect rejects a cycle (graph unchanged)', () => {
    let g = newMaterialGraph();
    const m = addNode(g, 'multiply', 0, 0);
    g = m.graph;
    g = connect(g, 'tex', m.id, 'a'); // tex → multiply
    const looped = connect(g, m.id, 'tex', 'uv'); // multiply → tex would loop
    expect(looped).toBe(g); // unchanged reference: rejected
  });

  it('connect rejects an unknown slot', () => {
    const g = newMaterialGraph();
    expect(connect(g, 'tex', 'out', 'nope')).toBe(g);
  });

  it('disconnect clears a slot', () => {
    const g = disconnect(newMaterialGraph(), 'out', 'color');
    expect(g.nodes.find((n) => n.id === 'out')!.inputs?.color).toBeUndefined();
  });

  it('removeNode drops the node + edges into it, but never the output', () => {
    const g = removeNode(newMaterialGraph(), 'tex');
    expect(g.nodes.find((n) => n.id === 'tex')).toBeUndefined();
    expect(g.nodes.find((n) => n.id === 'out')!.inputs?.color).toBeUndefined(); // edge cleaned
    expect(removeNode(g, 'out').nodes.some((n) => n.id === 'out')).toBe(true); // output kept
  });

  it('moveNode updates layout only', () => {
    const g = moveNode(newMaterialGraph(), 'tex', 99, 77);
    const n = g.nodes.find((m) => m.id === 'tex')!;
    expect([n.x, n.y]).toEqual([99, 77]);
  });

  it('NODE_SPECS covers every node type the compiler handles', () => {
    for (const type of Object.keys(NODE_SPECS)) {
      expect(NODE_SPECS[type as keyof typeof NODE_SPECS].label).toBeTruthy();
    }
    expect(NODE_SPECS.output.addable).toBe(false);
    expect(NODE_SPECS.multiply.inputs.map((p) => p.name)).toEqual(['a', 'b']);
  });
});
