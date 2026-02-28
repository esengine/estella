import { describe, it, expect, beforeEach } from 'vitest';
import {
    defineEvent,
    EventBus,
    EventRegistry,
    EventWriter,
    EventReader,
    EventWriterInstance,
    EventReaderInstance,
    EventWriterDescriptor,
    EventReaderDescriptor,
} from '../src/event';

// =============================================================================
// defineEvent
// =============================================================================

describe('defineEvent', () => {
    it('should create an event definition with unique symbol id', () => {
        const evt = defineEvent<{ x: number }>('TestEvent');
        expect(evt._name).toBe('TestEvent');
        expect(typeof evt._id).toBe('symbol');
    });

    it('should create unique ids for different events', () => {
        const a = defineEvent('A');
        const b = defineEvent('B');
        expect(a._id).not.toBe(b._id);
    });

    it('should create unique ids even for same name', () => {
        const a = defineEvent('Same');
        const b = defineEvent('Same');
        expect(a._id).not.toBe(b._id);
    });
});

// =============================================================================
// EventBus (double-buffered)
// =============================================================================

describe('EventBus', () => {
    let bus: EventBus<number>;

    beforeEach(() => {
        bus = new EventBus<number>();
    });

    it('should start with empty read buffer', () => {
        expect(bus.getReadBuffer()).toEqual([]);
    });

    it('should not expose sent events until swap', () => {
        bus.send(1);
        bus.send(2);
        expect(bus.getReadBuffer()).toEqual([]);
    });

    it('should expose sent events after swap', () => {
        bus.send(1);
        bus.send(2);
        bus.swap();
        expect(bus.getReadBuffer()).toEqual([1, 2]);
    });

    it('should clear write buffer on swap', () => {
        bus.send(1);
        bus.swap();
        bus.swap();
        expect(bus.getReadBuffer()).toEqual([]);
    });

    it('should support multiple swap cycles', () => {
        bus.send(10);
        bus.swap();
        expect(bus.getReadBuffer()).toEqual([10]);

        bus.send(20);
        bus.send(30);
        bus.swap();
        expect(bus.getReadBuffer()).toEqual([20, 30]);

        bus.swap();
        expect(bus.getReadBuffer()).toEqual([]);
    });

    it('should handle sending during read phase', () => {
        bus.send(1);
        bus.swap();

        bus.send(2);
        expect(bus.getReadBuffer()).toEqual([1]);

        bus.swap();
        expect(bus.getReadBuffer()).toEqual([2]);
    });
});

// =============================================================================
// EventRegistry
// =============================================================================

describe('EventRegistry', () => {
    let registry: EventRegistry;

    beforeEach(() => {
        registry = new EventRegistry();
    });

    it('should register and retrieve a bus', () => {
        const evt = defineEvent<string>('Msg');
        registry.register(evt);
        const bus = registry.getBus(evt);
        expect(bus).toBeInstanceOf(EventBus);
    });

    it('should return the same bus for the same event', () => {
        const evt = defineEvent<number>('Score');
        registry.register(evt);
        const bus1 = registry.getBus(evt);
        const bus2 = registry.getBus(evt);
        expect(bus1).toBe(bus2);
    });

    it('should auto-create bus on getBus if not registered', () => {
        const evt = defineEvent<number>('Auto');
        const bus = registry.getBus(evt);
        expect(bus).toBeInstanceOf(EventBus);
    });

    it('should not overwrite existing bus on duplicate register', () => {
        const evt = defineEvent<number>('Dup');
        registry.register(evt);
        const bus1 = registry.getBus(evt);
        registry.register(evt);
        const bus2 = registry.getBus(evt);
        expect(bus1).toBe(bus2);
    });

    it('should return different buses for different events', () => {
        const a = defineEvent<number>('A');
        const b = defineEvent<number>('B');
        const busA = registry.getBus(a);
        const busB = registry.getBus(b);
        expect(busA).not.toBe(busB);
    });

    it('should swap all buses at once', () => {
        const a = defineEvent<number>('A');
        const b = defineEvent<string>('B');
        const busA = registry.getBus(a);
        const busB = registry.getBus(b);

        busA.send(1);
        busB.send('hello');

        expect(busA.getReadBuffer()).toEqual([]);
        expect(busB.getReadBuffer()).toEqual([]);

        registry.swapAll();

        expect(busA.getReadBuffer()).toEqual([1]);
        expect(busB.getReadBuffer()).toEqual(['hello']);
    });
});

// =============================================================================
// Descriptors (EventWriter / EventReader factories)
// =============================================================================

describe('EventWriter descriptor', () => {
    it('should create a writer descriptor', () => {
        const evt = defineEvent<number>('Test');
        const desc: EventWriterDescriptor<number> = EventWriter(evt);
        expect(desc._type).toBe('event_writer');
        expect(desc._event).toBe(evt);
    });
});

describe('EventReader descriptor', () => {
    it('should create a reader descriptor', () => {
        const evt = defineEvent<number>('Test');
        const desc: EventReaderDescriptor<number> = EventReader(evt);
        expect(desc._type).toBe('event_reader');
        expect(desc._event).toBe(evt);
    });
});

// =============================================================================
// EventWriterInstance
// =============================================================================

describe('EventWriterInstance', () => {
    it('should send events to the underlying bus', () => {
        const bus = new EventBus<number>();
        const writer = new EventWriterInstance(bus);

        writer.send(42);
        writer.send(99);

        bus.swap();
        expect(bus.getReadBuffer()).toEqual([42, 99]);
    });
});

// =============================================================================
// EventReaderInstance
// =============================================================================

describe('EventReaderInstance', () => {
    let bus: EventBus<string>;
    let reader: EventReaderInstance<string>;

    beforeEach(() => {
        bus = new EventBus<string>();
        reader = new EventReaderInstance(bus);
    });

    it('should report isEmpty when no events', () => {
        bus.swap();
        expect(reader.isEmpty()).toBe(true);
    });

    it('should report not empty when events exist', () => {
        bus.send('a');
        bus.swap();
        expect(reader.isEmpty()).toBe(false);
    });

    it('should iterate over events', () => {
        bus.send('x');
        bus.send('y');
        bus.swap();

        const items: string[] = [];
        for (const e of reader) {
            items.push(e);
        }
        expect(items).toEqual(['x', 'y']);
    });

    it('should support spread via Symbol.iterator', () => {
        bus.send('a');
        bus.send('b');
        bus.swap();

        expect([...reader]).toEqual(['a', 'b']);
    });

    it('should return array via toArray()', () => {
        bus.send('p');
        bus.send('q');
        bus.swap();

        expect(reader.toArray()).toEqual(['p', 'q']);
    });

    it('should return empty array when no events', () => {
        bus.swap();
        expect(reader.toArray()).toEqual([]);
    });
});

// =============================================================================
// Integration: Writer -> swap -> Reader
// =============================================================================

describe('Writer -> swap -> Reader integration', () => {
    it('should pipe events from writer to reader through swap', () => {
        const evt = defineEvent<{ type: string; value: number }>('GameEvent');
        const registry = new EventRegistry();
        const bus = registry.getBus(evt);

        const writer = new EventWriterInstance(bus);
        const reader = new EventReaderInstance(bus);

        writer.send({ type: 'damage', value: 10 });
        writer.send({ type: 'heal', value: 5 });

        expect(reader.isEmpty()).toBe(true);

        registry.swapAll();

        expect(reader.isEmpty()).toBe(false);
        const events = reader.toArray();
        expect(events).toHaveLength(2);
        expect(events[0]).toEqual({ type: 'damage', value: 10 });
        expect(events[1]).toEqual({ type: 'heal', value: 5 });
    });

    it('should clear events after second swap', () => {
        const evt = defineEvent<number>('Tick');
        const registry = new EventRegistry();
        const bus = registry.getBus(evt);
        const writer = new EventWriterInstance(bus);
        const reader = new EventReaderInstance(bus);

        writer.send(1);
        registry.swapAll();
        expect(reader.toArray()).toEqual([1]);

        registry.swapAll();
        expect(reader.isEmpty()).toBe(true);
    });
});
