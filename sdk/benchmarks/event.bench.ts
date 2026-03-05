import { bench, describe } from 'vitest';
import { defineEvent, EventBus, EventRegistry, EventWriterInstance, EventReaderInstance } from '../src/event';

interface DamageEvent {
    target: number;
    amount: number;
}

const DamageEvt = defineEvent<DamageEvent>('BenchDamage');

describe('EventBus - Write', () => {
    bench('send 1000 events', () => {
        const bus = new EventBus<DamageEvent>();
        for (let i = 0; i < 1000; i++) {
            bus.send({ target: i, amount: 10 });
        }
    });
});

describe('EventBus - Read (1000 events)', () => {
    const bus = new EventBus<DamageEvent>();
    for (let i = 0; i < 1000; i++) bus.send({ target: i, amount: 10 });
    bus.swap();

    bench('iterate read buffer', () => {
        const buf = bus.getReadBuffer();
        let sum = 0;
        for (const e of buf) sum += e.amount;
    });
});

describe('EventBus - Swap', () => {
    bench('swap buffers (100 events)', () => {
        const bus = new EventBus<DamageEvent>();
        for (let i = 0; i < 100; i++) bus.send({ target: i, amount: 10 });
        bus.swap();
    });
});

describe('EventRegistry - swapAll', () => {
    const registry = new EventRegistry();
    const events = [];
    for (let i = 0; i < 20; i++) {
        const evt = defineEvent(`BenchEvt${i}`);
        registry.register(evt);
        events.push(evt);
        const bus = registry.getBus(evt);
        for (let j = 0; j < 50; j++) bus.send({ data: j });
    }

    bench('swapAll (20 buses)', () => {
        registry.swapAll();
    });
});

describe('EventWriter/Reader - Full cycle', () => {
    bench('write 100 + swap + read 100', () => {
        const registry = new EventRegistry();
        registry.register(DamageEvt);
        const writer = new EventWriterInstance(registry.getBus(DamageEvt));
        for (let i = 0; i < 100; i++) {
            writer.send({ target: i, amount: 5 });
        }
        registry.swapAll();
        const reader = new EventReaderInstance(registry.getBus(DamageEvt));
        let sum = 0;
        for (const e of reader) sum += (e as DamageEvent).amount;
    });
});
