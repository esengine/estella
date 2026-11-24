// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AotEvents.ts
 * @brief   A frame's payloads, as memory a compiled system can walk.
 *
 * @details An event is a JS object on a bus, and compiled code reads addresses.
 *          So each payload this frame is flattened into a block laid out in the
 *          order the manifest declares — the same order the code reads at — and
 *          the reader is handed one row per payload.
 *
 *          Sending is the same trade backwards: the code appended numbers, and
 *          the object is rebuilt from that field list before it goes on the bus.
 */
import { POOL_SLOT_BYTES, type PoolBlock, type PoolMemory } from '../ScriptPool';
import { disposeAll } from '../../util/disposeAll';
import { hasOwn, setOwn } from '../../util/ownProperties';

/** What the runtime knows about an event by NAME; a manifest carries names. */
export interface EventBusAccess {
    (name: string): {
        read(): readonly unknown[];
        send(payload: unknown): void;
    } | undefined;
}

export class AotEvents {
    private readonly blocks: PoolBlock[] = [];
    private disposed = false;

    dispose(): void {
        this.disposed = true;
        this.release();
    }

    constructor(private readonly memory: PoolMemory, private readonly bus: EventBusAccess) {}

    /**
     * One row per payload: `[entity, address]`, where the entity is zero because
     * nothing carries an event. The blocks live until `release`, which is the
     * end of the call — the same lifetime the row array has.
     */
    rowsFor(event: string, fields: readonly string[]): (readonly number[])[] {
        if (this.disposed) throw new Error('AotEvents is disposed');
        const payloads = this.bus(event)?.read() ?? [];
        const rows: number[][] = [];
        for (const payload of payloads) {
            const values = fields.map(path => numberAt(payload, path));
            if (this.disposed) return [];
            const block = this.memory.alloc(Math.max(POOL_SLOT_BYTES, fields.length * POOL_SLOT_BYTES));
            this.blocks.push(block);
            const buffer = this.memory.current?.(block) ?? block.buffer;
            const view = new Float64Array(buffer, block.byteOffset, fields.length);
            view.set(values);
            rows.push([0, block.byteOffset]);
        }
        return rows;
    }

    /** Rebuild one payload from the fields the code wrote, and put it on the bus. */
    send(event: string, fields: readonly string[], values: readonly number[]): void {
        if (this.disposed) throw new Error('AotEvents is disposed');
        const target = this.bus(event);
        if (!target) return;
        const payload: Record<string, unknown> = {};
        fields.forEach((path, i) => { assignAt(payload, path, values[i] ?? 0); });
        target.send(payload);
    }

    /** Blocks before this position belong to an enclosing synchronous call. */
    beginCall(): number { return this.blocks.length; }

    /** Release the blocks acquired by this call. Disposal releases them all. */
    release(from = 0): void {
        const blocks = this.blocks.splice(from);
        disposeAll(blocks, block => this.memory.release(block));
    }
}

/** A dotted path read off a payload; a field it does not carry reads as 0. */
function numberAt(payload: unknown, path: string): number {
    let at: unknown = payload;
    for (const part of path.split('.')) {
        if (at === null || typeof at !== 'object' || !hasOwn(at, part)) return 0;
        at = (at as Record<string, unknown>)[part];
    }
    return typeof at === 'boolean' ? (at ? 1 : 0) : (typeof at === 'number' ? at : 0);
}

/** The same path, written back — nested objects are created as needed. */
function assignAt(payload: Record<string, unknown>, path: string, value: number): void {
    const parts = path.split('.');
    let at = payload;
    for (const part of parts.slice(0, -1)) {
        if (!hasOwn(at, part) || typeof at[part] !== 'object' || at[part] === null) setOwn(at, part, {});
        at = at[part] as Record<string, unknown>;
    }
    setOwn(at, parts[parts.length - 1]!, value);
}
