// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A Cocos Creator 3.x `.scene` / `.prefab` file read as a tree.
 *
 *        The file is a flat array whose objects point at each other by index
 *        (`{__id__: n}`) and at assets by uuid (`{__uuid__}`). Nothing downstream
 *        wants that shape, so it is resolved once here into nodes with their
 *        components, and a prefab instance — a node whose children live in
 *        another file — is kept as a reference plus the overrides it applies.
 *
 *        Read-only: nothing here touches the project it reads.
 */

export interface CocosVec3 { x: number; y: number; z: number }
export interface CocosQuat { x: number; y: number; z: number; w: number }

/** One `propertyOverrides` entry of a prefab instance. */
export interface CocosOverride {
    /** `localID` of the target: the instance nodes crossed, then the node or component. */
    target: string[];
    /** Property path on the target (`['_lpos']`, `['_color']`). */
    path: string[];
    value: unknown;
}

export interface CocosComponent {
    /** `cc.Sprite`, or a script's compressed class id. */
    type: string;
    /** Stable id inside its file (the `CompPrefabInfo` fileId). */
    id: string;
    enabled: boolean;
    /** The serialised fields, without the bookkeeping that points back at the node. */
    data: Record<string, unknown>;
}

export interface CocosInstanceRef {
    /** uuid of the prefab this node stands for. */
    asset: string;
    overrides: CocosOverride[];
    /** Things an instance can carry that this reader does not carry across yet. */
    mountedChildren: number;
    mountedComponents: number;
    removedComponents: number;
}

export interface CocosNode {
    /** Stable id inside its file: the `PrefabInstance` fileId for an instance, else the `PrefabInfo` fileId, else the node's `_id`. */
    id: string;
    name: string;
    active: boolean;
    pos: CocosVec3;
    rot: CocosQuat;
    scale: CocosVec3;
    layer: number;
    components: CocosComponent[];
    children: CocosNode[];
    instance?: CocosInstanceRef;
}

export interface CocosDocument {
    kind: 'prefab' | 'scene';
    name: string;
    roots: CocosNode[];
    /** Scene-level settings (skybox, fog, shadows...) that were present and are not carried over. */
    globals: string[];
    /** Node ids that had to be made unique because the file repeats them. */
    duplicateIds: number;
}

type Raw = Record<string, unknown>;

const BOOKKEEPING = new Set(['__type__', '_name', '_objFlags', 'node', '__prefab', '_id', '__editorExtras__']);

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function vec3(v: unknown, d: CocosVec3): CocosVec3 {
    return isObj(v) ? { x: num(v.x, d.x), y: num(v.y, d.y), z: num(v.z, d.z) } : { ...d };
}

function quat(v: unknown): CocosQuat {
    return isObj(v) ? { x: num(v.x, 0), y: num(v.y, 0), z: num(v.z, 0), w: num(v.w, 1) } : { x: 0, y: 0, z: 0, w: 1 };
}

/** A fileId is base64, so it can hold `/`; the engine reads `/` as the step into a nested prefab, so it cannot stay. */
const safeId = (id: string): string => id.replaceAll('/', '|');

export function parseCocosDocument(file: unknown, fallbackName = ''): CocosDocument {
    if (!Array.isArray(file) || file.length === 0) throw new Error('not a Cocos scene/prefab: expected a non-empty array');
    const objs = file as unknown[];
    const at = (ref: unknown): Raw | null => {
        if (!isObj(ref) || typeof ref.__id__ !== 'number') return null;
        const o = objs[ref.__id__];
        return isObj(o) ? o : null;
    };
    const indexOf = (ref: unknown): number => (isObj(ref) && typeof ref.__id__ === 'number' ? ref.__id__ : -1);

    const head = isObj(objs[0]) ? objs[0] : null;
    const globals: string[] = [];
    let rootRefs: unknown[];
    let kind: CocosDocument['kind'];
    let name = fallbackName;
    if (head?.__type__ === 'cc.Prefab') {
        kind = 'prefab';
        name = typeof head._name === 'string' && head._name ? head._name : name;
        rootRefs = [head.data];
    } else if (head?.__type__ === 'cc.SceneAsset') {
        kind = 'scene';
        const scene = at(head.scene);
        if (!scene) throw new Error('scene asset has no scene');
        name = typeof scene._name === 'string' && scene._name ? scene._name : name;
        rootRefs = Array.isArray(scene._children) ? scene._children : [];
        const g = at(scene._globals);
        if (g) for (const k of ['ambient', 'shadows', 'skybox', 'fog', 'octree', 'lightProbeInfo']) if (g[k]) globals.push(k);
    } else {
        throw new Error(`not a Cocos scene/prefab: first object is ${String(head?.__type__)}`);
    }

    const seen = new Set<number>();
    const usedIds = new Map<string, number>();
    let duplicateIds = 0;
    // Copy-pasted instances can carry the same fileId; the engine needs every entity in a prefab to have its own.
    const unique = (id: string): string => {
        const n = usedIds.get(id) ?? 0;
        usedIds.set(id, n + 1);
        if (n === 0) return id;
        duplicateIds++;
        return `${id}~${n + 1}`;
    };
    const readNode = (ref: unknown): CocosNode | null => {
        const idx = indexOf(ref);
        const n = at(ref);
        if (!n || n.__type__ !== 'cc.Node' || seen.has(idx)) return null;
        seen.add(idx);
        const info = at(n._prefab);
        const instRaw = info ? at(info.instance) : null;
        // An instance node's PrefabInfo.fileId is the nested prefab's own root id, so two instances of one prefab share it;
        // the instance's identity inside this file — and the first step of any override path crossing it — is the PrefabInstance's.
        const id = unique(safeId((instRaw && typeof instRaw.fileId === 'string' && instRaw.fileId)
            || (info && typeof info.fileId === 'string' && info.fileId)
            || (typeof n._id === 'string' && n._id)
            || `#${idx}`));

        const node: CocosNode = {
            id,
            name: typeof n._name === 'string' ? n._name : '',
            active: n._active !== false,
            pos: vec3(n._lpos, { x: 0, y: 0, z: 0 }),
            rot: quat(n._lrot),
            scale: vec3(n._lscale, { x: 1, y: 1, z: 1 }),
            layer: num(n._layer, 0),
            components: [],
            children: [],
        };

        for (const cref of Array.isArray(n._components) ? n._components : []) {
            const c = at(cref);
            if (!c || typeof c.__type__ !== 'string') continue;
            const cinfo = at(c.__prefab);
            const cid = safeId((cinfo && typeof cinfo.fileId === 'string' && cinfo.fileId) || (typeof c._id === 'string' && c._id) || `#${indexOf(cref)}`);
            const data: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(c)) if (!BOOKKEEPING.has(k)) data[k] = v;
            node.components.push({ type: c.__type__, id: cid, enabled: c._enabled !== false, data });
        }

        if (instRaw && info) {
            const asset = isObj(info.asset) && typeof info.asset.__uuid__ === 'string' ? info.asset.__uuid__ : '';
            const overrides: CocosOverride[] = [];
            for (const oref of Array.isArray(instRaw.propertyOverrides) ? instRaw.propertyOverrides : []) {
                const o = at(oref);
                const t = o ? at(o.targetInfo) : null;
                if (!o || !t || !Array.isArray(t.localID) || !Array.isArray(o.propertyPath)) continue;
                overrides.push({ target: t.localID.map((x) => safeId(String(x))), path: o.propertyPath.map(String), value: o.value });
            }
            const count = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
            node.instance = {
                asset,
                overrides,
                mountedChildren: count(instRaw.mountedChildren),
                mountedComponents: count(instRaw.mountedComponents),
                removedComponents: count(instRaw.removedComponents),
            };
        }

        for (const cr of Array.isArray(n._children) ? n._children : []) {
            const child = readNode(cr);
            if (child) node.children.push(child);
        }
        return node;
    };

    const roots: CocosNode[] = [];
    for (const r of rootRefs) {
        const n = readNode(r);
        if (n) roots.push(n);
    }
    return { kind, name, roots, globals, duplicateIds };
}
