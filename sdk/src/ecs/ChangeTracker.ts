// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ChangeTracker.ts
 * @brief   Tracks per-component add/change/remove ticks for change detection queries
 */

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
* @file    ChangeTracker.ts
* @brief   Tracks per-component add/change/remove ticks for change detection queries
*/
import type { Entity } from '../types';
import type { AnyComponentDef } from './component';

/**
 * Per-component history with per-component retention: rows exist only while a
 * reader holds the component, pruned to the LOWEST claim on it. Two of these
 * exist — removal history and membership topology — because a consumer of one
 * must not keep the other alive; the ownership rule is written once.
 *
 * A reader is a LEASE: it must advance or be disposed. Nothing prunes past a
 * parked one, deliberately — it is indistinguishable from one about to catch up
 * — so a holder that can go idle advances anyway.
 */
class ReaderOwnedJournal {
    private rows_ = new Map<symbol, Array<{ entity: Entity; tick: number; sequence?: number }>>();
    private readers_ = new Map<symbol, Map<number, number>>();
    private cursorReaders_ = new Map<symbol, Map<number, number>>();
    private sequence_ = 0;

    constructor(private readonly sequenced_ = false) {}

    hasReaders(componentId: symbol): boolean {
        return this.readers_.has(componentId) || this.cursorReaders_.has(componentId);
    }

    record(componentId: symbol, entity: Entity, tick: number): void {
        let buffer = this.rows_.get(componentId);
        if (!buffer) {
            buffer = [];
            this.rows_.set(componentId, buffer);
        }
        buffer.push(this.sequenced_ ? { entity, tick, sequence: ++this.sequence_ } : { entity, tick });
    }

    sequence(): number { return this.sequence_; }

    registerCursor(componentId: symbol, readerId: number): void {
        let readers = this.cursorReaders_.get(componentId);
        if (!readers) {
            readers = new Map();
            this.cursorReaders_.set(componentId, readers);
        }
        readers.set(readerId, this.sequence_);
    }

    sinceCursor(componentId: symbol, readerId: number): Entity[] {
        const after = this.cursorReaders_.get(componentId)?.get(readerId);
        if (after === undefined) return [];
        const rows = this.rows_.get(componentId);
        if (!rows) return [];
        // A parked reader may retain a large prefix. An up-to-date reader
        // should search past it rather than revisit every retained event.
        let lo = 0, hi = rows.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (rows[mid].sequence! <= after) lo = mid + 1;
            else hi = mid;
        }
        const out: Entity[] = [];
        for (let i = lo; i < rows.length; i++) out.push(rows[i].entity);
        return out;
    }

    advanceCursor(componentId: symbol, readerId: number, through: number): void {
        const readers = this.cursorReaders_.get(componentId);
        if (!readers?.has(readerId)) return;
        readers.set(readerId, through);
        this.prune_(componentId);
    }

    /** How many rows are buffered, at any tick. An UPPER bound on what `since`
     *  would return, in O(1) — enough for a caller choosing between reading this
     *  journal and a scan it can size, without materializing either. */
    buffered(componentId: symbol): number {
        return this.rows_.get(componentId)?.length ?? 0;
    }

    /** Rows after `sinceTick`, in the order they happened. May repeat an entity. */
    since(componentId: symbol, sinceTick: number): Entity[] {
        const buffer = this.rows_.get(componentId);
        if (!buffer) return [];
        const out: Entity[] = [];
        for (const row of buffer) if (row.tick > sinceTick) out.push(row.entity);
        return out;
    }

    register(componentId: symbol, readerId: number, retainFromTick: number): void {
        let readers = this.readers_.get(componentId);
        if (!readers) {
            readers = new Map();
            this.readers_.set(componentId, readers);
        }
        readers.set(readerId, retainFromTick);
    }

    advance(componentId: symbol, readerId: number, lastTick: number): void {
        const readers = this.readers_.get(componentId);
        if (!readers?.has(readerId)) return;
        readers.set(readerId, lastTick + 1);
        this.prune_(componentId);
    }

    dispose(componentId: symbol, readerId: number): void {
        const readers = this.readers_.get(componentId);
        readers?.delete(readerId);
        this.cursorReaders_.get(componentId)?.delete(readerId);
        this.prune_(componentId);
    }

    readerCount(componentId: symbol): number {
        return (this.readers_.get(componentId)?.size ?? 0)
            + (this.cursorReaders_.get(componentId)?.size ?? 0);
    }

    totalRows(): number {
        let n = 0;
        for (const buffer of this.rows_.values()) n += buffer.length;
        return n;
    }

    private prune_(componentId: symbol): void {
        const readers = this.readers_.get(componentId);
        const cursors = this.cursorReaders_.get(componentId);
        if (!readers?.size) this.readers_.delete(componentId);
        if (!cursors?.size) this.cursorReaders_.delete(componentId);
        if (!readers?.size && !cursors?.size) {
            this.rows_.delete(componentId);
            return;
        }
        const buffer = this.rows_.get(componentId);
        if (!buffer) return;
        let safe = Infinity;
        for (const from of readers?.values() ?? []) if (from < safe) safe = from;
        let safeSequence = Infinity;
        for (const through of cursors?.values() ?? []) {
            if (through < safeSequence) safeSequence = through;
        }
        // Both ticks and sequences are monotonic. A held prefix cannot expire
        // behind its first live row; do not copy it on every fast-reader run.
        let expired = 0;
        while (expired < buffer.length && buffer[expired].tick < safe
            && (buffer[expired].sequence ?? -Infinity) <= safeSequence) expired++;
        if (expired === buffer.length) this.rows_.delete(componentId);
        else if (expired > 0) buffer.splice(0, expired);
    }
}

interface ChangeStamp { tick: number; sequence: number; }
type ChangeRow = number | ChangeStamp;

interface ComponentSequences {
    readonly rows: Map<Entity, ChangeRow>;
    latest: number;
}

export class ChangeTracker {
    private worldTick_ = 0;
    private componentAddedTicks_ = new Map<symbol, Map<Entity, ChangeRow>>();
    private componentIncarnations_ = new Map<symbol, Map<Entity, number>>();
    private nextIncarnation_ = 1;
    private componentChangedTicks_ = new Map<symbol, Map<Entity, ChangeRow>>();
    private componentAddedSequences_ = new Map<symbol, ComponentSequences>();
    private componentChangedSequences_ = new Map<symbol, ComponentSequences>();
    private changeSequence_ = 0;
    private revision_ = 0;
    private readonly revisions_ = new Map<symbol, [number, number]>();
    private readonly removals_ = new ReaderOwnedJournal(true);
    /** Membership moves, independent of ordinary change tracking. */
    private readonly topology_ = new ReaderOwnedJournal(true);
    /**
     * Components WRITTEN, for a consumer that needs to enumerate them sparsely.
     * `isChangedSince` answers about one entity at a time; finding which entities
     * changed through it means walking the per-entity map, which is the O(E) a
     * candidate consumer is trying to avoid.
     */
    private readonly writes_ = new ReaderOwnedJournal(true);
    private trackedComponents_ = new Set<symbol>();
    // The most recent worldTick at which ANY entity changed each component — an
    // O(1) "did anything change since tick T" gate (vs scanning the per-entity map).
    private componentLastChangedTick_ = new Map<symbol, number>();
    private nextReaderId_ = 1;

    advanceTick(): void {
        this.worldTick_++;
    }

    getWorldTick(): number {
        return this.worldTick_;
    }

    enableChangeTracking(component: AnyComponentDef): void {
        this.trackedComponents_.add(component._id);
    }

    enableChangeSequenceTracking(component: AnyComponentDef, added: boolean): void {
        const sequences = added ? this.componentAddedSequences_ : this.componentChangedSequences_;
        if (sequences.has(component._id)) return;
        this.enableChangeTracking(component);
        const ticks = added ? this.componentAddedTicks_ : this.componentChangedTicks_;
        let rows = ticks.get(component._id);
        if (!rows) { rows = new Map(); ticks.set(component._id, rows); }
        const state: ComponentSequences = { rows, latest: -1 };
        sequences.set(component._id, state);
        // Share the tick map: opted-in rows gain a mutable stamp once, instead
        // of maintaining another entity index or allocating on each write.
        if (rows.size) {
            const sequence = ++this.changeSequence_;
            state.latest = sequence;
            for (const [entity, tick] of rows) rows.set(entity, { tick: tick as number, sequence });
        }
    }

    getChangeSequence(): number { return this.changeSequence_; }

    resolveChangeSequenceMatcher(component: AnyComponentDef, added: boolean): (entity: Entity, after: number) => boolean {
        this.enableChangeSequenceTracking(component, added);
        const rows = (added ? this.componentAddedSequences_ : this.componentChangedSequences_).get(component._id)!.rows;
        return (entity, after) => ((rows.get(entity) as ChangeStamp | undefined)?.sequence ?? -1) > after;
    }

    isAddedAfterSequence(entity: Entity, component: AnyComponentDef, after: number): boolean {
        return ((this.componentAddedSequences_.get(component._id)?.rows.get(entity) as ChangeStamp | undefined)?.sequence ?? -1) > after;
    }

    isChangedAfterSequence(entity: Entity, component: AnyComponentDef, after: number): boolean {
        return ((this.componentChangedSequences_.get(component._id)?.rows.get(entity) as ChangeStamp | undefined)?.sequence ?? -1) > after;
    }

    anyAddedAfterSequence(component: AnyComponentDef, after: number): boolean {
        return (this.componentAddedSequences_.get(component._id)?.latest ?? -1) > after;
    }

    anyChangedAfterSequence(component: AnyComponentDef, after: number): boolean {
        return (this.componentChangedSequences_.get(component._id)?.latest ?? -1) > after;
    }

    enableIncarnationTracking(component: AnyComponentDef): void {
        if (!this.componentIncarnations_.has(component._id)) {
            this.componentIncarnations_.set(component._id, new Map());
        }
    }

    getComponentIncarnation(entity: Entity, component: AnyComponentDef): number {
        return this.componentIncarnations_.get(component._id)?.get(entity) ?? 0;
    }

    isAddedSince(entity: Entity, component: AnyComponentDef, sinceTick: number): boolean {
        const map = this.componentAddedTicks_.get(component._id);
        if (!map) return false;
        const row = map.get(entity);
        return row !== undefined && (typeof row === 'number' ? row : row.tick) > sinceTick;
    }

    isChangedSince(entity: Entity, component: AnyComponentDef, sinceTick: number): boolean {
        const map = this.componentChangedTicks_.get(component._id);
        if (!map) return false;
        const row = map.get(entity);
        return row !== undefined && (typeof row === 'number' ? row : row.tick) > sinceTick;
    }

    /** True if ANY entity changed `component` after `sinceTick`. O(1) — reads the
     *  per-component last-changed tick, not the per-entity map. */
    anyChangedSince(component: AnyComponentDef, sinceTick: number): boolean {
        return (this.componentLastChangedTick_.get(component._id) ?? -1) > sinceTick;
    }

    getRemovedEntitiesSince(component: AnyComponentDef, sinceTick: number): Entity[] {
        return this.removals_.since(component._id, sinceTick);
    }

    /**
     * Entities whose MEMBERSHIP in `component` moved after `sinceTick` — gained
     * or lost, and deliberately not saying which. A consumer re-reads the world
     * to find out; this only says who is worth re-reading.
     */
    getTopologyChangedEntitiesSince(component: AnyComponentDef, sinceTick: number): Entity[] {
        return this.topology_.since(component._id, sinceTick);
    }

    registerMutationCursor(component: AnyComponentDef, kind: 'write' | 'topology'): number {
        const id = this.nextReaderId_++;
        this.mutationJournal_(kind).registerCursor(component._id, id);
        return id;
    }

    mutationSequence(kind: 'write' | 'topology'): number { return this.mutationJournal_(kind).sequence(); }

    mutationsForCursor(component: AnyComponentDef, kind: 'write' | 'topology', reader: number): Entity[] {
        return this.mutationJournal_(kind).sinceCursor(component._id, reader);
    }

    advanceMutationCursor(component: AnyComponentDef, kind: 'write' | 'topology', reader: number, through: number): void {
        this.mutationJournal_(kind).advanceCursor(component._id, reader, through);
    }

    disposeMutationCursor(component: AnyComponentDef, kind: 'write' | 'topology', reader: number): void {
        this.mutationJournal_(kind).dispose(component._id, reader);
    }

    private mutationJournal_(kind: 'write' | 'topology'): ReaderOwnedJournal {
        return kind === 'write' ? this.writes_ : this.topology_;
    }

    mutationRevision(component: AnyComponentDef, kind: 'write' | 'topology'): number {
        let revisions = this.revisions_.get(component._id);
        if (!revisions) { revisions = [0, 0]; this.revisions_.set(component._id, revisions); }
        return revisions[kind === 'write' ? 0 : 1];
    }

    private recordRevision_(componentId: symbol, topology: boolean): void {
        const revisions = this.revisions_.get(componentId);
        if (revisions) revisions[topology ? 1 : 0] = ++this.revision_;
    }

    registerTopologyReaderFrom(component: AnyComponentDef, retainFromTick: number): number {
        const id = this.nextReaderId_++;
        this.topology_.register(component._id, id, retainFromTick);
        return id;
    }

    advanceTopologyReader(component: AnyComponentDef, readerId: number, lastRunTick: number): void {
        this.topology_.advance(component._id, readerId, lastRunTick);
    }

    disposeTopologyReader(component: AnyComponentDef, readerId: number): void {
        this.topology_.dispose(component._id, readerId);
    }

    /** @internal How many readers hold `component`'s membership journal. */
    topologyReaderCount(component: AnyComponentDef): number {
        return this.topology_.readerCount(component._id);
    }

    /** Entities whose `component` was written after `sinceTick`. Says nothing
     *  about WHICH field, or whether the value actually differs. */
    getWrittenEntitiesSince(component: AnyComponentDef, sinceTick: number): Entity[] {
        return this.writes_.since(component._id, sinceTick);
    }

    bufferedWriteRows(component: AnyComponentDef): number {
        return this.writes_.buffered(component._id);
    }

    registerWriteReaderFrom(component: AnyComponentDef, retainFromTick: number): number {
        const id = this.nextReaderId_++;
        this.writes_.register(component._id, id, retainFromTick);
        return id;
    }

    advanceWriteReader(component: AnyComponentDef, readerId: number, lastRunTick: number): void {
        this.writes_.advance(component._id, readerId, lastRunTick);
    }

    disposeWriteReader(component: AnyComponentDef, readerId: number): void {
        this.writes_.dispose(component._id, readerId);
    }

    /** @internal How many readers hold `component`'s write journal. */
    writeReaderCount(component: AnyComponentDef): number {
        return this.writes_.readerCount(component._id);
    }

    /**
     * A tick-based claim for windows after the current tick. System queries
     * use a cursor instead, distinguishing events within the same tick.
     */
    registerRemovedReader(component: AnyComponentDef): number {
        return this.registerRemovedReaderFrom(component, this.worldTick_ + 1);
    }

    registerRemovedCursorReader(component: AnyComponentDef): number {
        const id = this.nextReaderId_++;
        this.removals_.registerCursor(component._id, id);
        return id;
    }

    getRemovalSequence(): number { return this.removals_.sequence(); }

    getRemovedEntitiesForReader(component: AnyComponentDef, readerId: number): Entity[] {
        return this.removals_.sinceCursor(component._id, readerId);
    }

    advanceRemovedCursorReader(component: AnyComponentDef, readerId: number, through: number): void {
        this.removals_.advanceCursor(component._id, readerId, through);
    }

    /**
     * A claim starting at an explicit tick, for a reader whose window is not
     * "since I last ran". A sampler that reads with a one-tick overlap must
     * claim from that same floor, or another reader's prune can take a row it
     * was always going to ask for.
     */
    registerRemovedReaderFrom(component: AnyComponentDef, retainFromTick: number): number {
        const id = this.nextReaderId_++;
        this.removals_.register(component._id, id, retainFromTick);
        return id;
    }

    /**
     * This reader has finished a run whose window ended at `lastRunTick`, so it
     * will never ask for a row at or before it again. Tick-based samplers read
     * `tick > lastRunTick`, which is why the claim is the tick after.
     */
    advanceRemovedReader(component: AnyComponentDef, readerId: number, lastRunTick: number): void {
        this.removals_.advance(component._id, readerId, lastRunTick);
    }

    /** Give up the claim, and let the watermark move at once — history with no
     *  owner is not history anyone can ask for. */
    disposeRemovedReader(component: AnyComponentDef, readerId: number): void {
        this.removals_.dispose(component._id, readerId);
    }

    /** @internal How many readers hold `component`'s history — for the fixtures
     *  that assert a disposed reader stopped pinning it. */
    removedReaderCount(component: AnyComponentDef): number {
        return this.removals_.readerCount(component._id);
    }

    recordAdded(component: AnyComponentDef, entity: Entity): void {
        this.recordRevision_(component._id, true);
        this.componentIncarnations_.get(component._id)?.set(entity, this.nextIncarnation_++);
        // BEFORE the tracking gate: a membership journal is what lets a consumer
        // follow arrivals and departures WITHOUT enrolling the component in
        // ordinary change tracking, and paying that tax on every field write.
        if (this.topology_.hasReaders(component._id)) {
            this.topology_.record(component._id, entity, this.worldTick_);
        }
        if (!this.trackedComponents_.has(component._id)) return;
        const sequences = this.componentAddedSequences_.get(component._id);
        if (sequences) {
            this.recordSequence_(sequences, entity);
            return;
        }
        let map = this.componentAddedTicks_.get(component._id);
        if (!map) {
            map = new Map();
            this.componentAddedTicks_.set(component._id, map);
        }
        map.set(entity, this.worldTick_);
    }

    /**
     * Whether anything is asking about this component's changes. `recordChanged`
     * self-gates on the same answer; this exists so a caller marking a whole
     * query's worth of entities can ask ONCE instead of per entity.
     */
    isTracked(component: AnyComponentDef): boolean {
        return this.trackedComponents_.has(component._id);
    }

    recordChanged(component: AnyComponentDef, entity: Entity): void {
        this.recordRevision_(component._id, false);
        // Before the tracking gate, like the other two journals: a consumer that
        // enumerates writes should not have to enrol the component in `Changed`
        // tracking, whose per-entity map it cannot enumerate cheaply anyway.
        if (this.writes_.hasReaders(component._id)) {
            this.writes_.record(component._id, entity, this.worldTick_);
        }
        if (!this.trackedComponents_.has(component._id)) return;
        const sequences = this.componentChangedSequences_.get(component._id);
        if (sequences) {
            this.recordSequence_(sequences, entity);
            this.componentLastChangedTick_.set(component._id, this.worldTick_);
            return;
        }
        let map = this.componentChangedTicks_.get(component._id);
        if (!map) {
            map = new Map();
            this.componentChangedTicks_.set(component._id, map);
        }
        map.set(entity, this.worldTick_);
        this.componentLastChangedTick_.set(component._id, this.worldTick_);
    }

    private recordSequence_(state: ComponentSequences, entity: Entity): void {
        const sequence = ++this.changeSequence_;
        state.latest = sequence;
        const row = state.rows.get(entity) as ChangeStamp | undefined;
        if (row) { row.tick = this.worldTick_; row.sequence = sequence; }
        else state.rows.set(entity, { tick: this.worldTick_, sequence });
    }

    recordRemoved(component: AnyComponentDef, entity: Entity): void {
        this.recordRemovedById(component._id, entity);
    }

    /**
     * The gate lives here rather than in each caller: despawn reaches script
     * components through this id-only entry point and builtins through
     * recordRemoved, and when only the latter checked, the same despawn was
     * recorded for one kind and dropped for the other.
     */
    recordRemovedById(componentId: symbol, entity: Entity): void {
        this.recordRevision_(componentId, true);
        this.componentIncarnations_.get(componentId)?.delete(entity);
        // Same reason as `recordAdded`: first, and gated on its own readers.
        if (this.topology_.hasReaders(componentId)) {
            this.topology_.record(componentId, entity, this.worldTick_);
        }
        // A row is stored only for a component someone reads history of. With
        // `Changed(C)` alone this is the whole difference between a buffer that
        // grows with every despawn for the life of the world, and none at all.
        if (this.removals_.hasReaders(componentId)) {
            this.removals_.record(componentId, entity, this.worldTick_);
        }
        if (!this.trackedComponents_.has(componentId)) return;
        this.componentAddedTicks_.get(componentId)?.delete(entity);
        this.componentChangedTicks_.get(componentId)?.delete(entity);
        // Losing a component IS a change to it. Without this, `anyChangedSince`
        // — which reads only this watermark — says nothing happened, and a
        // consumer that gates work on it never learns the component is gone.
        // The UI layout did exactly that: removing a FlexContainer left its
        // padding and justification laying the node out for the rest of the run.
        this.componentLastChangedTick_.set(componentId, this.worldTick_);
    }

    /**
     * @internal Live map sizes for the resource census.
     *
     * `removedRows` is bounded by what registered readers still owe: rows exist
     * only while a `Removed` reader holds the component, and are pruned to the
     * lowest claim whenever one advances or goes away.
     */
    sizes(): { tracked: number; addedRows: number; changedRows: number; removedRows: number; sequenceRows: number } {
        const rowsIn = (maps: Map<symbol, Map<Entity, ChangeRow>>): number => {
            let n = 0;
            for (const m of maps.values()) n += m.size;
            return n;
        };
        const removedRows = this.removals_.totalRows();
        let sequenceRows = 0;
        for (const state of this.componentAddedSequences_.values()) sequenceRows += state.rows.size;
        for (const state of this.componentChangedSequences_.values()) sequenceRows += state.rows.size;
        return {
            tracked: this.trackedComponents_.size,
            addedRows: rowsIn(this.componentAddedTicks_),
            changedRows: rowsIn(this.componentChangedTicks_),
            removedRows,
            sequenceRows,
        };
    }
}
