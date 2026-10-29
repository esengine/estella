// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The Cocos compatibility layer: a script written against `cc` runs on the engine's own frame loop.
 *
 * The scripts here use real legacy decorators (this folder's tsconfig turns them on, as a Cocos project's does), and run through
 * `App` and a `World` exactly as a game's would. What is pinned is what a Cocos script relies on and nothing else could tell it
 * is wrong: the ORDER of the lifecycle, that `this.node` is the entity's node and the same object each time, that a property's
 * stored value becomes the instance's value, and that switching a node off is not destroying it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { App, flushPendingRegistrations } from '../../src/app/app';
import { AppContext, setDefaultContext } from '../../src/ecs/context';
import { getUserComponents } from '../../src/ecs/component';
import { resetClassRegistry } from '../../src/cocos/registry';
import { Component, Node, Vec3, _decorator, director, find, isValid } from '../../src/cocos';

const { ccclass, property } = _decorator;

beforeEach(() => {
    setDefaultContext(new AppContext());
    resetClassRegistry();
});

async function boot(): Promise<App> {
    const app = App.new();
    flushPendingRegistrations(app);
    return app;
}

const comp = (name: string) => getUserComponents().get(`Cocos.${name}`)!;

describe('declaring a script class', () => {
    it('makes an Estella component of it, carrying its property defaults and the enabled flag', () => {
        @ccclass('Patrol')
        class Patrol extends Component {
            @property speed = 60;
            @property label = 'hi';
            @property loop = true;
            @property(Node) target: Node | null = null;
            @property tint = new Vec3(1, 2, 3);
        }
        void Patrol;
        const def = comp('Patrol') as unknown as { _default: Record<string, unknown> } | undefined;
        expect(def).toBeDefined();
        expect(def!._default).toEqual({ enabled: true, speed: 60, label: 'hi', loop: true, target: 0, tint: { x: 1, y: 2, z: 3 } });
    });

    it('is named under a prefix, so a class named like an engine component cannot collide with it', () => {
        @ccclass('Health')
        class Health extends Component {}
        void Health;
        expect(getUserComponents().has('Cocos.Health')).toBe(true);
    });

    it('takes the class name when @ccclass is given none, and when it is applied bare', () => {
        @ccclass
        class Bare extends Component {}
        @ccclass()
        class Called extends Component {}
        void Bare; void Called;
        expect(getUserComponents().has('Cocos.Bare')).toBe(true);
        expect(getUserComponents().has('Cocos.Called')).toBe(true);
    });
});

describe('the lifecycle', () => {
    function lifecycle(events: string[]) {
        @ccclass('Life')
        class Life extends Component {
            onLoad() { events.push('onLoad'); }
            onEnable() { events.push('onEnable'); }
            start() { events.push('start'); }
            update(dt: number) { events.push(`update:${dt > 0 ? 'dt' : '0'}`); }
            lateUpdate() { events.push('lateUpdate'); }
            onDisable() { events.push('onDisable'); }
            onDestroy() { events.push('onDestroy'); }
        }
        return Life;
    }

    it('runs in the order Cocos does: onLoad, onEnable, start, then update and lateUpdate each frame', async () => {
        const events: string[] = [];
        lifecycle(events);
        const app = await boot();
        const e = app.world.spawn('life');
        app.world.insert(e, comp('Life'), { enabled: true });
        await app.tick(1 / 60);
        await app.tick(1 / 60);
        expect(events).toEqual(['onLoad', 'onEnable', 'start', 'update:dt', 'lateUpdate', 'update:dt', 'lateUpdate']);
    });

    it('ends with onDisable then onDestroy when the entity is despawned', async () => {
        const events: string[] = [];
        lifecycle(events);
        const app = await boot();
        const e = app.world.spawn('life');
        app.world.insert(e, comp('Life'), { enabled: true });
        await app.tick(1 / 60);
        events.length = 0;
        app.world.despawn(e);
        await app.tick(1 / 60);
        expect(events).toEqual(['onDisable', 'onDestroy']);
    });

    it('treats switching a node off as disabling it, not destroying it, and back on as enabling it again', async () => {
        const events: string[] = [];
        lifecycle(events);
        const app = await boot();
        const e = app.world.spawn('life');
        app.world.insert(e, comp('Life'), { enabled: true });
        await app.tick(1 / 60);
        events.length = 0;

        Node.for(app.world, e).active = false;
        await app.tick(1 / 60);
        expect(events).toEqual(['onDisable']);   // no update while off, and no onDestroy

        events.length = 0;
        Node.for(app.world, e).active = true;
        await app.tick(1 / 60);
        expect(events).toEqual(['onEnable', 'update:dt', 'lateUpdate']);   // start does not run a second time
    });

    it('does not let one script throwing stop the rest', async () => {
        const events: string[] = [];
        @ccclass('Bad')
        class Bad extends Component { update() { throw new Error('boom'); } }
        @ccclass('Good')
        class Good extends Component { update() { events.push('good'); } }
        void Bad; void Good;
        const app = await boot();
        const a = app.world.spawn('a'), b = app.world.spawn('b');
        app.world.insert(a, comp('Bad'), { enabled: true });
        app.world.insert(b, comp('Good'), { enabled: true });
        await app.tick(1 / 60);
        await app.tick(1 / 60);
        expect(events).toEqual(['good', 'good']);
    });
});

describe('this.node', () => {
    it('is the entity node, and the same object every time', async () => {
        let seen: Node | null = null;
        let again: Node | null = null;
        @ccclass('Who')
        class Who extends Component {
            onLoad() { seen = this.node; again = Node.for(this._world, this._entity); }
        }
        void Who;
        const app = await boot();
        const e = app.world.spawn('hero');
        app.world.insert(e, comp('Who'), { enabled: true });
        await app.tick(1 / 60);
        expect(seen).not.toBeNull();
        expect(seen!.name).toBe('hero');
        expect(seen).toBe(again);
    });

    it('finds a sibling component through getComponent, the same instance each time', async () => {
        const found: unknown[] = [];
        @ccclass('Other')
        class Other extends Component { @property hp = 5; }
        @ccclass('Seeker')
        class Seeker extends Component {
            start() { found.push(this.getComponent(Other), this.node.getComponent(Other), this.getComponent('Other')); }
        }
        void Seeker;
        const app = await boot();
        const e = app.world.spawn('both');
        app.world.insert(e, comp('Other'), { enabled: true, hp: 9 });
        app.world.insert(e, comp('Seeker'), { enabled: true });
        await app.tick(1 / 60);
        expect(found).toHaveLength(3);
        expect(found[0]).toBeInstanceOf(Other);
        expect((found[0] as { hp: number }).hp).toBe(9);   // the stored value, not the initializer
        expect(found[1]).toBe(found[0]);
        expect(found[2]).toBe(found[0]);
    });

    it('answers null for a component the node does not have', async () => {
        let got: unknown = 'unset';
        @ccclass('Lone')
        class Lone extends Component {
            @property x = 0;
            onLoad() { got = this.node.getComponent('Nope'); }
        }
        void Lone;
        const app = await boot();
        const e = app.world.spawn('x');
        app.world.insert(e, comp('Lone'), { enabled: true, x: 0 });
        await app.tick(1 / 60);
        expect(got).toBeNull();
    });
});

describe('properties', () => {
    it('hand the instance the stored value in the Cocos type: a Vec3 for a vector, a Node for a node reference', async () => {
        let seen: { speed?: number; dir?: unknown; target?: unknown } = {};
        @ccclass('Props')
        class Props extends Component {
            @property speed = 1;
            @property dir = new Vec3();
            @property(Node) target: Node | null = null;
            onLoad() { seen = { speed: this.speed, dir: this.dir, target: this.target }; }
        }
        void Props;
        const app = await boot();
        const other = app.world.spawn('other');
        const e = app.world.spawn('holder');
        app.world.insert(e, comp('Props'), { enabled: true, speed: 42, dir: { x: 1, y: 2, z: 3 }, target: other });
        await app.tick(1 / 60);
        expect(seen.speed).toBe(42);
        expect(seen.dir).toBeInstanceOf(Vec3);
        expect((seen.dir as Vec3).y).toBe(2);
        expect(seen.target).toBeInstanceOf(Node);
        expect((seen.target as Node).name).toBe('other');
    });

    it('declare the node-typed ones as entity references, so a scene remaps them on load', () => {
        @ccclass('Refs')
        class Refs extends Component {
            @property(Node) a: Node | null = null;
            @property([Node]) list: Node[] = [];
            @property n = 0;
        }
        void Refs;
        const def = comp('Refs') as unknown as { entityFields: string[] };
        expect([...def.entityFields].sort()).toEqual(['a', 'list']);
    });
});

describe('scheduling', () => {
    it('scheduleOnce fires once after its delay, and schedule repeats at its interval until unscheduled', async () => {
        const log: string[] = [];
        @ccclass('Timers')
        class Timers extends Component {
            start() {
                this.scheduleOnce(() => log.push('once'), 0.05);
                const tick = (): void => { log.push('tick'); if (log.filter((l) => l === 'tick').length === 3) this.unschedule(tick); };
                this.schedule(tick, 0.02);
            }
        }
        void Timers;
        const app = await boot();
        const e = app.world.spawn('t');
        app.world.insert(e, comp('Timers'), { enabled: true });
        for (let i = 0; i < 12; i++) await app.tick(0.01);
        expect(log.filter((l) => l === 'once')).toHaveLength(1);
        expect(log.filter((l) => l === 'tick')).toHaveLength(3);
    });
});

describe('director, find, isValid', () => {
    // Hierarchy and transforms live in the C++ registry, so what needs a parent is tested against the real engine (node-wasm.test.ts).
    it('find a root node by name, and report a despawned one as invalid', async () => {
        let canvas: Node | null = null;
        @ccclass('Finder')
        class Finder extends Component {
            onLoad() {
                canvas = find('Canvas');
                expect(director.getScene()!.getChildByName('Canvas')).toBe(canvas);
            }
        }
        void Finder;
        const app = await boot();
        const c = app.world.spawn('Canvas');
        const h = app.world.spawn('host');
        app.world.insert(h, comp('Finder'), { enabled: true });
        await app.tick(1 / 60);
        expect(canvas).toBe(Node.for(app.world, c));
        expect(isValid(canvas)).toBe(true);
        app.world.despawn(c);
        expect(isValid(canvas)).toBe(false);
        expect(isValid(null)).toBe(false);
    });
});
