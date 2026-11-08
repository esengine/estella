// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { Children, defineComponent, renderableComponents, type RenderableComponentDef } from '../ecs/component';
import type { World } from '../ecs/world';
import type { Entity } from '../types';

/** An authored visual gate on a subtree. Cameras, physics and gameplay stay active. */
export const NodeVisibility = defineComponent('NodeVisibility', { visible: true }, { animatableFields: ['visible'] });

type Masked = { def: RenderableComponentDef; value: unknown };

/** No hierarchy walk or renderer write when the gates and scene structure are unchanged. */
export class NodeVisibilityState {
    readonly masked = new Map<Entity, Masked[]>();
    private gates = new Map<Entity, boolean>();
    private version = -1;

    exportData(entity: Entity, component: string, data: Record<string, unknown>): void {
        const masked = this.masked.get(entity)?.find(row => row.def._name === component);
        if (masked) data[masked.def.renderableField] = masked.value;
    }

    update(world: World): void {
        const controls = world.getEntitiesWithComponents([NodeVisibility]);
        if (controls.length === 0 && this.masked.size === 0 && this.gates.size === 0) return;
        const version = world.getWorldVersion();
        let changed = version !== this.version || controls.length !== this.gates.size;
        const next = new Map<Entity, boolean>();
        for (const entity of controls) {
            const visible = !!world.get(entity, NodeVisibility).visible;
            next.set(entity, visible);
            if (this.gates.get(entity) !== visible) changed = true;
        }
        if (changed) {
            const hidden = new Set<Entity>();
            const stack = [...next].filter(([, visible]) => !visible).map(([entity]) => entity);
            while (stack.length) {
                const entity = stack.pop()!;
                if (hidden.has(entity) || !world.valid(entity)) continue;
                hidden.add(entity);
                if (world.has(entity, Children)) stack.push(...world.get(entity, Children).entities);
            }
            for (const [entity, rows] of this.masked) {
                if (hidden.has(entity)) continue;
                if (world.valid(entity)) for (const row of rows) {
                    if (!world.has(entity, row.def)) continue;
                    const data = world.get(entity, row.def) as Record<string, unknown>;
                    data[row.def.renderableField] = row.value;
                    world.set(entity, row.def, data);
                }
                this.masked.delete(entity);
            }
            const renderers = renderableComponents();
            for (const entity of hidden) {
                const rows = this.masked.get(entity) ?? [];
                for (const def of renderers) {
                    if (!world.has(entity, def) || rows.some(row => row.def === def)) continue;
                    rows.push({ def, value: (world.get(entity, def) as Record<string, unknown>)[def.renderableField] });
                }
                if (rows.length) this.masked.set(entity, rows);
            }
            this.gates = next;
            this.version = world.getWorldVersion();
        }
        // A renderer enabled by another animation under a hidden ancestor must
        // still stay hidden. Only hidden renderers are visited on stable frames.
        for (const [entity, rows] of this.masked) {
            if (!world.valid(entity)) { this.masked.delete(entity); continue; }
            for (const row of rows) {
                if (!world.has(entity, row.def)) continue;
                const data = world.get(entity, row.def) as Record<string, unknown>;
                if (data[row.def.renderableField] === false) continue;
                row.value = data[row.def.renderableField];
                data[row.def.renderableField] = false;
                world.set(entity, row.def, data);
            }
        }
    }
}
