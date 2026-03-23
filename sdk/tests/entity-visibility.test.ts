import { describe, it, expect } from 'vitest';
import { setEntityVisible, isEntityVisible, setEntityActive, isEntityActive } from '../src/entityUtils';

describe('Entity visibility helpers', () => {
    const mockWorld = () => {
        const components = new Map<string, any>();
        return {
            has: (_e: number, comp: any) => components.has(comp._name ?? comp.name),
            get: (_e: number, comp: any) => components.get(comp._name ?? comp.name),
            insert: (_e: number, comp: any, data: any) => {
                components.set(comp._name ?? comp.name, data);
            },
            remove: (_e: number, comp: any) => {
                components.delete(comp._name ?? comp.name);
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
