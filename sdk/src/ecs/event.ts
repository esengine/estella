// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    event.ts
 * @brief   Event system with double-buffered event buses
 */

// =============================================================================
// Event Definition
// =============================================================================

/**
 * An event type, as {@link defineEvent} returns it. Opaque — pass it to
 * {@link EventWriter} / {@link EventReader} rather than reading it.
 *
 * @public
 */
export interface EventDef<T> {
    /** @internal */
    readonly _id: symbol;
    /** @internal */
    readonly _name: string;
    /**
     * The payload's fields, as a value rather than as an erased type — the same
     * thing `defineComponent` and `defineResource` carry, and for the same
     * reason: a mechanism that has to know this shape can ask.
     *
     * @internal
     */
    readonly _default?: object;
    /** @internal */
    readonly _phantom?: T;
}

/**
 * Declare an event type. The bus is double-buffered: an event sent this frame is
 * readable for exactly the next one, so a reader that misses a frame misses the
 * event — events are for this-frame signalling, not a queue.
 *
 * `payload` is a default of the shape `T`, the way a component declares its
 * fields. Optional, and needed only where a `@compiled` system reads or writes
 * the event: `T` is erased at run time, so without it nothing on this side can
 * say what layout the compiled code baked in. The compiler asks for it by name
 * and line when a promise depends on it.
 *
 * @public
 */
export function defineEvent<T>(name: string, payload?: T & object): EventDef<T> {
    const def: EventDef<T> = {
        _id: eventId(name),
        _name: name,
        ...(payload === undefined ? {} : { _default: payload as object }),
    };
    byName.set(name, def as EventDef<unknown>);
    return def;
}

// Interned by NAME, like component and resource identity. A manifest addresses
// an event by name, so a fresh symbol per call made the two doors disagree: a
// hot reload's systems wrote to a bus nothing resolving by name could reach.
const eventIdRegistry = new Map<string, symbol>();
function eventId(name: string): symbol {
    let id = eventIdRegistry.get(name);
    if (id === undefined) {
        id = Symbol(`Event_${name}`);
        eventIdRegistry.set(name, id);
    }
    return id;
}

const byName = new Map<string, EventDef<unknown>>();

/**
 * The event a manifest's NAME refers to, or undefined when nothing declared it.
 *
 * @internal
 */
export function eventNamed(name: string): EventDef<unknown> | undefined {
    return byName.get(name);
}

/**
 * The payload's fields as compiled code reads them: one entry per leaf, dotted,
 * in declaration order. Undefined where the event was declared without a
 * payload — which is "cannot say", never "no fields".
 *
 * @internal
 */
export function eventFieldsOf(name: string): readonly string[] | undefined {
    const shape = byName.get(name)?._default;
    if (shape === undefined) return undefined;
    const out: string[] = [];
    const walk = (value: object, prefix: string): void => {
        for (const [key, at] of Object.entries(value)) {
            const path = prefix ? `${prefix}.${key}` : key;
            if (at !== null && typeof at === 'object') walk(at as object, path);
            else out.push(path);
        }
    };
    walk(shape, '');
    return out;
}

// =============================================================================
// Event Bus (double-buffered)
// =============================================================================

export class EventBus<T> {
    private readBuffer_: T[] = [];
    private writeBuffer_: T[] = [];

    send(event: T): void {
        this.writeBuffer_.push(event);
    }

    getReadBuffer(): readonly T[] {
        return this.readBuffer_;
    }

    swap(): void {
        const tmp = this.readBuffer_;
        this.readBuffer_ = this.writeBuffer_;
        this.writeBuffer_ = tmp;
        this.writeBuffer_.length = 0;
    }

    /** @internal How much has been written since the last swap — a speculation
     *  takes this before it runs and un-writes back to it if it is abandoned. */
    writeMark(): number {
        return this.writeBuffer_.length;
    }

    /** @internal */
    rewindWrite(mark: number): void {
        if (mark < this.writeBuffer_.length) this.writeBuffer_.length = mark;
    }

    /** @internal Payloads written past `mark`, oldest first, as text. */
    writtenSince(mark: number): string[] {
        return this.writeBuffer_.slice(mark).map((e) => JSON.stringify(e) ?? 'undefined');
    }
}

// =============================================================================
// Event Registry
// =============================================================================

export class EventRegistry {
    private readonly buses_ = new Map<symbol, EventBus<unknown>>();
    /**
     * By NAME as well, because a compiled module's manifest carries names —
     * it cannot know a runtime's symbols. Registered when a bus is first made,
     * which is when a system asks for a reader or a writer.
     */
    private readonly byName_ = new Map<string, EventBus<unknown>>();

    register<T>(event: EventDef<T>): void {
        if (!this.buses_.has(event._id)) this.make_(event);
    }

    getBus<T>(event: EventDef<T>): EventBus<T> {
        const bus = this.buses_.get(event._id) ?? this.make_(event);
        return bus as EventBus<T>;
    }

    /** The bus a manifest's name refers to, or undefined if nothing made one. */
    busNamed(name: string): EventBus<unknown> | undefined {
        return this.byName_.get(name);
    }

    private make_<T>(event: EventDef<T>): EventBus<unknown> {
        const bus = new EventBus<unknown>();
        this.buses_.set(event._id, bus);
        if (event._name) this.byName_.set(event._name, bus);
        return bus;
    }

    swapAll(): void {
        for (const bus of this.buses_.values()) {
            bus.swap();
        }
    }

    /** @internal Where every bus's write half stands right now. */
    writeMarks(): Map<symbol, number> {
        const marks = new Map<symbol, number>();
        for (const [id, bus] of this.buses_) marks.set(id, bus.writeMark());
        return marks;
    }

    /** @internal Un-write back to `marks`. A bus made DURING the speculation is
     *  absent from them, so it rewinds to empty rather than being left alone. */
    rewindWrites(marks: Map<symbol, number>): void {
        for (const [id, bus] of this.buses_) bus.rewindWrite(marks.get(id) ?? 0);
    }

    /** @internal What has been written since `marks`, as comparable text: a
     *  replay asks whether the same step announces the same things. */
    writtenSince(marks: Map<symbol, number>): string {
        const out: string[] = [];
        for (const [id, bus] of this.buses_) {
            const from = marks.get(id) ?? 0;
            const wrote = bus.writtenSince(from);
            if (wrote.length > 0) out.push(`${String(id.description ?? id.toString())}:${wrote.join(',')}`);
        }
        return out.sort().join('|');
    }
}

// =============================================================================
// System Parameter Descriptors
// =============================================================================

/**
 * A request for send access to an event in a system's parameter list, as
 * {@link EventWriter} returns it. Opaque — the body receives the instance.
 *
 * @public
 */
export interface EventWriterDescriptor<T> {
    /** @internal */
    readonly _type: 'event_writer';
    /** @internal */
    readonly _event: EventDef<T>;
}

/**
 * A request for receive access to an event, as {@link EventReader} returns it.
 * Each reader keeps its own cursor, so two systems both see every event.
 *
 * @public
 */
export interface EventReaderDescriptor<T> {
    /** @internal */
    readonly _type: 'event_reader';
    /** @internal */
    readonly _event: EventDef<T>;
}

/**
 * Ask a system for send access to an event. The body receives an
 * {@link EventWriterInstance}; what it sends is readable next frame.
 *
 * @public
 */
export function EventWriter<T>(event: EventDef<T>): EventWriterDescriptor<T> {
    return { _type: 'event_writer', _event: event };
}

/**
 * Ask a system for receive access to an event. Each declaring system keeps its
 * own cursor, so two readers both see every event rather than consuming it from
 * each other.
 *
 * @public
 */
export function EventReader<T>(event: EventDef<T>): EventReaderDescriptor<T> {
    return { _type: 'event_reader', _event: event };
}

// =============================================================================
// Runtime Instances
// =============================================================================

/**
 * The send end of an event, as {@link EventWriter} asked for. What is sent this
 * frame is what every reader sees next, so sending is not a call into them.
 *
 * @public
 */
export class EventWriterInstance<T> {
    private readonly bus_: EventBus<T>;

    constructor(bus: EventBus<T>) {
        this.bus_ = bus;
    }

    send(event: T): void {
        this.bus_.send(event);
    }
}

/**
 * The events sent since this system last ran, as {@link EventReader} asked for.
 * Reading does not consume: every reader of an event sees the whole frame's
 * worth, and the buffer turns over on its own.
 *
 * @public
 */
export class EventReaderInstance<T> implements Iterable<T> {
    private readonly bus_: EventBus<T>;

    constructor(bus: EventBus<T>) {
        this.bus_ = bus;
    }

    *[Symbol.iterator](): Iterator<T> {
        yield* this.bus_.getReadBuffer();
    }

    isEmpty(): boolean {
        return this.bus_.getReadBuffer().length === 0;
    }

    toArray(): T[] {
        return [...this.bus_.getReadBuffer()];
    }
}
