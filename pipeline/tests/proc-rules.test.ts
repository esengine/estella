import { describe, expect, it } from 'vitest';
import { ProcCache, copyProcNodes, extractProcComponent, pasteProcNodes, addProcNode, applyProcEdits, connectProc, disconnectProc, explicitProc, removeProcNode, renderProcItems, packProcParts, procPlants, procModels, ProcBuildError, qRotate, renderProcPlan, runProc, validateProcSource, type Part, type ProcSource } from '../src/proc';
import { MeshChannel, type MeshData } from '../../sdk/src/asset/meshFormat';
import { evaluate } from '../src/modeling/modelExpr';

const src = (nodes: unknown[], extra: Record<string, unknown> = {}): ProcSource => validateProcSource({ version: 1, nodes, ...extra });

describe('rules graph expressions', () => {
    it('compares, joins and chooses', () => {
        const s = new Map([['row', 4], ['col', 1]]);
        expect(evaluate('row > 3 && col >= 1', s)).toBe(1);
        expect(evaluate('row > 3 && col > 1', s)).toBe(0);
        expect(evaluate('!(row == 4) || col != 1', s)).toBe(0);
        expect(evaluate('if(row >= 4, 12, 6) + 1', s)).toBe(13);
        expect(evaluate('(row < 5) * 2', s)).toBe(2);
        // what was there before still reads the same
        expect(evaluate('-2 ^ 2 + max(1, 3) * [1, 2, 3][1]', s)).toBe(-4 + 6);
    });
});

describe('rules graph', () => {
    it('cuts a block into a grid of wards, quarters each, and stands houses on them', () => {
        const r2 = runProc(src([
            { id: 'city', op: 'rect', size: [100, 60] },
            { id: 'wards', op: 'grid', cols: 4, rows: 3, gap: 4 },
            { op: 'quarter', street: 2 },
            { id: 'houses', op: 'box', height: '=4 + row', color: '#d8c7a4' },
            { op: 'output', inputs: ['houses'] },
        ]));
        expect(r2.report.parts).toBe(4 * 3 * 4);
        const ward = (100 - 3 * 4) / 4;
        const house = r2.groups[0]!.parts[0]!;
        expect(house.sx).toBeCloseTo((ward - 2) / 2);
        // row 0 is 4 tall, row 2 is 6
        const heights = new Set(r2.groups[0]!.parts.map((p) => p.sy));
        expect([...heights].sort()).toEqual([4, 5, 6]);
        // every house stands on the ground: its centre is half its height up
        for (const p of r2.groups[0]!.parts) expect(p.y).toBeCloseTo(p.sy / 2);
    });

    it('works only on the plots its where and tag pick, and passes the others on', () => {
        const r = runProc(src([
            { op: 'rect', size: [40, 10] },
            { op: 'split', axis: 'x', count: 4, as: 'slot' },
            { op: 'retag', where: '=slot == 0', add: ['market'] },
            { id: 'stalls', op: 'box', tag: 'market', height: 3, color: '#e0883a', keep: 'plot' },
            { id: 'rest', op: 'box', where: '=slot > 0', height: 8, color: '#888888' },
            { op: 'output', inputs: ['rest'] },
        ]));
        const parts = r.groups[0]!.parts;
        expect(parts.map((p) => p.sy).sort()).toEqual([3, 8, 8, 8]);
    });

    it('builds upward: keep "top" lifts the plot onto what it just stood', () => {
        const r = runProc(src([
            { op: 'rect', size: [20, 10] },
            { op: 'box', height: 2, color: '#ffffff', keep: 'top' },
            { op: 'inset', by: 2 },
            { op: 'box', height: 6, color: '#b8322a', keep: 'top' },
            { op: 'inset', by: -1 },
            { id: 'roof', op: 'box', height: 1, color: '#4a3a32' },
            { op: 'output', inputs: ['roof'] },
        ]));
        const [terrace, body, eave] = r.groups[0]!.parts;
        expect(terrace!.y).toBeCloseTo(1);
        expect(body!.y).toBeCloseTo(2 + 3);
        expect(body!.sx).toBeCloseTo(16);
        expect(eave!.y).toBeCloseTo(8.5);
        expect(eave!.sx).toBeCloseTo(18);
    });

    it('runs a component on each plot, turned and moved onto it', () => {
        const source = src([
            { op: 'rect', at: [100, 50], size: [10, 20], yaw: 90 },
            { id: 'halls', op: 'use', component: 'hall', params: { h: 7 } },
            { op: 'output', inputs: ['halls'] },
        ], {
            components: {
                hall: {
                    params: { h: 5 },
                    nodes: [
                        { op: 'box', height: 1, color: '#ffffff', keep: 'top' },
                        { op: 'part', at: [3, 0, 0], size: [1, '=h', 1], color: '#ff0000' },
                    ],
                },
            },
        });
        const parts = runProc(source).groups[0]!.parts;
        expect(parts).toHaveLength(2);
        const spire = parts[1]!;
        expect(spire.sy).toBe(7);
        // 3 along the plot's own x, turned 90 degrees: x toward -z
        expect(spire.x).toBeCloseTo(100);
        expect(spire.z).toBeCloseTo(47);
        expect(spire.y).toBeCloseTo(1);
    });

    it('repeats a chain with k counting the rounds', () => {
        const r = runProc(src([
            { op: 'rect', size: [10, 10] },
            { id: 'tiers', op: 'repeat', count: 3, chain: [
                { op: 'box', height: 2, color: '#c49a52', keep: 'top' },
                { op: 'inset', by: '=1 + k * 0.5' },
            ] },
            { op: 'output', inputs: ['tiers'] },
        ]));
        const sizes = r.groups[0]!.parts.map((p) => p.sx);
        expect(sizes).toEqual([10, 8, 5]);
    });

    it('cuts a wall open at its gates and stands plots on the ground', () => {
        const r = runProc(src([
            { op: 'rect', size: [100, 80] },
            { op: 'edges', thick: 4, gaps: [{ side: 2, at: 0, width: 10 }] },
            { op: 'ground' },
            { id: 'wall', op: 'box', height: 6, color: '#8d8a86' },
            { op: 'output', inputs: ['wall'] },
        ], { land: 'x.esland' }), { ground: (x) => x * 0.1 });
        const walls = r.groups[0]!.parts;
        expect(walls).toHaveLength(5);
        const south = walls.filter((w) => w.z > 30);
        expect(south.map((w) => w.sx).sort()).toEqual([45, 45]);
        // each piece stands on the lowest ground under it
        const east = walls.find((w) => w.x > 40)!;
        expect(east.y - east.sy / 2).toBeCloseTo((50 - 4) * 0.1);
    });

    it('pitches a roof along the longer side, its ridge as high as the pitch gives', () => {
        const top = (p: Part): number => Math.max(...[-0.5, 0.5].flatMap((a) => [-0.5, 0.5].flatMap((b) => [-0.5, 0.5].map((c) => p.y + qRotate(p.q, [a * p.sx, b * p.sy, c * p.sz])[1]))));
        const low = (p: Part): number => Math.min(...[-0.5, 0.5].flatMap((a) => [-0.5, 0.5].flatMap((b) => [-0.5, 0.5].map((c) => p.y + qRotate(p.q, [a * p.sx, b * p.sy, c * p.sz])[1]))));
        for (const [w, d] of [[12, 8], [8, 12]]) {
            const r = runProc(src([{ op: 'rect', size: [w, d] }, { op: 'lift', by: 4 }, { id: 'r', op: 'roof', pitch: 45, overhang: 0, thick: 0.01, color: '#555555' }, { op: 'output', inputs: ['r'] }]));
            const [a, b] = r.groups[0]!.parts;
            expect(top(a!)).toBeCloseTo(4 + 4, 1);
            expect(top(b!)).toBeCloseTo(8, 1);
            expect(low(a!)).toBeCloseTo(4, 1);
            // the ridge runs along the longer side: the slabs sit either side of it, across the shorter
            const across = w >= d ? Math.abs(a!.z - b!.z) : Math.abs(a!.x - b!.x);
            expect(across).toBeCloseTo(4, 1);
        }
    });

    it('subdivides into lots no wider than max, and the same seed gives the same lots', () => {
        const g = [{ op: 'rect', size: [200, 120] }, { op: 'subdivide', max: 40, gap: 2 }, { id: 'b', op: 'box', height: 5 }, { op: 'output', inputs: ['b'] }];
        const a = runProc(src(g)), b = runProc(src(g));
        for (const p of a.groups[0]!.parts) { expect(p.sx).toBeLessThanOrEqual(40); expect(p.sz).toBeLessThanOrEqual(40); }
        expect(a.groups[0]!.parts.map((p) => p.x)).toEqual(b.groups[0]!.parts.map((p) => p.x));
    });

    it('refuses what cannot be built, naming the node', () => {
        expect(() => src([{ op: 'grid', cols: 2, rows: 2 }, { op: 'output', inputs: [] }])).toThrow(/start with a source/);
        expect(() => src([{ op: 'rect', size: [1, 1] }, { op: 'grid', colums: 2 }, { op: 'output', inputs: [] }])).toThrow(/no field "colums"/);
        expect(() => src([{ op: 'rect', size: [1, 1] }, { op: 'box', input: 'nope', height: 1 }, { op: 'output', inputs: [] }])).toThrow(/not a node before it/);
        expect(() => src([{ op: 'rect', size: [1, 1] }])).toThrow(/one `output`/);
        let error: unknown;
        try { runProc(src([{ op: 'rect', size: [1, 1] }, { id: 'tall', op: 'box', height: '=nope * 2' }, { op: 'output', inputs: ['tall'] }])); } catch (e) { error = e; }
        expect(error).toBeInstanceOf(ProcBuildError);
        expect((error as ProcBuildError).node).toBe('tall');
        expect(() => runProc(src([{ op: 'rect', size: [1, 1] }, { id: 'g', op: 'grid', cols: 1000, rows: 1000 }, { op: 'output', inputs: ['g'] }]))).toThrow(/past the/);
    });

    it('edits a node and draws a plan', () => {
        const s = src([{ op: 'rect', size: [50, 50] }, { id: 'g', op: 'grid', cols: 2, rows: 2, gap: 5 }, { id: 'b', op: 'box', height: 3, color: '#ff0000' }, { op: 'output', inputs: ['b'] }]);
        const t = applyProcEdits(s, [{ op: 'set', node: 'g', fields: { cols: 5 } }]);
        const r = runProc(t);
        expect(r.report.parts).toBe(10);
        const plan = renderProcPlan(r, { size: 256 });
        expect(plan.width).toBe(256);
        // the middle of the first ward is red
        const px = Math.round((-25 + 3 - plan.region.at[0] + plan.region.size[0] / 2) * plan.width / plan.region.size[0]);
        const py = Math.round((-25 + 11 - plan.region.at[1] + plan.region.size[1] / 2) * plan.width / plan.region.size[0]);
        const i = (py * plan.width + px) * 4;
        expect(plan.rgba[i]).toBeGreaterThan(200);
        expect(plan.rgba[i + 1]).toBeLessThan(60);
    });

    it('packs parts into a mesh per cell, in their colours, facing out as the builtins do', () => {
        const r = runProc(src([
            { op: 'rect', size: [500, 100] },
            { op: 'grid', cols: 5, rows: 1 },
            { id: 'b', op: 'box', height: 4, color: '#ff0000', keep: 'plot' },
            { id: 's', op: 'part', mesh: 'sphere', at: [0, 10, 0], size: [6, 6, 6], color: '#00ff00', shadows: false },
            { op: 'output', inputs: ['b', 's'] },
        ]));
        const cells = packProcParts(r, { unit: 100, cell: 300 });
        // the boxes go on through the sphere node too, and are drawn once, in the group that names them first
        expect(r.groups.map((g) => g.parts.length)).toEqual([5, 5]);
        expect(cells.reduce((a, c) => a + c.parts, 0)).toBe(10);
        expect(new Set(cells.map((c) => c.shadows))).toEqual(new Set([true, false]));
        // the sign of (b - a) x (c - a) against the stored normal, for the first triangle of a mesh
        const facing = (m: MeshData, t: number): number => {
            const dv = new DataView(m.vertices.buffer, m.vertices.byteOffset);
            const po = m.channels.find((c) => c.semantic === MeshChannel.Position)!.offset, no = m.channels.find((c) => c.semantic === MeshChannel.Normal)!.offset;
            const P = (i: number): number[] => [0, 1, 2].map((k) => dv.getFloat32(i * m.vertexStride + po + k * 4, true));
            const [a, b, c] = [m.indices[t * 3]!, m.indices[t * 3 + 1]!, m.indices[t * 3 + 2]!].map(P);
            const u = b!.map((v, k) => v - a![k]!), v = c!.map((x, k) => x - a![k]!);
            const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
            const sn = [0, 1, 2].map((k) => dv.getFloat32(m.indices[t * 3]! * m.vertexStride + no + k * 4, true));
            return Math.sign(n[0]! * sn[0]! + n[1]! * sn[1]! + n[2]! * sn[2]!);
        };
        const boxes = cells.find((c) => c.shadows)!.mesh, spheres = cells.find((c) => !c.shadows)!.mesh;
        expect(facing(spheres, 15)).toBe(facing(boxes, 0));
        // the vertex colour is the part's
        const co = boxes.channels.find((c) => c.semantic === MeshChannel.Color)!.offset;
        expect(boxes.vertices[co]).toBe(255);
        expect(boxes.vertices[co + 1]).toBe(0);
    });

    it('gives a canvas ids and wires, keeps every node after what it reads, and refuses a loop', () => {
        const nodes = explicitProc(validateProcSource({ version: 1, nodes: [
            { op: 'rect', size: [40, 40] }, { op: 'grid', cols: 2, rows: 2 }, { op: 'box', height: 3 }, { op: 'output', inputs: ['__'] },
        ].map((n) => (n.op === 'output' ? { ...n, inputs: ['box1'] } : n)).map((n, i) => (i === 2 ? { ...n, id: 'box1' } : n)) }).nodes);
        expect(nodes.map((n) => n.id)).toEqual(['rect1', 'grid1', 'box1', 'output1']);
        expect(nodes.map((n) => n.input)).toEqual([undefined, 'rect1', 'grid1', undefined]);
        // a node added later and wired in front comes before what reads it
        const added = addProcNode(nodes, 'inset', 0, 0);
        expect(added.nodes.at(-1)!.input).toBeNull();
        let next = connectProc(added.nodes, 'grid1', added.id);
        next = connectProc(next, added.id, 'box1');
        expect(next.map((n) => n.id)).toEqual(['rect1', 'grid1', 'inset1', 'box1', 'output1']);
        const r = runProc(validateProcSource({ version: 1, nodes: next }));
        expect(r.report.parts).toBe(4);
        expect(() => connectProc(next, 'box1', 'grid1')).toThrow(/loop/);
        // an unwired node does not run, and says so
        expect(() => validateProcSource({ version: 1, nodes: disconnectProc(next, 'box1') })).toThrow(/nothing is wired into it/);
        // removing a node takes its wires off what it fed
        const gone = removeProcNode(next, 'inset1');
        expect(gone.find((n) => n.id === 'box1')!.input).toBeNull();
    });

    it('keeps what one node made for a preview, plots and parts', () => {
        const s = validateProcSource({ version: 1, nodes: [
            { op: 'rect', size: [40, 20] }, { id: 'g', op: 'grid', cols: 4, rows: 1 }, { id: 'b', op: 'box', height: 3, color: '#ff0000' }, { op: 'output', inputs: ['b'] },
        ] });
        const r = runProc(s, {}, { probe: 'g' });
        expect(r.probe!.map((it) => it.kind)).toEqual(['plot', 'plot', 'plot', 'plot']);
        const plan = renderProcItems(r.probe!, { size: 200 });
        // a plot's outline is drawn in blue somewhere
        let blue = 0;
        for (let i = 0; i < plan.rgba.length; i += 4) if (plan.rgba[i + 2]! > 200 && plan.rgba[i]! < 80) blue++;
        expect(blue).toBeGreaterThan(50);
    });

    it('runs again only what changed and what is downstream of it, and makes the same', () => {
        const graph = (h: number, gap: number) => validateProcSource({ version: 1, nodes: [
            { id: 'site', op: 'rect', size: [100, 60] },
            { id: 'lots', op: 'grid', input: 'site', cols: 5, rows: 3, gap },
            { id: 'trees', op: 'scatter', input: 'site', count: 4, size: [3, 3] },
            { id: 'houses', op: 'box', input: 'lots', height: h, color: '#ccbb99' },
            { id: 'crowns', op: 'box', input: 'trees', height: 8, color: '#336633' },
            { op: 'output', inputs: ['houses', 'crowns'] },
        ] });
        const cache = new ProcCache();
        const first = runProc(graph(4, 2), {}, { cache });
        expect(first.cache).toEqual({ ran: 6, reused: 0 });
        // a house's height: only houses (and the output) run again
        const second = runProc(graph(6, 2), {}, { cache });
        expect(second.cache).toEqual({ ran: 2, reused: 4 });
        expect(second.groups[0]!.parts.every((p) => p.sy === 6)).toBe(true);
        // the grid's gap: lots, houses and the output; the trees are kept
        const third = runProc(graph(6, 5), {}, { cache });
        expect(third.cache).toEqual({ ran: 3, reused: 3 });
        const fresh = runProc(graph(6, 5));
        expect(third.groups.map((g) => g.parts.map((p) => [p.x, p.y, p.z, p.sx]))).toEqual(fresh.groups.map((g) => g.parts.map((p) => [p.x, p.y, p.z, p.sx])));
        // the same source again: everything but the output is answered from the cache
        expect(runProc(graph(6, 5), {}, { cache }).cache).toEqual({ ran: 1, reused: 5 });
    });

    it('stands a component on the land where its plot is in the world, and reads world places in sums', () => {
        const s = validateProcSource({ version: 1, land: 'x.esland', nodes: [
            { op: 'rect', at: [100, 0], size: [10, 10], yaw: 90 },
            { id: 'u', op: 'use', component: 'post' },
            { op: 'output', inputs: ['u'] },
        ], components: { post: { nodes: [
            { op: 'move', by: [3, 0] }, { op: 'ground' }, { op: 'box', height: '=1 + wx * 0.01', fill: [0.1, 0.1] },
        ] } } });
        // ground rises 1 a unit east; the post stands 3 along the plot's turned x, which is toward -z: x stays 100
        const r = runProc(s, { ground: (x) => x });
        const post = r.groups[0]!.parts[0]!;
        expect(post.x).toBeCloseTo(100);
        expect(post.z).toBeCloseTo(-3);
        // the lowest ground under its 10 by 10 plot, which runs from x 95 to 105 in the world
        expect(post.y - post.sy / 2).toBeCloseTo(95);
        expect(post.sy).toBeCloseTo(1 + 100 * 0.01);
    });

    it('previews a node inside a component as its first use made it, in the component frame', () => {
        const s = validateProcSource({ version: 1, nodes: [
            { op: 'rect', size: [60, 20] }, { op: 'split', axis: 'x', count: 3 }, { id: 'u', op: 'use', component: 'shed' }, { op: 'output', inputs: ['u'] },
        ], components: { shed: { nodes: [{ id: 'small', op: 'inset', by: 2 }, { id: 'b', op: 'box', height: 3 }] } } });
        const r = runProc(s, {}, { probe: { component: 'shed', node: 'small' } });
        expect(r.probeUses).toBe(3);
        expect(r.probe).toHaveLength(1);
        const plot = r.probe![0]!;
        expect(plot.kind).toBe('plot');
        if (plot.kind !== 'plot') return;
        expect([plot.x, plot.z, plot.w, plot.d]).toEqual([0, 0, 16, 16]);
    });

    it('makes a component of part of a graph that lays out the same', () => {
        const nodes = explicitProc(validateProcSource({ version: 1, nodes: [
            { id: 'site', op: 'rect', size: [120, 80] },
            { id: 'lots', op: 'grid', input: 'site', cols: 4, rows: 3, gap: 4 },
            { id: 'yard', op: 'inset', input: 'lots', by: 2 },
            { id: 'body', op: 'box', input: 'yard', height: '=3 + rand(id) * 2', color: '#ccbb99', keep: 'top' },
            { id: 'roof', op: 'roof', input: 'body', pitch: 30, color: '#333333' },
            { op: 'output', inputs: ['roof'] },
        ] }).nodes);
        const before = runProc(validateProcSource({ version: 1, nodes }));
        const made = extractProcComponent(nodes, ['yard', 'body', 'roof'], 'house');
        const after = runProc(validateProcSource({ version: 1, nodes: made.nodes, components: { house: made.component } }));
        const key = (r: typeof before) => r.groups.flatMap((g) => g.parts).map((p) => [p.x, p.y, p.z, p.sx, p.sy, p.sz].map((v) => v.toFixed(4)).join(',')).sort();
        expect(key(after)).toEqual(key(before));
        expect(made.nodes.find((n) => n.op === 'output')!.inputs).toEqual([made.use]);
        expect(made.component.nodes[0]!.input).toBe('in');
        expect(() => extractProcComponent(nodes, ['site', 'lots'], 'x')).toThrow(/cannot go into a component/);
        expect(() => extractProcComponent(nodes, ['body'], 'x')).not.toThrow();
    });

    it('pastes copies with ids of their own, wired among themselves and to what stays', () => {
        const nodes = explicitProc(validateProcSource({ version: 1, nodes: [
            { id: 'site', op: 'rect', size: [40, 40] }, { id: 'lots', op: 'grid', input: 'site', cols: 2, rows: 2 },
            { id: 'b', op: 'box', input: 'lots', height: 3 }, { op: 'output', inputs: ['b'] },
        ] }).nodes);
        const clip = copyProcNodes(nodes, ['lots', 'b']);
        const pasted = pasteProcNodes(nodes, JSON.parse(JSON.stringify(clip)));
        expect(pasted.ids).toEqual(['grid1', 'box1']);
        const grid = pasted.nodes.find((n) => n.id === 'grid1')!, box = pasted.nodes.find((n) => n.id === 'box1')!;
        expect(grid.input).toBe('site');
        expect(box.input).toBe('grid1');
        // into a graph without its source, the outside wire is taken off
        const elsewhere = pasteProcNodes([], clip);
        expect(elsewhere.nodes.find((n) => n.op === 'grid')!.input).toBeNull();
    });

    it('merges branches of one node without making copies of what they carry', () => {
        const r = runProc(validateProcSource({ version: 1, nodes: [
            { op: 'rect', size: [20, 20] },
            { id: 'base', op: 'box', height: 1, keep: 'top' },
            { id: 'left', input: 'base', op: 'part', at: [-5, 0, 0], size: [1, 3, 1] },
            { id: 'right', input: 'base', op: 'part', at: [5, 0, 0], size: [1, 3, 1] },
            { id: 'both', op: 'merge', inputs: ['left', 'right'] },
            { op: 'output', inputs: ['both'] },
        ] }));
        // the base box once, and the two posts
        expect(r.report.parts).toBe(3);
    });

    it('packs each surface apart, its texture laid on at the size of the part', () => {
        const r = runProc(validateProcSource({ version: 1, surfaces: { tile: { tile: 2 }, wood: { tile: 1 } }, nodes: [
            { op: 'rect', size: [4, 6] },
            { id: 'body', op: 'box', height: 3, surface: 'wood', keep: 'top' },
            { id: 'top', op: 'box', height: 1, surface: 'tile' },
            { op: 'output', inputs: ['body', 'top'] },
        ] }));
        expect(r.groups.flatMap((g) => g.parts).map((p) => p.surface).sort()).toEqual(['tile', 'wood']);
        const cells = packProcParts(r, { unit: 100, tiles: { tile: 2, wood: 1 } });
        expect(cells.map((c) => c.surface).sort()).toEqual(['tile', 'wood']);
        // the tile box's top runs 4 units along x: two repeats of a 2-unit tile
        const m = cells.find((c) => c.surface === 'tile')!.mesh;
        const dv = new DataView(m.vertices.buffer, m.vertices.byteOffset);
        const uo = m.channels.find((c) => c.semantic === MeshChannel.TexCoord0)!.offset;
        const us = Array.from({ length: m.vertexCount }, (_, k) => dv.getFloat32(k * m.vertexStride + uo, true));
        expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(3);
        expect(() => validateProcSource({ version: 1, surfaces: { x: { tile: 0 } }, nodes: [{ op: 'rect', size: [1, 1] }, { id: 'o', op: 'box', height: 1 }, { op: 'output', inputs: ['o'] }] })).toThrow(/tile is a length/);
    });
    it('stands plants: a component carries them onto its plot, packing leaves them out, and a PlacedFoliage reads them', () => {
        const plants = { huai: { mesh: 'huai.esmesh', lods: ['huai1.esmesh', 'huai0.esmesh'], near: 40, reach: 600 } };
        const r = runProc(src([
            { id: 'yards', op: 'plots', items: [{ at: [10, 0], size: [8, 8] }, { at: [-10, 0], size: [8, 8], yaw: 90 }] },
            { id: 'houses', input: 'yards', op: 'box', height: 4, color: '#aaaaaa' },
            { id: 'trees', input: 'yards', op: 'use', component: 'yard' },
            { op: 'output', inputs: ['houses', 'trees'] },
        ], { unit: 100, plants, components: { yard: { nodes: [{ op: 'plant', kind: 'huai', at: [2, 0, 0], scale: 1.5, yaw: 0 }] } } }));
        const got = procPlants(r, 100)!;
        expect(got.kinds).toEqual(['huai']);
        expect(got.records.length).toBe(12);
        // the first yard is unturned: the tree stands 2 along its x; the second is turned a quarter, so 2 along its x is along z
        expect(got.records.slice(0, 6)).toEqual([0, 1200, 0, 0, 0, 1.5]);
        expect(got.records[7]).toBeCloseTo(-1000);
        expect(Math.abs(got.records[9]!)).toBeCloseTo(200);
        expect(Math.abs(got.records[10]!)).toBeCloseTo(Math.PI / 2, 2);
        // the houses are packed; the trees are not shapes and are not in them
        const cells = packProcParts(r, { unit: 100 });
        expect(cells.reduce((a, c) => a + c.parts, 0)).toBe(2);
        expect(procPlants(runProc(src([{ id: 'b', op: 'rect', size: [4, 4] }, { id: 'c', op: 'box', height: 1, color: '#ffffff' }, { op: 'output', inputs: ['c'] }])), 100)).toBeNull();
        expect(() => runProc(src([{ op: 'rect', size: [4, 4] }, { id: 't', op: 'plant', kind: 'elm' }, { op: 'output', inputs: ['t'] }], { plants }))).toThrow(/no plant "elm"/);
        expect(() => src([{ id: 'r', op: 'rect', size: [4, 4] }, { op: 'output', inputs: ['r'] }], { plants: { oak: { lods: [] } } })).toThrow(/mesh/);
    });
    it('stands models: each its own entity at its scale, lifted and tilted with its plot, and left out of the packed meshes', () => {
        const models = { isle: { mesh: 'isle.esmesh', material: 'isle.esmaterial', shadows: false } };
        const r = runProc(src([
            { id: 'site', op: 'rect', at: [100, 0], size: [40, 40] },
            { op: 'lift', by: 2000 },
            { id: 'isle', op: 'model', kind: 'isle', scale: [2, 1, 3], yaw: 90, tilt: [0, 10] },
            { id: 'hall', input: 'site', op: 'box', height: 10, color: '#ffffff' },
            { op: 'output', inputs: ['isle', 'hall'] },
        ], { unit: 100, models }));
        const got = procModels(r, 100);
        expect(got).toHaveLength(1);
        expect(got[0]).toMatchObject({ kind: 'isle', at: [10000, 200000, 0], scale: [2, 1, 3], shadows: false });
        expect(packProcParts(r, { unit: 100 }).reduce((a, c) => a + c.parts, 0)).toBe(1);
        expect(() => runProc(src([{ op: 'rect', size: [4, 4] }, { id: 'm', op: 'model', kind: 'rock' }, { op: 'output', inputs: ['m'] }], { models }))).toThrow(/no model "rock"/);
        expect(() => runProc(src([{ op: 'rect', size: [4, 4] }, { id: 'm', op: 'model', kind: 'isle', scale: [1, 0, 1] }, { op: 'output', inputs: ['m'] }], { models }))).toThrow(/scale/);
    });
});
