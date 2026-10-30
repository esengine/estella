// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A Cocos prefab or scene as an Estella prefab or scene.
 *
 *        A nested prefab stays a nested prefab: the instance becomes a slot that
 *        names the converted prefab, and what the Cocos instance changed becomes
 *        overrides. Those are not translated property by property — the instance's
 *        overrides are applied to the Cocos tree, both versions are converted, and
 *        the difference is the override list. So the override vocabulary is
 *        whatever the component mapping already knows, with no second table.
 *
 *        Addresses follow the engine's own: an entity inside a nested prefab is
 *        `slot/localId`, a prefab's own entities are bare ids.
 */
import { convertNode, sameData, type ComponentContext, type ComponentData } from './components';
import { foldEditBoxes } from './editBoxFold';
import { NODE_REF, type CocosDocument, type CocosNode, type CocosOverride } from './document';
import { ImportReport } from './report';
import { anchoredRect, type RectAnchorsData } from '../../../../sdk/src/ui/layout/rect-anchors';

/** What a field a document does not carry means (the component's own defaults). */
const DEFAULT_ANCHORS: RectAnchorsData = {
    alignFlags: 0, left: 0, right: 0, top: 0, bottom: 0, horizontalCenter: 0, verticalCenter: 0,
    isAbsLeft: true, isAbsRight: true, isAbsTop: true, isAbsBottom: true, isAbsHorizontalCenter: true, isAbsVerticalCenter: true,
    alignMode: 1, enabled: true,
};

const SEP = '/';

type Raw = Record<string, unknown>;

export interface PrefabOverride {
    prefabEntityId: string;
    type: 'property' | 'component_added' | 'component_removed' | 'name' | 'visibility';
    componentType?: string;
    propertyName?: string;
    value?: unknown;
    componentData?: ComponentData;
}

export interface PrefabEntity {
    prefabEntityId: string;
    name: string;
    parent: string | null;
    children: string[];
    components: ComponentData[];
    visible: boolean;
    metadata?: Raw;
    nestedPrefab?: { prefabPath: string; overrides: PrefabOverride[] };
}

export interface PrefabFile {
    version: string;
    name: string;
    rootEntityId: string;
    entities: PrefabEntity[];
}

export interface SceneEntity {
    id: number;
    name: string;
    parent: number | null;
    children: number[];
    components: ComponentData[];
    visible: boolean;
    metadata?: Raw;
}

export interface SceneInstanceEntry {
    id: number;
    parent: number | null;
    prefab: string;
    overrides: PrefabOverride[];
    added: never[];
    removed: string[];
}

export interface SceneFile {
    version: number;
    name: string;
    entities: (SceneEntity | SceneInstanceEntry)[];
}

export interface ConvertContext extends ComponentContext {
    /** The parsed prefab a uuid names, or null when the project does not have it. */
    loadPrefab(uuid: string): CocosDocument | null;
    /** The project-relative path the converted prefab of a uuid is written to. */
    prefabRef(uuid: string): string | null;
    /** Where the document being converted lives, for notes. */
    where: string;
    /** The project's design resolution: the box a root pinned to the screen is placed in, so the document holds where it will be. */
    design?: { width: number; height: number };
}

// ---------------------------------------------------------------------------
// The expanded Cocos tree: instances inlined, overrides applied.
// ---------------------------------------------------------------------------

interface XNode {
    /** Engine address: bare id in a prefab's own space, `slot/id` across a nesting boundary. */
    addr: string;
    /** Prefix the engine address adds to this node's components' ids. */
    prefix: string;
    node: CocosNode;
    children: XNode[];
}

const MAX_DEPTH = 24;

function build(node: CocosNode, ctx: ConvertContext, stack: string[]): XNode {
    if (node.instance) {
        const sub = expandAsset(node.instance.asset, ctx, stack);
        if (!sub) {
            ctx.report.note('prefab-missing', `${ctx.where}: ${node.name}`);
            ctx.report.missingAsset(node.instance.asset);
            return { addr: node.id, prefix: '', node: { ...node, children: [] }, children: [] };
        }
        applyOverrides(sub, node.instance.overrides, ctx);
        applyMounted(sub, node.instance.mounted, ctx);
        if (node.instance.mountedChildren) ctx.report.note('instance-mounted-children', `${ctx.where}: ${node.name}`);
        if (node.instance.removedComponents) ctx.report.note('instance-removed-components', `${ctx.where}: ${node.name}`);
        return lift(sub, node.id);
    }
    return { addr: node.id, prefix: '', node: { ...node, children: [] }, children: node.children.map((c) => build(c, ctx, stack)) };
}

/** Put a tree under a slot: every address gains the slot's prefix. */
function lift(tree: XNode, slot: string): XNode {
    const walk = (x: XNode): XNode => ({
        addr: `${slot}${SEP}${x.addr}`,
        prefix: x.prefix ? `${slot}${SEP}${x.prefix}` : slot,
        node: x.node,
        children: x.children.map(walk),
    });
    return walk(tree);
}

const expanded = new WeakMap<ConvertContext, Map<string, XNode | null>>();

/** A prefab with its own instances expanded, in its own address space. Cached; callers get a copy. */
function expandAsset(uuid: string, ctx: ConvertContext, stack: string[]): XNode | null {
    let cache = expanded.get(ctx);
    if (!cache) expanded.set(ctx, (cache = new Map()));
    const hit = cache.get(uuid);
    if (hit !== undefined) return hit ? structuredClone(hit) : null;
    if (stack.includes(uuid) || stack.length > MAX_DEPTH) {
        ctx.report.note('prefab-cycle', `${ctx.where}: ${uuid}`);
        return null;
    }
    const doc = ctx.loadPrefab(uuid);
    const root = doc?.roots[0];
    if (!doc || !root) {
        cache.set(uuid, null);
        return null;
    }
    const tree = build(root, ctx, [...stack, uuid]);
    cache.set(uuid, tree);
    return structuredClone(tree);
}

// ---------------------------------------------------------------------------
// Overrides, in the Cocos domain.
// ---------------------------------------------------------------------------

/** A Cocos value without its `__type__` tags, which name the class and mean nothing to the data. */
function clean(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(clean);
    if (typeof v !== 'object' || v === null) return v;
    return Object.fromEntries(Object.entries(v).filter(([k]) => k !== '__type__').map(([k, x]) => [k, clean(x)]));
}

function applyOverrides(tree: XNode, overrides: CocosOverride[], ctx: ConvertContext): void {
    const nodes = new Map<string, XNode>();
    const comps = new Map<string, { c: CocosNode["components"][number] }>();
    const index = (x: XNode): void => {
        nodes.set(x.addr, x);
        for (const c of x.node.components) comps.set(x.prefix ? `${x.prefix}${SEP}${c.id}` : c.id, { c });
        x.children.forEach(index);
    };
    index(tree);

    for (const raw of overrides) {
        const o = { ...raw, value: clean(raw.value) };
        const key = o.target.join(SEP);
        const prop = o.path[0];
        const nodeHit = nodes.get(key);
        const compHit = comps.get(key);
        if (compHit && prop !== undefined) {
            // The tree came from a clone, so its nodes are this call's to change.
            const { c } = compHit;
            if (prop === '_enabled') {
                c.enabled = o.value !== false;
                continue;
            }
            setPath(c.data, o.path, o.value);
            continue;
        }
        if (nodeHit && prop !== undefined) {
            const n = nodeHit.node;
            const v = o.value as Raw;
            if (typeof v === 'object' && v !== null && '__id__' in v) {
                ctx.report.note('override-object-reference', `${ctx.where}: ${key}.${prop}`);
                continue;
            }
            switch (prop) {
                case '_name': n.name = String(o.value); break;
                case '_active': n.active = o.value !== false; break;
                case '_lpos': n.pos = { ...n.pos, ...(v as object) }; break;
                case '_lrot': n.rot = { ...n.rot, ...(v as object) }; break;
                case '_lscale': n.scale = { ...n.scale, ...(v as object) }; break;
                case '_layer': n.layer = Number(o.value); break;
                case '_euler': break; // derived from the rotation
                default: ctx.report.note('override-node-property', `${ctx.where}: ${prop}`);
            }
            continue;
        }
        ctx.report.note(o.target.length > 1 ? 'override-target-missing-nested' : 'override-target-missing', `${ctx.where}: ${key}`);
    }
}

/**
 * The components the instance's file mounts on nodes of the prefab it names. The target is addressed as an override's is; a mounted component
 * with no node to land on is counted, not lost silently.
 */
function applyMounted(tree: XNode, mounted: NonNullable<CocosNode['instance']>['mounted'], ctx: ConvertContext): void {
    if (mounted.length === 0) return;
    const nodes = new Map<string, XNode>();
    const index = (x: XNode): void => {
        nodes.set(x.addr, x);
        x.children.forEach(index);
    };
    index(tree);
    for (const m of mounted) {
        const target = nodes.get(m.target.join(SEP));
        if (!target) {
            ctx.report.note('mounted-target-missing', `${ctx.where}: ${m.target.join(SEP)}`);
            continue;
        }
        for (const c of m.components) {
            target.node.components.push(structuredClone(c));
        }
    }
}

function setPath(target: Raw, path: string[], value: unknown): void {
    let cur = target;
    for (let i = 0; i < path.length - 1; i++) {
        const k = path[i]!;
        const next = cur[k];
        cur[k] = typeof next === 'object' && next !== null ? { ...(next as Raw) } : {};
        cur = cur[k] as Raw;
    }
    cur[path[path.length - 1]!] = value;
}

// ---------------------------------------------------------------------------
// Converting an expanded tree, and the difference between two.
// ---------------------------------------------------------------------------

interface Flat {
    name: string;
    visible: boolean;
    components: ComponentData[];
}

function flatten(tree: XNode, ctx: ConvertContext): Map<string, Flat> {
    const out = new Map<string, Flat>();
    const walk = (x: XNode): void => {
        const conv = convertNode(x.node, ctx, `${ctx.where}: ${x.node.name}`);
        out.set(x.addr, { name: x.node.name, visible: true, components: conv.components });
        x.children.forEach(walk);
    };
    walk(tree);
    return out;
}

/** What turns `pristine` into `patched`, as the engine's override list. */
function diff(pristine: Map<string, Flat>, patched: Map<string, Flat>, ctx: ConvertContext): PrefabOverride[] {
    const out: PrefabOverride[] = [];
    for (const [addr, now] of patched) {
        const was = pristine.get(addr);
        if (!was) {
            ctx.report.note('instance-added-entity', `${ctx.where}: ${addr}`);
            continue;
        }
        if (was.name !== now.name) out.push({ prefabEntityId: addr, type: 'name', value: now.name });
        if (was.visible !== now.visible) out.push({ prefabEntityId: addr, type: 'visibility', value: now.visible });
        const before = new Map(was.components.map((c) => [c.type, c]));
        const after = new Map(now.components.map((c) => [c.type, c]));
        for (const [type, c] of after) {
            const b = before.get(type);
            if (!b) {
                out.push({ prefabEntityId: addr, type: 'component_added', componentType: type, componentData: c });
                continue;
            }
            for (const [field, value] of Object.entries(c.data)) {
                if (!sameData(b.data[field], value)) {
                    if (holdsRef(value)) {
                        ctx.report.note('override-node-reference', `${ctx.where}: ${addr} ${type}.${field}`);
                        continue;
                    }
                    out.push({ prefabEntityId: addr, type: 'property', componentType: type, propertyName: field, value });
                }
            }
        }
        for (const type of before.keys()) {
            if (!after.has(type)) out.push({ prefabEntityId: addr, type: 'component_removed', componentType: type });
        }
    }
    return out;
}

/**
 * What an instance of a model changes about it. The model's own nodes were named by Cocos with ids this import does not know, so only the
 * instance's root can be addressed: its name, whether it is active and where it stands. The rest (a material put on a mesh, a clip set on its
 * animation) is counted, not lost silently.
 */
function modelInstanceOverrides(node: CocosNode, model: { rootId: string; name: string; paths: Map<string, string> }, ctx: ConvertContext): PrefabOverride[] {
    const inst = node.instance!;
    // A property of the instance's root: its name, whether it is on, where it stands. The overrides on a component of the model are told apart
    // by what they set: a skeletal animation's clip is carried, anything else is counted.
    const animation = animationOverrides(inst.overrides);
    const shape = (o: CocosOverride): boolean => ['_name', '_active', '_lpos', '_lrot', '_lscale', '_euler'].includes(o.path[0] ?? '');
    const roots = inst.overrides.filter((o) => o.target.length === 1 && shape(o));
    const inner = inst.overrides.length - roots.length - animation.used;
    if (inner > 0) ctx.report.note('model-instance-overrides', `${ctx.where}: ${node.name} (${inner} on the model's own parts)`);
    const out: PrefabOverride[] = [];
    if (animation.clip) {
        const timeline = ctx.clipOn?.(animation.clip, model.paths, `${ctx.where}: ${node.name}`);
        if (timeline) {
            out.push({
                prefabEntityId: model.rootId, type: 'component_added', componentType: 'TimelinePlayer',
                componentData: { type: 'TimelinePlayer', data: { timeline, playing: animation.playOnLoad, speed: 1, wrapMode: '' } },
            });
        } else {
            ctx.report.note('model-instance-clip-not-found', `${ctx.where}: ${node.name}`);
        }
    }
    const addr = roots[0]?.target[0];
    if (addr === undefined) return out;
    const base: CocosNode = {
        id: addr, name: model.name, active: true, pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 },
        layer: 33554432, components: [], children: [],
    };
    const pristine: XNode = { addr, prefix: '', node: base, children: [] };
    const patched = structuredClone(pristine);
    applyOverrides(patched, roots, ctx);
    const quiet: ConvertContext = { ...ctx, report: new ImportReport() };
    return [...out, ...diff(flatten(pristine, quiet), flatten(patched, quiet), ctx).map((o) => ({ ...o, prefabEntityId: model.rootId }))];
}

/** The clip an instance sets on its model's skeletal animation, if it sets one, and whether it plays on load. `used` counts the overrides read. */
function animationOverrides(overrides: CocosOverride[]): { clip: string | null; playOnLoad: boolean; used: number } {
    let defaultClip = '';
    let firstClip = '';
    let playOnLoad = false;
    let used = 0;
    for (const o of overrides) {
        const prop = o.path[0];
        const value = o.value as { __uuid__?: unknown } | boolean | null;
        if (prop === '_defaultClip' && typeof value === 'object' && value && typeof value.__uuid__ === 'string') { defaultClip = value.__uuid__; used++; }
        else if (prop === '_clips' && o.path[1] === '0' && typeof value === 'object' && value && typeof value.__uuid__ === 'string') { firstClip = value.__uuid__; used++; }
        else if (prop === '_clips' && o.path[1] === 'length') used++;
        else if (prop === 'playOnLoad') { playOnLoad = value === true; used++; }
    }
    return { clip: defaultClip || firstClip || null, playOnLoad, used };
}

/** The overrides an instance node applies over the prefab it names, or null when that prefab is missing. */
function instanceOverrides(node: CocosNode, ctx: ConvertContext): PrefabOverride[] | null {
    const inst = node.instance;
    if (!inst) return null;
    const model = ctx.modelInstance?.(inst.asset);
    if (model) return modelInstanceOverrides(node, model, ctx);
    const pristine = expandAsset(inst.asset, ctx, []);
    if (!pristine) return null;
    const patched = structuredClone(pristine);
    applyOverrides(patched, inst.overrides, ctx);
    applyMounted(patched, inst.mounted, ctx);
    if (inst.mountedChildren) ctx.report.note('instance-mounted-children', `${ctx.where}: ${node.name}`);
    if (inst.removedComponents) ctx.report.note('instance-removed-components', `${ctx.where}: ${node.name}`);
    // Converting both sides is for the difference only; the report counts a component where its own prefab is converted.
    const quiet: ConvertContext = { ...ctx, report: new ImportReport() };
    return diff(flatten(pristine, quiet), flatten(patched, quiet), ctx);
}

// ---------------------------------------------------------------------------
// References to nodes, inside component data.
// ---------------------------------------------------------------------------

const isRef = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v) && NODE_REF in v;

/** Whether a value holds a node reference anywhere inside it. */
function holdsRef(v: unknown): boolean {
    if (Array.isArray(v)) return v.some(holdsRef);
    if (typeof v !== 'object' || v === null) return false;
    return NODE_REF in v || Object.values(v).some(holdsRef);
}

/** Replace every node reference in @p v by what @p to makes of the node's id; a node the file does not hold gets @p missing. */
function mapRefs(v: unknown, to: (id: string) => unknown, missing: unknown): unknown {
    if (Array.isArray(v)) return v.map((x) => mapRefs(x, to, missing));
    if (typeof v !== 'object' || v === null) return v;
    if (isRef(v)) return typeof v[NODE_REF] === 'string' ? to(v[NODE_REF] as string) : missing;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapRefs(x, to, missing)]));
}

function resolveRefs(components: ComponentData[], to: (id: string) => unknown, missing: unknown): void {
    for (const c of components) for (const [k, v] of Object.entries(c.data)) if (holdsRef(v)) c.data[k] = mapRefs(v, to, missing);
}

// ---------------------------------------------------------------------------
// Documents.
// ---------------------------------------------------------------------------

/** Every node of a document by id, the nodes under an instance left out (they are the prefab's own, in its own space). */
function indexNodes(roots: CocosNode[]): Map<string, CocosNode> {
    const nodes = new Map<string, CocosNode>();
    const walk = (n: CocosNode): void => {
        nodes.set(n.id, n);
        if (!n.instance) n.children.forEach(walk);
    };
    roots.forEach(walk);
    return nodes;
}

export function convertPrefab(doc: CocosDocument, ctx: ConvertContext): PrefabFile {
    ctx.nodeById = indexNodes(doc.roots);
    const root = doc.roots[0];
    if (!root) throw new Error('prefab has no root node');
    const entities: PrefabEntity[] = [];
    ctx.report.documents.converted++;
    if (doc.duplicateIds) ctx.report.note('duplicate-fileid', `${ctx.where}: ${doc.duplicateIds}`);

    const walk = (n: CocosNode, parent: string | null): void => {
        ctx.report.nodes++;
        const here = `${ctx.where}: ${n.name}`;
        const entity: PrefabEntity = { prefabEntityId: n.id, name: n.name, parent, children: [], components: [], visible: true };
        entities.push(entity);
        const ref = n.instance ? ctx.prefabRef(n.instance.asset) : null;
        const overrides = n.instance && ref ? instanceOverrides(n, ctx) : null;
        if (n.instance) {
            ctx.report.prefabInstances++;
            if (ref && overrides) entity.nestedPrefab = { prefabPath: ref, overrides };
            else {
                ctx.report.note('prefab-missing', here);
                ctx.report.missingAsset(n.instance.asset);
            }
            return;
        }
        const conv = convertNode(n, ctx, here);
        entity.components = conv.components;
        if (conv.metadata) entity.metadata = conv.metadata;
        for (const c of n.children) {
            entity.children.push(c.id);
            walk(c, n.id);
        }
    };
    walk(root, null);
    // A reference to a node of this prefab is that node's prefab-local id; a prefab's refs are strings the loader maps.
    const own = new Set(entities.map((e) => e.prefabEntityId));
    for (const e of entities) resolveRefs(e.components, (id) => (own.has(id) ? id : ''), '');
    // an edit box is the engine's text field, with the style its two labels had; the labels are not written
    return { version: '2', name: doc.name, rootEntityId: root.id, entities: foldEditBoxes(entities, (e) => e.prefabEntityId) };
}

/**
 * A root pinned to the screen is stored where the engine will put it: Cocos keeps such a root at its own corner-based position, and the
 * engine's screen is centred on the origin, so the document would otherwise say one place and show another until the first frame. The
 * same function the engine aligns with places it, in the project's design box.
 */
function placeInDesign(components: ComponentData[], design: { width: number; height: number }): void {
    const anchors = components.find((c) => c.type === 'RectAnchors');
    const transform = components.find((c) => c.type === 'Transform');
    if (!anchors || !transform) return;
    const a = { ...DEFAULT_ANCHORS, ...(anchors.data as Partial<RectAnchorsData>) };
    if (!a.alignFlags || a.enabled === false) return;
    const rect = components.find((c) => c.type === 'ContentRect')?.data as { size?: { x: number; y: number }; pivot?: { x: number; y: number } } | undefined;
    const t = transform.data as { position: { x: number; y: number; z: number }; scale?: { x: number; y: number } };
    const out = anchoredRect(
        a, { left: -design.width / 2, right: design.width / 2, bottom: -design.height / 2, top: design.height / 2 },
        { width: rect?.size?.x ?? 0, height: rect?.size?.y ?? 0, pivotX: rect?.pivot?.x ?? 0.5, pivotY: rect?.pivot?.y ?? 0.5 },
        { x: t.scale?.x ?? 1, y: t.scale?.y ?? 1 }, { x: t.position.x, y: t.position.y },
    );
    t.position = { ...t.position, x: out.x, y: out.y };
    if (rect?.size) rect.size = { x: out.width, y: out.height };
}

export function convertScene(doc: CocosDocument, ctx: ConvertContext): SceneFile {
    ctx.nodeById = indexNodes(doc.roots);
    const entities: (SceneEntity | SceneInstanceEntry)[] = [];
    ctx.report.documents.converted++;
    // From 1: 0 is the engine's "no entity", and a reference to an entity numbered 0 would read as none.
    let next = 1;
    // Ids are given before any node is converted, so a reference to a node that comes later in the file has something to point at.
    const ids = new Map<string, number>();
    const assign = (n: CocosNode): void => {
        ids.set(n.id, next++);
        if (!n.instance) n.children.forEach(assign);
    };
    doc.roots.forEach(assign);
    if (doc.globals.length) ctx.report.note('scene-globals-dropped', `${ctx.where}: ${doc.globals.join(',')}`);

    const walk = (n: CocosNode, parent: SceneEntity | null): void => {
        ctx.report.nodes++;
        const id = ids.get(n.id)!;
        const here = `${ctx.where}: ${n.name}`;
        if (n.instance) {
            ctx.report.prefabInstances++;
            const ref = ctx.prefabRef(n.instance.asset);
            const overrides = ref ? instanceOverrides(n, ctx) : null;
            if (ref && overrides) {
                // Same shape the engine writes: the entry carries its parent, the parent lists the entry.
                entities.push({ id, parent: parent ? parent.id : null, prefab: ref, overrides, added: [], removed: [] });
                parent?.children.push(id);
                return;
            }
            ctx.report.note('prefab-missing', here);
            ctx.report.missingAsset(n.instance.asset);
        }
        const conv = n.instance ? { components: [] as ComponentData[] } : convertNode(n, ctx, here);
        const entity: SceneEntity = {
            id,
            name: n.name,
            parent: parent ? parent.id : null,
            children: [],
            components: conv.components,
            visible: true,
        };
        if ('metadata' in conv && conv.metadata) entity.metadata = conv.metadata;
        entities.push(entity);
        parent?.children.push(id);
        if (!n.instance) for (const c of n.children) walk(c, entity);
    };
    for (const r of doc.roots) walk(r, null);
    // 0 is the engine's "no entity"; the loader maps the rest.
    for (const e of entities) if ('components' in e) resolveRefs(e.components, (id) => ids.get(id) ?? 0, 0);
    // an edit box is the engine's text field, with the style its two labels had; the labels are not written
    const withComponents = entities.filter((e): e is SceneEntity => 'components' in e);
    const surviving = new Set<SceneEntity | SceneInstanceEntry>(foldEditBoxes(withComponents, (e) => e.id));
    const folded = entities.filter((e) => !('components' in e) || surviving.has(e));
    entities.length = 0;
    entities.push(...folded);
    if (ctx.design) for (const e of entities) if ('components' in e && e.parent === null) placeInDesign(e.components, ctx.design);
    return { version: 4, name: doc.name, entities };
}
