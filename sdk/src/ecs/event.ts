// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    event.ts
 * @brief   Event system with double-buffered event buses
 */

// =============================================================================
// Event Definition
// =============================================================================

export interface EventDef<T> {
    readonly _id: symbol;
    readonly _name: string;
    readonly _phantom?: T;
}

export function defineEvent<T>(name: string): EventDef<T> {
    return {
        _id: Symbol(`Event_${name}`),
        _name: name,
    };
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
}

// =============================================================================
// Event Registry
// =============================================================================

export class EventRegistry {
    private readonly buses_ = new Map<symbol, EventBus<unknown>>();

    register<T>(event: EventDef<T>): void {
        if (!this.buses_.has(event._id)) {
            this.buses_.set(event._id, new EventBus<unknown>());
        }
    }

    getBus<T>(event: EventDef<T>): EventBus<T> {
        let bus = this.buses_.get(event._id);
        if (!bus) {
            bus = new EventBus<unknown>();
            this.buses_.set(event._id, bus);
        }
        return bus as EventBus<T>;
    }

    swapAll(): void {
        for (const bus of this.buses_.values()) {
            bus.swap();
        }
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

export function EventWriter<T>(event: EventDef<T>): EventWriterDescriptor<T> {
    return { _type: 'event_writer', _event: event };
}

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
