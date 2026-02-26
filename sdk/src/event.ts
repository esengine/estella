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

export interface EventWriterDescriptor<T> {
    readonly _type: 'event_writer';
    readonly _event: EventDef<T>;
}

export interface EventReaderDescriptor<T> {
    readonly _type: 'event_reader';
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

export class EventWriterInstance<T> {
    private readonly bus_: EventBus<T>;

    constructor(bus: EventBus<T>) {
        this.bus_ = bus;
    }

    send(event: T): void {
        this.bus_.send(event);
    }
}

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
