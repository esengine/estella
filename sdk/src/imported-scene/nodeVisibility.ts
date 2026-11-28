// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { Children, defineComponent, isBuiltinComponent, renderableComponents, type RenderableComponentDef } from '../ecs/component';
import { writeProjection } from '../ecs/componentProjection';
import { ComponentMutationReader } from '../ecs/ComponentMutationReader';
import type { World } from '../ecs/world';
import type { Entity } from '../types';

/** An authored visual gate on a subtree. Cameras, physics and gameplay stay active. */
export const NodeVisibility = defineComponent('NodeVisibility', { visible: true }, { animatableFields: ['visible'] });

type Masked = { def: RenderableComponentDef; incarnation: number; value: unknown };

/** No hierarchy walk or renderer write when the gates and scene structure are unchanged. */
export class NodeVisibilityState {
    private readonly masked = new Map<Entity, Masked[]>();
    private gates = new Map<Entity, boolean>();
    private version = -1;
    private renderers: readonly RenderableComponentDef[] | null = null;
    private mutations: ComponentMutationReader | null = null;
    private observedRenderers = new Set<RenderableComponentDef>();
    private lifetime: symbol | null = null;

    constructor(private readonly world: World) {}

    exportData(entity: Entity, component: string, data: Record<string, unknown>): void {
        const masked = this.masked.get(entity)?.find(row => row.def._name === component);
        if (masked && data[masked.def.renderableField] === false
            && this.lifetime === this.world.entityLifetime
            && this.world.getComponentIncarnation(entity, masked.def) === masked.incarnation) {
            data[masked.def.renderableField] = masked.value;
        }
    }

    update(): void {
        const { world } = this;
        const lifetime = world.entityLifetime;
        if (this.lifetime !== lifetime) {
            this.dispose();
            this.lifetime = lifetime;
            this.masked.clear();
            this.gates.clear();
            this.version = -1;
        }
        const controls = world.getEntitiesWithComponents([NodeVisibility]);
        if (controls.length === 0 && this.masked.size === 0 && this.gates.size === 0) return;
        const mutations = this.mutations;
        const batch = mutations?.read();
        const version = world.getWorldVersion();
        const renderers = renderableComponents();
        const changed = version !== this.version || controls.length !== this.gates.size || renderers !== this.renderers
            || controls.some(entity => this.gates.get(entity) !== !!world.get(entity, NodeVisibility).visible);
        if (changed) {
            this.reconcile(controls, renderers);
            this.version = world.getWorldVersion();
        }
        const candidates = changed || !batch || batch.full ? this.masked.keys() : batch.entities;
        // A renderer enabled by another animation under a hidden ancestor must
        // still stay hidden. Cores without mutation cursors read the live flags.
        for (const entity of candidates) {
            const rows = this.masked.get(entity);
            if (!rows) continue;
            if (!world.valid(entity)) { this.masked.delete(entity); continue; }
            for (const row of rows) {
                if (!world.has(entity, row.def)) continue;
                const data = world.get(entity, row.def) as Record<string, unknown>;
                if (data[row.def.renderableField] === false) continue;
                row.value = data[row.def.renderableField];
                data[row.def.renderableField] = false;
                writeProjection(world, entity, row.def, data);
            }
        }
        if (batch && mutations === this.mutations) mutations?.commit(batch);
    }

    dispose(): void {
        this.mutations?.dispose();
        this.mutations = null;
        this.observedRenderers.clear();
    }

    private reconcile(controls: readonly Entity[], renderers: readonly RenderableComponentDef[]): void {
        const { world } = this;
        if (renderers !== this.renderers) {
            for (const def of renderers) world.enableIncarnationTracking(def);
            this.renderers = renderers;
        }
        const next = new Map<Entity, boolean>();
        const stack: Entity[] = [];
        for (const entity of controls) {
            const visible = !!world.get(entity, NodeVisibility).visible;
            next.set(entity, visible);
            if (!visible) stack.push(entity);
        }
        const hidden = new Set<Entity>();
        while (stack.length) {
            const entity = stack.pop()!;
            if (hidden.has(entity) || !world.valid(entity)) continue;
            hidden.add(entity);
            if (world.has(entity, Children)) for (const child of world.get(entity, Children).entities) stack.push(child);
        }
        for (const [entity, rows] of this.masked) {
            const live = world.valid(entity) ? rows.filter(row => world.has(entity, row.def)
                && world.getComponentIncarnation(entity, row.def) === row.incarnation) : [];
            if (hidden.has(entity) && live.length) {
                this.masked.set(entity, live);
                continue;
            }
            for (const row of live) {
                const data = world.get(entity, row.def) as Record<string, unknown>;
                if (data[row.def.renderableField] !== false || row.value === false) continue;
                data[row.def.renderableField] = row.value;
                writeProjection(world, entity, row.def, data);
            }
            this.masked.delete(entity);
        }
        const maskedDefs = new Set<RenderableComponentDef>();
        for (const entity of hidden) {
            const rows = this.masked.get(entity) ?? [];
            for (const def of renderers) {
                if (!world.has(entity, def) || rows.some(row => row.def === def)) continue;
                rows.push({ def, incarnation: world.getComponentIncarnation(entity, def),
                    value: (world.get(entity, def) as Record<string, unknown>)[def.renderableField] });
            }
            for (const row of rows) maskedDefs.add(row.def);
            if (rows.length) this.masked.set(entity, rows);
        }
        const defs = [...maskedDefs];
        if (defs.length !== this.observedRenderers.size || defs.some(def => !this.observedRenderers.has(def))) {
            this.dispose();
            // Legacy scripts can mutate a stored component handle without publishing a write.
            if (defs.length && defs.every(isBuiltinComponent)) {
                this.mutations = new ComponentMutationReader(world, defs, [], []);
                this.observedRenderers = maskedDefs;
            }
        }
        this.gates = next;
    }
}
