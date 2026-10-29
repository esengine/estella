// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  `Node` against the real engine: hierarchy, transform and activity live in the C++ registry, so these run on the built
 *        wasm core and skip where there is none.
 *
 * What is pinned is what a Cocos script cannot be told is wrong: that a handle is the entity (`===`), that a position set is a
 * position got, that `setWorldPosition` under a rotated, scaled parent lands where it was asked to, and that a tree walks the
 * way `getChildByPath` and `find` say.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ESEngineModule } from '../../src/wasm';
import { World } from '../../src/ecs/world';
import { Transform, ensureBuiltinComponentsRegistered } from '../../src/ecs/component';
import { AppContext, setDefaultContext } from '../../src/ecs/context';
import { Node, Quat, Vec3, director, find, setCurrentWorld } from '../../src/cocos';
import { HAS_WASM, loadWasmModule } from '../helpers/loadWasm';

describe.skipIf(!HAS_WASM)('Node on the engine', () => {
    // After connect() both are set; the tests read them through these.
    const W = (): World => world!;
    let module: ESEngineModule;
    let registry: InstanceType<ESEngineModule['Registry']> | undefined;
    let world: World | undefined;

    beforeAll(async () => { ensureBuiltinComponentsRegistered(); module = await loadWasmModule(); });

    function connect(): void {
        setDefaultContext(new AppContext());
        registry = new module.Registry();
        world = new World();
        world.connectCpp(registry, module);
        setCurrentWorld(world);
    }
    afterEach(() => {
        setCurrentWorld(null);
        world?.disconnectCpp();
        registry?.delete();
        registry = undefined;
        world = undefined;
    });

    /** The names of nodes: comparing Node objects deeply would walk the whole world they hold. */
    const names = (nodes: Node[]): string[] => nodes.map((n) => n.name);

    /** Canvas > Panel > Button, with Canvas also holding Label. */
    function tree(): Record<'canvas' | 'panel' | 'button' | 'label', Node> {
        const mk = (name: string): Node => { const n = new Node(name); W().insert(n._entity, Transform); return n; };
        const canvas = mk('Canvas'), panel = mk('Panel'), button = mk('Button'), label = mk('Label');
        canvas.addChild(panel); canvas.addChild(label); panel.addChild(button);
        return { canvas, panel, button, label };
    }

    it('walks a hierarchy the way a script reads it', () => {
        connect();
        const { canvas, panel, button, label } = tree();
        expect(button.parent).toBe(panel);
        expect(panel.parent).toBe(canvas);
        expect(canvas.parent).toBeNull();
        expect(names(canvas.children)).toEqual(['Panel', 'Label']);
        expect(canvas.getChildByName('Panel')).toBe(panel);
        expect(canvas.getChildByName('Nope')).toBeNull();
        expect(canvas.getChildByPath('Panel/Button')).toBe(button);
        expect(button.isChildOf(canvas)).toBe(true);
        expect(canvas.isChildOf(button)).toBe(false);
    });

    it('detaches with removeFromParent, and moves with setParent', () => {
        connect();
        const { canvas, panel, button, label } = tree();
        button.removeFromParent();
        expect(button.parent).toBeNull();
        expect(panel.children).toHaveLength(0);
        button.setParent(label);
        expect(names(label.children)).toEqual(['Button']);
        expect(names(canvas.children)).toEqual(['Panel', 'Label']);
    });

    it('holds a position, a scale and a rotation as the values that were set', () => {
        connect();
        const { panel } = tree();
        panel.setPosition(10, 20, 30);
        expect(panel.position.x).toBe(10);
        expect(panel.position.y).toBe(20);
        expect(panel.position.z).toBe(30);
        panel.setPosition(new Vec3(1, 2, 3));
        expect(panel.getPosition().equals(new Vec3(1, 2, 3))).toBe(true);
        // x and y only: z stays
        panel.setPosition(7, 8);
        expect(panel.position.z).toBe(3);
        panel.setScale(2, 3);
        expect(panel.scale.x).toBe(2);
        expect(panel.scale.y).toBe(3);
        panel.setRotationFromEuler(0, 0, 90);
        expect(panel.angle).toBeCloseTo(90, 4);
        panel.angle = 45;
        expect(panel.eulerAngles.z).toBeCloseTo(45, 4);
    });

    it('reads a changed position back as a new object, so mutating it does not move the node', () => {
        connect();
        const { panel } = tree();
        panel.setPosition(5, 5, 0);
        const p = panel.position;
        p.x = 99;
        expect(panel.position.x).toBe(5);
        panel.position = p;
        expect(panel.position.x).toBe(99);
    });

    it('places a node in world space under a parent that is moved, rotated and scaled', async () => {
        connect();
        const { canvas, panel } = tree();
        canvas.setPosition(100, 50, 0);
        canvas.setRotationFromEuler(0, 0, 90);
        canvas.setScale(2, 2, 1);
        panel.setWorldPosition(new Vec3(100, 150, 0));
        const got = panel.worldPosition;
        expect(got.x).toBeCloseTo(100, 3);
        expect(got.y).toBeCloseTo(150, 3);
    });

    it('switches off with its subtree and reports it per node', () => {
        connect();
        const { canvas, panel, button } = tree();
        panel.active = false;
        expect(panel.active).toBe(false);
        expect(panel.activeInHierarchy).toBe(false);
        expect(button.active).toBe(true);              // its own switch is untouched
        expect(button.activeInHierarchy).toBe(false);  // an ancestor's takes it out
        expect(canvas.activeInHierarchy).toBe(true);
        panel.active = true;
        expect(button.activeInHierarchy).toBe(true);
    });

    it('destroys a node and reports it invalid', () => {
        connect();
        const { panel } = tree();
        expect(panel.isValid).toBe(true);
        panel.destroy();
        expect(panel.isValid).toBe(false);
        expect(panel.destroy()).toBe(false);
    });

    it('finds nodes by path from the scene roots, with find and the scene', () => {
        connect();
        const { canvas, panel, button } = tree();
        expect(find('Canvas')).toBe(canvas);
        expect(find('Canvas/Panel')).toBe(panel);
        expect(find('Canvas/Panel/Button')).toBe(button);
        expect(find('Canvas/Nope')).toBeNull();
        expect(find('Button')).toBe(button);   // a bare name searches everything
        expect(names(director.getScene()!.children)).toEqual(['Canvas']);
        expect(find('Panel/Button', canvas)).toBe(button);   // relative to a node
    });

    it('delivers an event to its listeners with the target as this, once for once, and not after off', () => {
        connect();
        const { panel } = tree();
        const log: string[] = [];
        const target = { id: 't' };
        const handler = function (this: { id: string }, arg: number): void { log.push(`${this.id}:${arg}`); };
        panel.on('custom', handler, target);
        panel.once('custom', () => log.push('once'));
        panel.emit('custom', 1);
        panel.emit('custom', 2);
        panel.off('custom', handler, target);
        panel.emit('custom', 3);
        expect(log).toEqual(['t:1', 'once', 't:2']);
    });
});

describe('Euler angles', () => {
    it('round-trip through a quaternion, using Cocos own formulas', () => {
        for (const [x, y, z] of [[0, 0, 90], [0, 0, 45], [30, 0, 0], [0, 60, 0], [20, 40, 70], [0, 0, -135]] as const) {
            const e = Quat.toEuler(new Vec3(), Quat.fromEuler(new Quat(), x, y, z));
            const back = Quat.fromEuler(new Quat(), e.x, e.y, e.z);
            const q = Quat.fromEuler(new Quat(), x, y, z);
            // the same rotation, whichever of the two equal quaternions (q and -q) came back
            const dot = Math.abs(q.x * back.x + q.y * back.y + q.z * back.z + q.w * back.w);
            expect(dot).toBeCloseTo(1, 5);
        }
    });

    it('a rotation about z alone reads back as that angle', () => {
        const e = Quat.toEuler(new Vec3(), Quat.fromEuler(new Quat(), 0, 0, 45));
        expect(e.z).toBeCloseTo(45, 4);
        expect(e.x).toBeCloseTo(0, 4);
        expect(e.y).toBeCloseTo(0, 4);
    });
});
