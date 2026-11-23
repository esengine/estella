// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Entity } from '../../types';
import { valueAtWireStep, wireStepIndex, type FieldShape, type ReplicationTable, type ReplicationTableEntry } from './codec';
import type { ReplSpawnEntity } from './protocol';

type Values = Record<string, unknown>;
type ExactRow = { mask: number; seen: Values };
interface Axis { bit: number; path: string[]; step: number }

function axesOf(shape: FieldShape, bit: number, path: string[], axes: Axis[]): void {
    if (shape.kind === 'f32' && shape.step !== undefined) axes.push({ bit, path, step: shape.step });
    if (shape.kind === 'object') {
        for (let i = 0; i < shape.keys.length; i++) axesOf(shape.shapes[i]!, bit, [...path, shape.keys[i]!], axes);
    }
}

function atPath(record: Values, path: string[]): number | undefined {
    let v: unknown = record;
    for (const key of path) v = (v as Values | null)?.[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Each field is a wire unit even when it contains several quantized axes. */
function inaccurateFields(axes: Axis[], mask: number, seen: Values, live: Values): number {
    let due = 0;
    for (const axis of axes) {
        if (!(mask & axis.bit) || (due & axis.bit)) continue;
        const old = atPath(seen, axis.path), now = atPath(live, axis.path);
        if (old === undefined || now === undefined) continue;
        const error = Math.abs(now - old);
        if (error <= axis.step / 2) continue;
        const decoded = valueAtWireStep(wireStepIndex(now, axis.step), axis.step);
        if (Math.abs(now - decoded) < error) due |= axis.bit;
    }
    return due;
}

/** An exact spawn can start on either side of the centre of a quantization cell.
 *  Index those viewers by entity so only a written component can wake them.
 *  Once a field has a binary update owed, normal delivery owns its precision. */
export class QuantizedBaselines<View> {
    private readonly layout_ = new Map<ReplicationTableEntry, { axes: Axis[]; mask: number }>();
    private readonly viewers_ = new Map<Entity, Map<View, ReadonlyMap<ReplicationTableEntry, ExactRow>>>();
    private readonly entities_ = new Map<View, Set<Entity>>();
    private readonly spawns_ = new WeakMap<ReplSpawnEntity, Map<ReplicationTableEntry, ExactRow>>();

    constructor(private readonly table_: ReplicationTable) {
        for (const te of table_.entries) {
            const axes: Axis[] = [];
            for (let i = 0; i < te.fields.length; i++) axesOf(te.shapes[i]!, 1 << i, [te.fields[i]!], axes);
            if (!axes.length) continue;
            this.layout_.set(te, { axes, mask: axes.reduce((mask, axis) => mask | axis.bit, 0) });
        }
    }

    get enabled(): boolean { return this.layout_.size !== 0; }

    mask(te: ReplicationTableEntry): number { return this.layout_.get(te)?.mask ?? 0; }

    remember(entity: Entity, view: View, spawn: ReplSpawnEntity): void {
        // Broadcast and interest entry can share one detached payload among many viewers.
        let rows = this.spawns_.get(spawn);
        if (!rows) {
            rows = new Map();
            for (const { type, data } of spawn.baseline) {
                const te = this.table_.byName.get(type)!;
                const axes = this.layout_.get(te)?.axes;
                if (!axes) continue;
                let mask = 0;
                const seen: Values = {};
                for (const axis of axes) {
                    if (mask & axis.bit) continue;
                    const v = atPath(data, axis.path);
                    if (v !== undefined && v !== valueAtWireStep(wireStepIndex(v, axis.step), axis.step)) {
                        mask |= axis.bit;
                        const field = axis.path[0]!;
                        seen[field] = data[field];
                    }
                }
                if (mask) rows.set(te, { mask, seen });
            }
            this.spawns_.set(spawn, rows);
        }
        if (!rows.size) { this.leave(entity, view); return; }
        let views = this.viewers_.get(entity);
        if (!views) { views = new Map(); this.viewers_.set(entity, views); }
        let entities = this.entities_.get(view);
        if (!entities) { entities = new Set(); this.entities_.set(view, entities); }
        entities.add(entity);
        views.set(view, rows);
    }

    sample(
        entity: Entity, te: ReplicationTableEntry, live: Values | null, shared: number,
        correct: (view: View, entity: Entity, te: ReplicationTableEntry, mask: number, seen: Values) => void,
    ): void {
        const views = this.viewers_.get(entity);
        if (!views) return;
        let last: ExactRow | undefined;
        let due = 0;
        for (const [view, components] of views) {
            const row = components.get(te);
            if (!row) continue;
            if (last !== row) {
                last = row;
                const privateMask = row.mask & ~shared;
                due = live && privateMask ? inaccurateFields(this.layout_.get(te)!.axes, privateMask, row.seen, live) : 0;
            }
            if (due) correct(view, entity, te, due, row.seen);
            const covered = live ? shared | due : -1;
            if (row.mask & covered) this.retire(entity, view, te, covered);
        }
    }

    retire(entity: Entity, view: View, te: ReplicationTableEntry, mask: number): void {
        const views = this.viewers_.get(entity);
        const components = views?.get(view);
        const row = components?.get(te);
        if (!components || !row || !(row.mask & mask)) return;
        const remaining = row.mask & ~mask;
        if (!remaining && components.size === 1) { this.leave(entity, view); return; }
        // Shared spawn templates stay immutable as individual viewers get updates.
        const next = new Map(components);
        if (remaining) next.set(te, { seen: row.seen, mask: remaining });
        else next.delete(te);
        views!.set(view, next);
    }

    coverShared(entity: Entity, te: ReplicationTableEntry, mask: number): void {
        const views = this.viewers_.get(entity);
        if (views) for (const view of views.keys()) this.retire(entity, view, te, mask);
    }

    leave(entity: Entity, view: View): void {
        const views = this.viewers_.get(entity);
        if (!views?.delete(view)) return;
        if (!views.size) this.viewers_.delete(entity);
        const entities = this.entities_.get(view)!;
        entities.delete(entity);
        if (!entities.size) this.entities_.delete(view);
    }

    despawn(entity: Entity): void {
        const views = this.viewers_.get(entity);
        if (views) for (const view of views.keys()) this.leave(entity, view);
    }

    disconnect(view: View): void {
        const entities = this.entities_.get(view);
        if (entities) for (const entity of entities) this.leave(entity, view);
    }
}
