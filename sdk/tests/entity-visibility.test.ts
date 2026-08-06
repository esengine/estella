// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { setEntityVisible, isEntityVisible, hasVisibility, setEntityActive, isEntityActive } from '../src/ecs/entityUtils';
import { UIDisplay } from '../src/ui/core/ui-node';

describe('Entity visibility helpers', () => {
    const mockWorld = () => {
        const components = new Map<string, any>();
        const key = (comp: any) => comp._name ?? comp.name;
        return {
            has: (_e: number, comp: any) => components.has(key(comp)),
            get: (_e: number, comp: any) => components.get(key(comp)),
            set: (_e: number, comp: any, data: any) => {
                components.set(key(comp), data);
            },
            insert: (_e: number, comp: any, data: any) => {
                components.set(key(comp), data);
            },
            remove: (_e: number, comp: any) => {
                components.delete(key(comp));
            },
            _components: components,
        } as any;
    };

    describe('setEntityVisible / isEntityVisible', () => {
        it('should hide sprite rendering', () => {
            const world = mockWorld();
            world._components.set('Sprite', { enabled: true, color: { r: 1, g: 1, b: 1, a: 1 } });

            setEntityVisible(world, 1 as any, false);
            expect(world._components.get('Sprite').enabled).toBe(false);
        });

        it('should show sprite rendering', () => {
            const world = mockWorld();
            world._components.set('Sprite', { enabled: false, color: { r: 1, g: 1, b: 1, a: 1 } });

            setEntityVisible(world, 1 as any, true);
            expect(world._components.get('Sprite').enabled).toBe(true);
        });

        it('should report visible state from sprite', () => {
            const world = mockWorld();
            world._components.set('Sprite', { enabled: true });

            expect(isEntityVisible(world, 1 as any)).toBe(true);

            world._components.get('Sprite').enabled = false;
            expect(isEntityVisible(world, 1 as any)).toBe(false);
        });

        it('should handle entity without sprite', () => {
            const world = mockWorld();
            expect(isEntityVisible(world, 1 as any)).toBe(true);
        });

        // These three used to be silent no-ops: the helper knew only Sprite,
        // ShapeRenderer and BitmapText, while the scene manager's sleep/wake kept
        // the real list. Hiding a Spine armature simply did nothing.
        it.each(['SpineAnimation', 'ParticleEmitter', 'UIVisual'])('hides a %s', (comp) => {
            const world = mockWorld();
            world._components.set(comp, { enabled: true });

            expect(isEntityVisible(world, 1 as any)).toBe(true);
            setEntityVisible(world, 1 as any, false);
            expect(world._components.get(comp).enabled).toBe(false);
            expect(isEntityVisible(world, 1 as any)).toBe(false);
        });

        it('hides every renderer the entity carries', () => {
            const world = mockWorld();
            world._components.set('Sprite', { enabled: true });
            world._components.set('BitmapText', { enabled: true });

            setEntityVisible(world, 1 as any, false);
            expect(world._components.get('Sprite').enabled).toBe(false);
            expect(world._components.get('BitmapText').enabled).toBe(false);
        });

        // A UI node hides through `display`, which the layout pass resolves down
        // the tree — hiding a panel has to hide what is inside it.
        it('hides a UI node through display, not its own visual', () => {
            const world = mockWorld();
            world._components.set('UINode', { display: UIDisplay.Flex });
            world._components.set('UIVisual', { enabled: true });

            setEntityVisible(world, 1 as any, false);
            expect(world._components.get('UINode').display).toBe(UIDisplay.None);
            expect(world._components.get('UIVisual').enabled).toBe(true); // untouched
            expect(isEntityVisible(world, 1 as any)).toBe(false);

            setEntityVisible(world, 1 as any, true);
            expect(world._components.get('UINode').display).toBe(UIDisplay.Flex);
            expect(isEntityVisible(world, 1 as any)).toBe(true);
        });
    });

    describe('hasVisibility', () => {
        it('is false for a bare transform and true once something draws', () => {
            const world = mockWorld();
            expect(hasVisibility(world, 1 as any)).toBe(false);

            world._components.set('ShapeRenderer', { enabled: true });
            expect(hasVisibility(world, 1 as any)).toBe(true);
        });

        it('is true for a UI node with no visual of its own', () => {
            const world = mockWorld();
            world._components.set('UINode', { display: UIDisplay.Flex });
            expect(hasVisibility(world, 1 as any)).toBe(true);
        });
    });

    describe('setEntityActive / isEntityActive', () => {
        it('should deactivate entity', () => {
            const world = mockWorld();

            setEntityActive(world, 1 as any, false);
            expect(isEntityActive(world, 1 as any)).toBe(false);
        });

        it('should activate entity', () => {
            const world = mockWorld();
            world._components.set('Disabled', {});

            setEntityActive(world, 1 as any, true);
            expect(isEntityActive(world, 1 as any)).toBe(true);
        });
    });
});
