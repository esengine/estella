// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  procSource.ts — a place laid out by rules: what a `.esproc` holds.
 *
 *        A town drawn block by block is a thousand numbers nobody can change at once; a script that draws it is code nobody
 *        can look into. A rules graph is the middle: nodes, each one operation (cut a plot into a grid, keep the plots a
 *        test passes, stand a box on each plot, lift what is left to its top), wired output to input. Change one number
 *        upstream and everything downstream is laid out again. Plots are the plan (rectangles on the ground, with their
 *        own numbers and tags); parts are what stands (shapes with a size, a colour and a turn). A node that works on plots
 *        passes parts through untouched, so a chain can build a hall from the ground up: a terrace, the plot lifted to its
 *        top and drawn in, the body, lifted again, the eaves.
 *
 *        Lengths are the source's own units (metres when `unit` is 100 in a scene of 100 units to the metre); the scene's
 *        units are reached by multiplying by `unit` when the graph is put in a scene. Angles are degrees, turning +x toward
 *        -z about the upright axis (the turn a yaw quaternion makes). +z is south.
 */

/** The file a rules graph is saved as. */
export const PROC_SOURCE_EXT = '.esproc';

/** A number, or a sum worked out per plot: `"=w * 0.4"`, `"=if(row > 3, 12, 6)"`. */
export type Num = number | string;

export type MeshName = 'cube' | 'cylinder' | 'cone' | 'sphere' | 'capsule';
export const MESH_NAMES: readonly MeshName[] = ['cube', 'cylinder', 'cone', 'sphere', 'capsule'];

/** Every node: its id, its operation, what feeds it, and where it sits in an editor. */
export interface ProcNodeBase {
    id?: string;
    op: string;
    /** The node whose output this one works on; left out, the node before it (in a component, first, its plot "in"); null, nothing (an editor's unwired node, which does not run). */
    input?: string | null;
    /** Several inputs, for `merge` and `output`. */
    inputs?: string[];
    /** Only plots this test passes are worked on; the rest go through as they came. */
    where?: Num;
    /** Only plots carrying this tag are worked on. */
    tag?: string;
    /** Where the node is drawn in a graph editor. */
    x?: number;
    y?: number;
    /** A note for whoever reads the graph. */
    note?: string;
    [field: string]: unknown;
}
export type ProcNode = ProcNodeBase;

/** A reusable piece: a graph of its own, run on each plot it is given as if the plot stood at the origin, unturned. */
export interface ProcComponent {
    /** Names a `use` node may give, with the value each takes when it does not (a colour is a list [r, g, b]). */
    params?: Record<string, number | number[]>;
    nodes: ProcNode[];
    /** The node whose output is the component's; default the last. */
    output?: string;
    note?: string;
}

export interface ProcSource {
    version: 1;
    /** World units to one unit of the source: 100 makes every length metres in a scene of 100 to the metre. */
    unit?: number;
    /** The land the `ground` node reads heights from: a project path to a `.esland`. */
    land?: string;
    /** Seed for every rand() in the graph. */
    seed?: number;
    /**
     * What each `surface` a part names is drawn with: a material (its normal and roughness), the texture in its base slot,
     * and how many of the source's units one repeat of the texture covers. A part's own colour still tints it, so one grey
     * tile texture serves a grey roof and a green-glazed one.
     */
    surfaces?: Record<string, ProcSurface>;
    /**
     * The plants a `plant` node stands, by name: a model and its cheaper ones (model_write's `tree` step at detail 2, 1 and 0),
     * drawn shared and each choosing its detail by how far off it is, as a land's plants are. `near` and `reach` are lengths.
     */
    plants?: Record<string, ProcPlant>;
    /**
     * The models a `model` node stands, by name: a mesh made elsewhere (model_write) with its material and texture, each one its
     * own entity in the scene. For the few large things a place is built round (a floating island, a crag, a wreck), not a crowd.
     */
    models?: Record<string, ProcModel>;
    /** Names every sum may read: numbers, or lists of numbers (a colour [r, g, b], 0..1). */
    params?: Record<string, number | number[]>;
    components?: Record<string, ProcComponent>;
    nodes: ProcNode[];
    note?: string;
}

/** How a surface is drawn: project paths (or @uuid refs) to its material and texture, and its repeat in the source's units. */
export interface ProcSurface { material?: string; texture?: string; tile?: number }

/** A model a graph stands: its mesh, and the material and texture it is drawn with; it casts shadows unless told not to. */
export interface ProcModel { mesh: string; material?: string; texture?: string; shadows?: boolean }

/** A plant a graph stands: its mesh, its cheaper meshes nearest first, the material and texture they share, whole to `near` and drawn to `reach`. */
export interface ProcPlant { mesh: string; lods?: string[]; material?: string; texture?: string; near?: number; reach?: number; shadows?: boolean }

/** A source that cannot be built: what is wrong and where. */
export class ProcBuildError extends Error {
    constructor(message: string, readonly node: string | null = null, readonly op: string | null = null, options?: { cause?: unknown }) {
        super(message, options);
        this.name = 'ProcBuildError';
    }
}

interface OpSpec {
    /** What it does, one line: the tool text is built from these. */
    help: string;
    /** Fields it reads besides the common ones; anything else is an error. */
    fields: readonly string[];
    /** It takes no input (a source of plots). */
    source?: boolean;
    /** It takes `inputs` instead of `input`. */
    many?: boolean;
}

const COMMON = ['id', 'op', 'input', 'inputs', 'where', 'tag', 'x', 'y', 'note'];

/** Every operation, what it reads, and one line on what it does. */
export const PROC_OPS: Record<string, OpSpec> = {
    rect: { source: true, fields: ['at', 'size', 'yaw', 'set', 'tags'], help: 'rect(at [x, z], size [w, d], yaw?, set?, tags?): one plot' },
    plots: { source: true, fields: ['items'], help: 'plots(items [{ at, size, yaw?, set?, tags? }]): plots listed by hand' },
    ring: { source: true, fields: ['at', 'radius', 'count', 'size', 'start', 'squash', 'set', 'tags'], help: 'ring(at, radius, count, size [w, d], start?, squash?): plots round a circle, each turned to face out; attr k' },
    line: { source: true, fields: ['points', 'width', 'step', 'set', 'tags'], help: 'line(points [[x, z], ...], width, step?): thin plots along a line, one per stretch of `step` or less; attr k' },
    grid: { fields: ['cols', 'rows', 'colSize', 'rowSize', 'gap', 'gapX', 'gapZ'], help: 'grid(cols|colSize, rows|rowSize, gap?, gapX?, gapZ?): each plot cut into a grid; attrs col, row, cols, rows' },
    split: { fields: ['axis', 'count', 'size', 'sizes', 'gap', 'as'], help: 'split(axis "x"|"z"|"long"|"short", count | size | sizes [12, "1r", "2r"], gap?, as?): cut along one axis ("long": the longer side, so a wall of either direction is cut into lengths); attrs <as> and <as>s (default part, parts)' },
    inset: { fields: ['by', 'byX', 'byZ'], help: 'inset(by, byX?, byZ?): draw each side in (out when negative); a plot that vanishes is dropped' },
    quarter: { fields: ['street'], help: 'quarter(street): four plots round a cross street; attrs q 0..3, qx, qz -1|1' },
    subdivide: { fields: ['max', 'gap', 'seed'], help: 'subdivide(max, gap?, seed?): cut at random across the longer side until no side passes max; attr lot' },
    edges: { fields: ['thick', 'gaps', 'sides'], help: 'edges(thick, gaps? [{ side, at, width }], sides? [0..3]): the plot\'s sides as thin plots inside it (0 north -z, 1 east, 2 south, 3 west), cut open at gaps; attr side' },
    scatter: { fields: ['count', 'size', 'margin', 'turn', 'seed'], help: 'scatter(count, size [w, d], margin?, turn?): plots at random inside each plot; attr k' },
    move: { fields: ['by', 'lift', 'yaw'], help: 'move(by [x, z] along the plot\'s own axes, lift?, yaw?): shift and turn plots' },
    resize: { fields: ['w', 'd'], help: 'resize(w?, d?): set a plot\'s size about its centre' },
    lift: { fields: ['by'], help: 'lift(by): raise a plot\'s floor' },
    ground: { fields: ['mode', 'offset'], help: 'ground(mode "min"|"max"|"center", offset?): stand each plot on the land (`land` in the source): its floor at the lowest ground under it (nothing floats), the highest (a platform over a hollow), or its centre' },
    attr: { fields: ['set'], help: 'attr(set { name: value }): give plots numbers later sums read' },
    retag: { fields: ['add', 'remove'], help: 'retag(add? [...], remove? [...]): tags on plots' },
    filter: { fields: ['not'], help: 'filter(where?, tag?, not?): keep only the plots that pass (and every part); `not` keeps the others' },
    merge: { many: true, fields: [], help: 'merge(inputs [...]): every item of several nodes' },
    repeat: { fields: ['count', 'chain'], help: 'repeat(count, chain [nodes]): run the chain count times over its own output; `k` is the round, 0 first' },
    use: { fields: ['component', 'params'], help: 'use(component, params?): run a component on each plot, the plot at its origin; its output is turned and moved onto the plot' },
    box: { fields: ['height', 'mesh', 'color', 'jitter', 'fill', 'lift', 'keep', 'tumble', 'shadows', 'name', 'surface'], help: 'box(height, color, surface?, mesh?, fill? [x, z], lift?, jitter?, keep? "top"|"plot", tumble?, shadows?, name?): a shape standing on each plot; keep "top" passes the plot on lifted to its top' },
    roof: { fields: ['pitch', 'overhang', 'thick', 'color', 'jitter', 'along', 'lift', 'name', 'shadows', 'surface'], help: 'roof(pitch? 28, overhang? 1, thick? 0.4, color, surface?, along? "long"|"x"|"z", lift?): a pitched roof of two slabs on each plot, its ridge along the longer side at the height the pitch gives, starting at the floor of the plot (stand it on a body with keep "top")' },
    model: { fields: ['kind', 'at', 'scale', 'yaw', 'tilt', 'keep', 'name'], help: 'model(kind, at? [x, y, z] in the plot frame, scale? n | [x, y, z], yaw?, tilt? [about x, about z], keep?): one of the `models` of the graph on each plot, its own entity at the size it was made times scale; for a few large things, not a crowd' },
    plant: { fields: ['kind', 'at', 'scale', 'yaw', 'keep', 'name'], help: 'plant(kind, at? [x, y, z] in the plot frame, scale?, yaw?, keep?): one of the `plants` of the graph on each plot, drawn shared with the detail its distance wants (a tree, not a ball on a post); yaw is random unless given' },
    part: { fields: ['at', 'size', 'mesh', 'color', 'jitter', 'yaw', 'tilt', 'tumble', 'shadows', 'keep', 'name', 'flip', 'surface'], help: 'part(at [x, y, z] in the plot\'s frame, size [x, y, z], color, surface?, mesh?, yaw?, tilt? [about x, about z] degrees, flip?, keep?): one shape placed on each plot' },
    beam: { fields: ['from', 'to', 'thick', 'color', 'mesh', 'space', 'jitter', 'shadows', 'name', 'surface'], help: 'beam(from [x, y, z], to [x, y, z], thick, color, surface?, space? "plot"|"world"): a rod between two points, once per plot; in the plot frame (y from its floor) unless space is "world"' },
    output: { many: true, fields: [], help: 'output(inputs [...]): the parts the graph is; each input becomes its own group in the scene' },
};

/** One line per operation, for the tool text. */
export const PROC_OPS_TEXT = Object.entries(PROC_OPS).map(([, s]) => s.help).join('; ');

const isParam = (v: unknown): boolean => typeof v === 'number' || (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'number'));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function checkNodes(nodes: unknown, where: string, components: ReadonlySet<string>, inComponent: boolean): void {
    if (!Array.isArray(nodes) || nodes.length === 0) throw new ProcBuildError(`${where}: \`nodes\` must be a list of one node or more`);
    const ids = new Set<string>(inComponent ? ['in'] : []);
    nodes.forEach((raw, i) => {
        if (!isObj(raw)) throw new ProcBuildError(`${where} node ${i}: a node is an object { op, ... }`);
        const node = raw as ProcNode;
        const label = node.id ? `${where} node "${node.id}"` : `${where} node ${i}`;
        const spec = PROC_OPS[node.op];
        if (!spec) throw new ProcBuildError(`${label}: there is no op "${String(node.op)}"; there are ${Object.keys(PROC_OPS).join(', ')}`, node.id ?? null, String(node.op));
        for (const key of Object.keys(node)) {
            if (!COMMON.includes(key) && !spec.fields.includes(key)) {
                throw new ProcBuildError(`${label}: ${node.op} has no field "${key}"; it reads ${[...spec.fields].join(', ') || 'only the common fields'}`, node.id ?? null, node.op);
            }
        }
        if (node.id !== undefined) {
            if (typeof node.id !== 'string' || !/^[A-Za-z_][\w-]*$/.test(node.id)) throw new ProcBuildError(`${label}: an id is a name of letters, digits, _ and -`);
            if (ids.has(node.id)) throw new ProcBuildError(`${label}: the id "${node.id}" is used twice`, node.id, node.op);
        }
        if (!spec.source && !spec.many && node.input === undefined && i === 0 && !inComponent) {
            throw new ProcBuildError(`${label}: ${node.op} works on what comes before it, and it is first: start with a source (${Object.entries(PROC_OPS).filter(([, s]) => s.source).map(([k]) => k).join(', ')})`, node.id ?? null, node.op);
        }
        if (!spec.many && !spec.source && node.input === null) throw new ProcBuildError(`${label}: nothing is wired into it`, node.id ?? null, node.op);
        const refs = spec.many ? node.inputs : node.input !== undefined ? [node.input] : [];
        if (spec.many && (!Array.isArray(node.inputs) || node.inputs.length === 0)) throw new ProcBuildError(`${label}: ${node.op} takes \`inputs\`, a list of node ids`, node.id ?? null, node.op);
        for (const ref of refs ?? []) {
            if (typeof ref !== 'string' || !ids.has(ref)) {
                throw new ProcBuildError(`${label}: its input "${String(ref)}" is not a node before it${inComponent ? ' (a component\'s own input is "in")' : ''}`, node.id ?? null, node.op);
            }
        }
        if (node.op === 'use') {
            if (typeof node.component !== 'string' || !components.has(node.component)) {
                throw new ProcBuildError(`${label}: component "${String(node.component)}" is not in \`components\`; there are ${[...components].join(', ') || 'none'}`, node.id ?? null, node.op);
            }
        }
        if (node.op === 'repeat') checkNodes(node.chain, `${label} chain`, components, true);
        if (node.id) ids.add(node.id);
    });
}

/** Checks a source as written and answers it typed, or throws a {@link ProcBuildError} naming the first thing wrong. */
export function validateProcSource(raw: unknown): ProcSource {
    if (!isObj(raw)) throw new ProcBuildError('a rules graph is an object { version: 1, nodes: [...] }');
    if (raw.version !== 1) throw new ProcBuildError('`version` must be 1');
    const known = ['version', 'unit', 'land', 'seed', 'params', 'components', 'nodes', 'note', 'surfaces', 'plants', 'models'];
    for (const key of Object.keys(raw)) if (!known.includes(key)) throw new ProcBuildError(`a rules graph has no field "${key}"; it has ${known.join(', ')}`);
    if (raw.unit !== undefined && !(typeof raw.unit === 'number' && raw.unit > 0)) throw new ProcBuildError('`unit` must be a positive number');
    if (raw.land !== undefined && typeof raw.land !== 'string') throw new ProcBuildError('`land` is a project path to a .esland');
    if (raw.plants !== undefined) {
        if (!isObj(raw.plants)) throw new ProcBuildError('`plants` is { name: { mesh, lods?, material?, texture?, near?, reach?, shadows? } }');
        for (const [k, v] of Object.entries(raw.plants)) {
            if (!isObj(v) || typeof v.mesh !== 'string') throw new ProcBuildError(`plant "${k}" wants a \`mesh\`: a project path to its .esmesh`);
            for (const f of Object.keys(v)) if (!['mesh', 'lods', 'material', 'texture', 'near', 'reach', 'shadows'].includes(f)) throw new ProcBuildError(`plant "${k}" has no field "${f}"`);
            if (v.lods !== undefined && !(Array.isArray(v.lods) && v.lods.every((l) => typeof l === 'string'))) throw new ProcBuildError(`plant "${k}": lods is a list of mesh paths, nearest first`);
            for (const f of ['near', 'reach'] as const) if (v[f] !== undefined && !(typeof v[f] === 'number' && (v[f] as number) > 0)) throw new ProcBuildError(`plant "${k}": ${f} is a length above 0`);
        }
    }
    if (raw.models !== undefined) {
        if (!isObj(raw.models)) throw new ProcBuildError('`models` is { name: { mesh, material?, texture?, shadows? } }');
        for (const [k, v] of Object.entries(raw.models)) {
            if (!isObj(v) || typeof v.mesh !== 'string') throw new ProcBuildError(`model "${k}" wants a \`mesh\`: a project path to its .esmesh`);
            for (const f of Object.keys(v)) if (!['mesh', 'material', 'texture', 'shadows'].includes(f)) throw new ProcBuildError(`model "${k}" has no field "${f}"`);
        }
    }
    if (raw.surfaces !== undefined) {
        if (!isObj(raw.surfaces)) throw new ProcBuildError('`surfaces` is { name: { material?, texture?, tile? } }');
        for (const [k, v] of Object.entries(raw.surfaces)) {
            if (!isObj(v)) throw new ProcBuildError(`surface "${k}" is { material?, texture?, tile? }`);
            for (const f of Object.keys(v)) if (!['material', 'texture', 'tile'].includes(f)) throw new ProcBuildError(`surface "${k}" has no field "${f}"`);
            if (v.tile !== undefined && !(typeof v.tile === 'number' && v.tile > 0)) throw new ProcBuildError(`surface "${k}": tile is a length above 0`);
            if ((v.material !== undefined && typeof v.material !== 'string') || (v.texture !== undefined && typeof v.texture !== 'string')) throw new ProcBuildError(`surface "${k}": material and texture are project paths`);
        }
    }
    if (raw.params !== undefined) {
        if (!isObj(raw.params)) throw new ProcBuildError('`params` is { name: number or list of numbers }');
        for (const [k, v] of Object.entries(raw.params)) if (!isParam(v)) throw new ProcBuildError(`param "${k}" must be a number or a list of numbers`);
    }
    const components = isObj(raw.components) ? raw.components : {};
    if (raw.components !== undefined && !isObj(raw.components)) throw new ProcBuildError('`components` is { name: { params?, nodes } }');
    const names = new Set(Object.keys(components));
    for (const [name, c] of Object.entries(components)) {
        if (!isObj(c)) throw new ProcBuildError(`component "${name}" is { params?, nodes, output? }`);
        if (c.params !== undefined && (!isObj(c.params) || !Object.values(c.params).every(isParam))) throw new ProcBuildError(`component "${name}": \`params\` is { name: number or list of numbers }`);
        checkNodes(c.nodes, `component "${name}"`, names, true);
    }
    checkNodes(raw.nodes, 'the graph', names, false);
    const outputs = (raw.nodes as ProcNode[]).filter((n) => n.op === 'output');
    if (outputs.length !== 1) throw new ProcBuildError(`the graph needs one \`output\` node, and has ${outputs.length}`);
    return raw as unknown as ProcSource;
}

/** An edit to a source, as terrain_edit's are to a land. */
export type ProcEdit =
    | { op: 'set'; node: string; fields: Record<string, unknown>; component?: string }
    | { op: 'insert'; node: ProcNode; before?: string; after?: string; component?: string }
    | { op: 'remove'; node: string; component?: string }
    | { op: 'settings'; fields: Partial<Pick<ProcSource, 'unit' | 'land' | 'seed' | 'params' | 'note'>> }
    | { op: 'component'; name: string; value: ProcComponent | null };

/** Applies edits in order to a copy of @p source; the result is validated. */
export function applyProcEdits(source: ProcSource, edits: readonly ProcEdit[]): ProcSource {
    const next = JSON.parse(JSON.stringify(source)) as ProcSource;
    for (const edit of edits) {
        if (edit.op === 'settings') {
            for (const [k, v] of Object.entries(edit.fields)) {
                if (v === null) delete (next as unknown as Record<string, unknown>)[k];
                else (next as unknown as Record<string, unknown>)[k] = v;
            }
            continue;
        }
        if (edit.op === 'component') {
            next.components ??= {};
            if (edit.value === null) delete next.components[edit.name];
            else next.components[edit.name] = edit.value;
            continue;
        }
        const list = edit.component ? next.components?.[edit.component]?.nodes : next.nodes;
        if (!list) throw new ProcBuildError(`there is no component "${edit.component}"`);
        const find = (id: string): number => {
            const i = list.findIndex((n) => n.id === id);
            if (i < 0) throw new ProcBuildError(`there is no node "${id}"${edit.component ? ` in component "${edit.component}"` : ''}`);
            return i;
        };
        if (edit.op === 'set') {
            const node = list[find(edit.node)]!;
            for (const [k, v] of Object.entries(edit.fields)) {
                if (v === null) delete node[k];
                else node[k] = v;
            }
        } else if (edit.op === 'remove') {
            list.splice(find(edit.node), 1);
        } else if (edit.op === 'insert') {
            const at = edit.before ? find(edit.before) : edit.after ? find(edit.after) + 1 : list.length;
            list.splice(at, 0, edit.node);
        }
    }
    return validateProcSource(next);
}
