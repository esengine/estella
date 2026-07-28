// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/widgets/toPrefab.ts
 * @brief   widgetToPrefab — turn an imperative widget builder into PrefabData.
 *
 * The widget factories (createButton, createSlider, …) are the single source of
 * a control's structure + default styling. Running one against a lightweight
 * recording World captures its spawn/insert/setParent calls as plain data, which
 * `extractPrefab` serialises into a shippable `.esprefab`. So the editor gets a
 * drop-in, themed control asset generated from the exact same code the runtime
 * uses — no hand-authored duplicate to drift.
 */
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { extractPrefab, type ExtractEntity } from '../../prefab/sceneInstance';
import type { PrefabData, ComponentData } from '../../prefab/types';

interface RecEntity {
    id: number;
    parent: number | null;
    children: number[];
    components: ComponentData[];
}

/** Minimal World stand-in: records the tree a builder constructs, no C++/wasm. */
class RecordingWorld {
    private next = 0;
    readonly entities = new Map<number, RecEntity>();

    spawn(): number {
        const id = this.next++;
        this.entities.set(id, { id, parent: null, children: [], components: [] });
        return id;
    }

    insert(entity: number, comp: { _name: string; transient?: boolean }, data: unknown): void {
        const ent = this.entities.get(entity);
        if (!ent) return;
        if (comp.transient) return; // runtime-only state never persists into a prefab
        const clone = JSON.parse(JSON.stringify(data)) as unknown;
        const existing = ent.components.find((c) => c.type === comp._name);
        if (existing) existing.data = clone as ComponentData['data'];
        else ent.components.push({ type: comp._name, data: clone as ComponentData['data'] });
    }

    setParent(child: number, parent: number): void {
        const c = this.entities.get(child);
        if (!c) return;
        if (c.parent !== null) {
            const old = this.entities.get(c.parent);
            if (old) old.children = old.children.filter((x) => x !== child);
        }
        c.parent = parent;
        const p = this.entities.get(parent);
        if (p && !p.children.includes(child)) p.children.push(child);
    }

    get(entity: number, comp: { _name: string }): unknown {
        return this.entities.get(entity)?.components.find((c) => c.type === comp._name)?.data;
    }

    has(entity: number, comp: { _name: string }): boolean {
        return this.entities.get(entity)?.components.some((c) => c.type === comp._name) ?? false;
    }

    valid(entity: number): boolean {
        return this.entities.has(entity);
    }

    remove(entity: number, comp: { _name: string }): void {
        const ent = this.entities.get(entity);
        if (ent) ent.components = ent.components.filter((c) => c.type !== comp._name);
    }
}

/** Name a captured entity for the outliner: root → widget name; a text node → Label. */
function entityName(ent: RecEntity, rootId: number, widgetName: string): string {
    if (ent.id === rootId) return widgetName;
    return ent.components.some((c) => c.type === 'Text') ? 'Label' : 'Node';
}

/**
 * Run `build` against a recording World and serialise the resulting subtree to a
 * PrefabData named `name`. `build` returns the root entity (as the factories do).
 */
export function widgetToPrefab(build: (world: World) => Entity, name: string): PrefabData {
    const world = new RecordingWorld();
    const root = build(world as unknown as World) as unknown as number;

    // Only the root's subtree — a node parented outside it (e.g. a popup on the
    // canvas) would otherwise become a stray second root in the prefab.
    const subtree = new Set<number>();
    const stack = [root];
    while (stack.length) {
        const id = stack.pop()!;
        if (subtree.has(id)) continue;
        subtree.add(id);
        stack.push(...(world.entities.get(id)?.children ?? []));
    }

    const entities: ExtractEntity[] = [...subtree].map((id) => {
        const e = world.entities.get(id)!;
        return {
            id: e.id,
            name: entityName(e, root, name),
            parent: e.parent,
            children: e.children.filter((c) => subtree.has(c)),
            components: e.components,
            visible: true,
        };
    });
    // Deterministic sequential ids ('0','1',…) — these prefabs are committed
    // codegen output, so their identities must be byte-stable across runs (a
    // UUID default would drift the generated `.esprefab` files every build).
    let n = 0;
    return extractPrefab(entities, root, name, () => String(n++));
}
