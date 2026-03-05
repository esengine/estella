import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PropertyWritePipeline, type PipelineHost } from '../../store/PropertyWritePipeline';
import type { EntityData } from '../../types/SceneTypes';
import type { PropertyChangeEvent } from '../../store/EditorStore';

function makeEntityData(id: number, components: { type: string; data: Record<string, unknown> }[]): EntityData {
    return {
        id,
        name: `Entity${id}`,
        parent: null,
        children: [],
        visible: true,
        components: components.map(c => ({ type: c.type, data: { ...c.data } })),
    };
}

function makeEvent(
    entity: number,
    componentType: string,
    propertyName: string,
    oldValue: unknown,
    newValue: unknown,
): PropertyChangeEvent {
    return { entity, componentType, propertyName, oldValue, newValue };
}

describe('PropertyWritePipeline', () => {
    let pipeline: PropertyWritePipeline;
    let entityMap: Map<number, EntityData>;
    let writes: { entity: number; comp: string; prop: string; value: unknown }[];

    beforeEach(() => {
        entityMap = new Map();
        writes = [];

        const host: PipelineHost = {
            getEntityData: (id) => entityMap.get(id),
            writeDirect: (entity, comp, prop, value) => {
                writes.push({ entity, comp, prop, value });
            },
        };
        pipeline = new PropertyWritePipeline(host);
    });

    describe('transform hooks', () => {
        it('runs specific property hook', () => {
            const hook = vi.fn();
            entityMap.set(1, makeEntityData(1, [{ type: 'Sprite', data: { color: 'red' } }]));

            pipeline.registerTransformHook('Sprite', 'color', hook);
            pipeline.handlePropertyNotification(makeEvent(1, 'Sprite', 'color', 'red', 'blue'));

            expect(hook).toHaveBeenCalledOnce();
        });

        it('runs wildcard hook', () => {
            const hook = vi.fn();
            entityMap.set(1, makeEntityData(1, [{ type: 'Sprite', data: {} }]));

            pipeline.registerTransformHook('Sprite', '*', hook);
            pipeline.handlePropertyNotification(makeEvent(1, 'Sprite', 'size', null, { x: 1, y: 1 }));

            expect(hook).toHaveBeenCalledOnce();
        });

        it('runs both specific and wildcard hooks', () => {
            const specific = vi.fn();
            const wildcard = vi.fn();
            entityMap.set(1, makeEntityData(1, [{ type: 'Sprite', data: {} }]));

            pipeline.registerTransformHook('Sprite', 'color', specific);
            pipeline.registerTransformHook('Sprite', '*', wildcard);
            pipeline.handlePropertyNotification(makeEvent(1, 'Sprite', 'color', 'red', 'blue'));

            expect(specific).toHaveBeenCalledOnce();
            expect(wildcard).toHaveBeenCalledOnce();
        });

        it('does not run hook for different component type', () => {
            const hook = vi.fn();
            entityMap.set(1, makeEntityData(1, [{ type: 'Transform', data: {} }]));

            pipeline.registerTransformHook('Sprite', '*', hook);
            pipeline.handlePropertyNotification(makeEvent(1, 'Transform', 'position', null, { x: 0, y: 0 }));

            expect(hook).not.toHaveBeenCalled();
        });

        it('can issue additional writes via pipeline.writeDirect', () => {
            entityMap.set(1, makeEntityData(1, [
                { type: 'TextInput', data: { backgroundColor: 'white' } },
                { type: 'Sprite', data: { color: 'white' } },
            ]));

            pipeline.registerTransformHook('TextInput', 'backgroundColor', (event, _ed, p) => {
                p.writeDirect(event.entity, 'Sprite', 'color', event.newValue);
            });

            pipeline.handlePropertyNotification(
                makeEvent(1, 'TextInput', 'backgroundColor', 'white', 'gray'),
            );

            expect(writes).toEqual([
                { entity: 1, comp: 'Sprite', prop: 'color', value: 'gray' },
            ]);
        });

        it('unsubscribes when dispose function called', () => {
            const hook = vi.fn();
            entityMap.set(1, makeEntityData(1, [{ type: 'Sprite', data: {} }]));

            const unsub = pipeline.registerTransformHook('Sprite', 'color', hook);
            unsub();

            pipeline.handlePropertyNotification(makeEvent(1, 'Sprite', 'color', 'red', 'blue'));
            expect(hook).not.toHaveBeenCalled();
        });
    });

    describe('sync hooks', () => {
        it('runs sync hooks after transform hooks', () => {
            const order: string[] = [];
            entityMap.set(1, makeEntityData(1, [{ type: 'Sprite', data: {} }]));

            pipeline.registerTransformHook('Sprite', '*', () => { order.push('transform'); });
            pipeline.registerSyncHook('Sprite', '*', () => { order.push('sync'); });

            pipeline.handlePropertyNotification(makeEvent(1, 'Sprite', 'color', 'red', 'blue'));

            expect(order).toEqual(['transform', 'sync']);
        });

        it('skips default sync when sync hook returns true', () => {
            const defaultHook = vi.fn();
            entityMap.set(1, makeEntityData(1, [{ type: 'Transform', data: {} }]));

            pipeline.registerSyncHook('Transform', '*', () => true);
            pipeline.setDefaultSyncHook(defaultHook);

            pipeline.handlePropertyNotification(
                makeEvent(1, 'Transform', 'position', { x: 0 }, { x: 1 }),
            );

            expect(defaultHook).not.toHaveBeenCalled();
        });

        it('runs default sync when no sync hook returns true', () => {
            const defaultHook = vi.fn();
            entityMap.set(1, makeEntityData(1, [{ type: 'Sprite', data: {} }]));

            pipeline.setDefaultSyncHook(defaultHook);
            pipeline.handlePropertyNotification(makeEvent(1, 'Sprite', 'color', 'red', 'blue'));

            expect(defaultHook).toHaveBeenCalledOnce();
        });

        it('runs default sync when sync hook returns void', () => {
            const defaultHook = vi.fn();
            entityMap.set(1, makeEntityData(1, [{ type: 'UIRect', data: {} }]));

            pipeline.registerSyncHook('UIRect', '*', () => { });
            pipeline.setDefaultSyncHook(defaultHook);

            pipeline.handlePropertyNotification(
                makeEvent(1, 'UIRect', 'offsetMin', { x: 0 }, { x: 1 }),
            );

            expect(defaultHook).toHaveBeenCalledOnce();
        });

        it('unsubscribes when dispose function called', () => {
            const hook = vi.fn();
            entityMap.set(1, makeEntityData(1, [{ type: 'Sprite', data: {} }]));

            const unsub = pipeline.registerSyncHook('Sprite', 'color', hook);
            unsub();

            pipeline.handlePropertyNotification(makeEvent(1, 'Sprite', 'color', 'red', 'blue'));
            expect(hook).not.toHaveBeenCalled();
        });
    });

    describe('entity data access', () => {
        it('skips notification for unknown entity', () => {
            const hook = vi.fn();
            pipeline.registerTransformHook('Sprite', '*', hook);
            pipeline.setDefaultSyncHook(hook);

            pipeline.handlePropertyNotification(makeEvent(999, 'Sprite', 'color', 'red', 'blue'));

            expect(hook).not.toHaveBeenCalled();
        });

        it('passes entityData to hooks', () => {
            const entity = makeEntityData(1, [
                { type: 'Transform', data: { position: { x: 0, y: 0 } } },
                { type: 'UIRect', data: { offsetMin: { x: 0, y: 0 } } },
            ]);
            entityMap.set(1, entity);

            pipeline.registerTransformHook('Transform', 'position', (_event, entityData) => {
                expect(entityData.components).toHaveLength(2);
                expect(entityData.components[1].type).toBe('UIRect');
            });

            pipeline.handlePropertyNotification(
                makeEvent(1, 'Transform', 'position', { x: 0, y: 0 }, { x: 1, y: 1 }),
            );
        });
    });

    describe('setDefaultSyncHook', () => {
        it('restores previous default when dispose called', () => {
            const first = vi.fn();
            const second = vi.fn();
            entityMap.set(1, makeEntityData(1, [{ type: 'Sprite', data: {} }]));

            pipeline.setDefaultSyncHook(first);
            const unsub = pipeline.setDefaultSyncHook(second);
            unsub();

            pipeline.handlePropertyNotification(makeEvent(1, 'Sprite', 'color', 'red', 'blue'));

            expect(first).toHaveBeenCalledOnce();
            expect(second).not.toHaveBeenCalled();
        });
    });
});
