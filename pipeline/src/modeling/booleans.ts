// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  booleans.ts — the `boolean` step: a hole right through a wall, parts welded into one.
 *
 *        Manifold does the cut, because a hand-written one leaves the cracks and slivers
 *        that this kernel's own report exists to catch. Its wasm loads asynchronously and
 *        a build is synchronous, so a caller prepares it first: see {@link prepareModeling}.
 */
import { MeshoptSimplifier } from 'meshoptimizer';
import { triangulateFace } from './triangulate';
import { collectEdges, compact, selectFaces, type Face, type FaceSelector, type PolyMesh, type Vec3 } from './polyMesh';

interface ManifoldMeshData {
    numProp: number;
    vertProperties: Float32Array;
    triVerts: Uint32Array;
    faceID?: Uint32Array;
}
interface ManifoldSolid {
    add(other: ManifoldSolid): ManifoldSolid;
    subtract(other: ManifoldSolid): ManifoldSolid;
    intersect(other: ManifoldSolid): ManifoldSolid;
    getMesh(): ManifoldMeshData;
    isEmpty(): boolean;
    delete(): void;
}
interface ManifoldEngine {
    setup(): void;
    Mesh: new (data: ManifoldMeshData) => ManifoldMeshData;
    Manifold: new (mesh: ManifoldMeshData) => ManifoldSolid;
}

let engine: ManifoldEngine | null = null;

/** Whether any step of a parsed source needs {@link prepareModeling} first. */
export const needsPreparing = (steps: readonly { op: string; steps?: unknown }[]): boolean => steps.some((s) => s.op === 'boolean' || s.op === 'decimate'
    // What a repeat holds runs too.
    || (Array.isArray(s.steps) && needsPreparing(s.steps as { op: string }[])));

/**
 * Loads what `boolean` and `decimate` steps run on; once is enough. `wasmUrl` is for a bundled host,
 * where the module cannot find its own file beside itself.
 */
export async function prepareModeling(wasmUrl?: string): Promise<void> {
    await MeshoptSimplifier.ready;
    if (engine) return;
    const { default: Module } = await import('manifold-3d/manifold') as unknown as {
        default: (options?: { locateFile?: () => string }) => Promise<ManifoldEngine>;
    };
    const loaded = await Module(wasmUrl ? { locateFile: () => wasmUrl } : undefined);
    loaded.setup();
    engine = loaded;
}

/** Why these faces are not a solid a boolean could cut, or null. */
function notSolid(mesh: PolyMesh, faces: readonly number[]): string | null {
    const only: PolyMesh = { positions: mesh.positions, faces: faces.map((f) => mesh.faces[f]!) };
    let open = 0, crowded = 0;
    for (const edge of collectEdges(only).values()) {
        if (edge.faces.length === 1) open++;
        else if (edge.faces.length > 2) crowded++;
    }
    if (open) return `they have ${open} open edge${open > 1 ? 's' : ''}, so there is no inside to cut`;
    if (crowded) return `${crowded} edge${crowded > 1 ? 's are' : ' is'} shared by more than two faces; raise an organic skin's resolution or blend, or weld`;
    return null;
}

function toSolid(e: ManifoldEngine, mesh: PolyMesh, faces: readonly number[], triangulate: (face: Face) => [number, number, number][]): ManifoldSolid {
    const remap = new Map<number, number>();
    const props: number[] = [];
    const tris: number[] = [];
    const ids: number[] = [];
    const index = (v: number): number => {
        let to = remap.get(v);
        if (to === undefined) {
            to = props.length / 3;
            remap.set(v, to);
            const p = mesh.positions[v]!;
            props.push(p[0], p[1], p[2]);
        }
        return to;
    };
    for (const f of faces) {
        for (const [a, b, c] of triangulate(mesh.faces[f]!)) {
            tris.push(index(a), index(b), index(c));
            ids.push(f);
        }
    }
    const data = new e.Mesh({
        numProp: 3,
        vertProperties: new Float32Array(props),
        triVerts: new Uint32Array(tris),
        faceID: new Uint32Array(ids),
    });
    try {
        return new e.Manifold(data);
    } catch (err) {
        throw new Error(`these faces are not a clean solid (${(err as Error).message}), so they cannot be cut: raise an organic skin's resolution, or weld and check the report's warnings`);
    }
}

export type BooleanOperation = 'subtract' | 'union' | 'intersect';

export interface BooleanParams {
    operation: BooleanOperation;
    /** The cutter, or what is added: a closed shell, usually by its tag. Consumed unless `keep`. */
    with: FaceSelector;
    /** What is cut. Default every face not in `with`. */
    from?: FaceSelector;
    keep?: boolean;
    /** Names the walls of the cut, which otherwise take the cutter's tag. */
    tag?: string;
    color?: readonly number[];
}

/** Applies the operation. Each result face keeps the tag and colour of the face it came from; a cut's walls come from the cutter. */
export function booleanOp(mesh: PolyMesh, p: BooleanParams): PolyMesh {
    if (!engine) throw new Error('booleans are not loaded: call prepareModeling() before building this source');
    if (!['subtract', 'union', 'intersect'].includes(p.operation)) throw new Error(`operation ${JSON.stringify(p.operation)} must be subtract, union or intersect`);
    const tool = selectFaces(mesh, p.with);
    if (tool.length === 0) throw new Error(`\`with\` ${JSON.stringify(p.with)} matched no face`);
    const toolSet = new Set(tool);
    const target = (p.from === undefined ? mesh.faces.map((_, i) => i) : selectFaces(mesh, p.from)).filter((f) => !toolSet.has(f));
    if (target.length === 0) throw new Error(`\`from\` ${JSON.stringify(p.from ?? 'everything else')} leaves no face to act on`);
    for (const [name, faces] of [['with', tool], ['from', target]] as const) {
        const bad = notSolid(mesh, faces);
        if (bad) throw new Error(`the faces in \`${name}\` are not a closed solid: ${bad}`);
    }

    const triangulate = (face: Face): [number, number, number][] => triangulateFace(mesh, face);
    const a = toSolid(engine, mesh, target, triangulate);
    const b = toSolid(engine, mesh, tool, triangulate);
    const result = p.operation === 'subtract' ? a.subtract(b) : p.operation === 'union' ? a.add(b) : a.intersect(b);
    try {
        if (result.isEmpty()) throw new Error(`this ${p.operation} leaves nothing: do the two actually overlap?`);
        const out = result.getMesh();
        const base = mesh.positions.length;
        const positions: Vec3[] = [...mesh.positions];
        for (let i = 0; i < out.vertProperties.length; i += out.numProp) {
            positions.push([out.vertProperties[i]!, out.vertProperties[i + 1]!, out.vertProperties[i + 2]!]);
        }
        const targetSet = new Set(target);
        const kept = mesh.faces.filter((_, i) => !targetSet.has(i) && (p.keep === true || !toolSet.has(i)));
        const made: Face[] = [];
        for (let t = 0; t * 3 < out.triVerts.length; t++) {
            const source = mesh.faces[out.faceID![t]!];
            if (!source) throw new Error(`the cut lost track of a face (${out.faceID![t]})`);
            const fromTool = toolSet.has(out.faceID![t]!);
            made.push({
                ...source,
                v: [out.triVerts[t * 3]! + base, out.triVerts[t * 3 + 1]! + base, out.triVerts[t * 3 + 2]! + base],
                ...(fromTool && p.tag ? { tag: p.tag } : {}),
                ...(fromTool && p.color ? { color: [p.color[0]!, p.color[1]!, p.color[2]!, p.color[3] ?? 1] as const } : {}),
            });
        }
        return compact({ positions, faces: [...kept, ...made] });
    } finally {
        a.delete();
        b.delete();
        result.delete();
    }
}
