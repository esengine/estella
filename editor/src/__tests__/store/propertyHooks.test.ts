import { describe, it, expect, beforeEach } from 'vitest';
import { PropertyWritePipeline, type PipelineHost } from '../../store/PropertyWritePipeline';
import { registerBuiltinTransformHooks, type PropertyHookHost } from '../../store/propertyHooks';
import type { EntityData, SceneData } from '../../types/SceneTypes';
import type { PropertyChangeEvent } from '../../store/EditorStore';

function makeEntityData(
    id: number,
    components: { type: string; data: Record<string, unknown> }[],
    children: number[] = [],
): EntityData {
    return {
        id,
        name: `Entity${id}`,
        parent: null,
        children,
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

describe('registerBuiltinTransformHooks', () => {
    let pipeline: PropertyWritePipeline;
    let entityMap: Map<number, EntityData>;
    let writes: { entity: number; comp: string; prop: string; value: unknown }[];
    let scene: SceneData;

    beforeEach(() => {
        entityMap = new Map();
        writes = [];
        scene = { name: 'Test', entities: [], settings: {} } as unknown as SceneData;

        const pipelineHost: PipelineHost = {
            getEntityData: (id) => entityMap.get(id),
            writeDirect: (entity, comp, prop, value) => {
                writes.push({ entity, comp, prop, value });
            },
        };
        pipeline = new PropertyWritePipeline(pipelineHost);

        const hookHost: PropertyHookHost = {
            getEntityData: (id) => entityMap.get(id),
            get scene() { return scene; },
        };
        registerBuiltinTransformHooks(pipeline, hookHost);
    });

    describe('Transform.position → UIRect redirect', () => {
        it('redirects position delta to UIRect offsets when entity has UIRect', () => {
            entityMap.set(1, makeEntityData(1, [
                { type: 'Transform', data: { position: { x: 10, y: 20, z: 0 } } },
                { type: 'UIRect', data: {
                    offsetMin: { x: -50, y: -25 },
                    offsetMax: { x: 50, y: 25 },
                } },
            ]));

            pipeline.handlePropertyNotification(
                makeEvent(1, 'Transform', 'position',
                    { x: 10, y: 20, z: 0 },
                    { x: 15, y: 30, z: 0 },
                ),
            );

            expect(writes).toEqual([
                { entity: 1, comp: 'UIRect', prop: 'offsetMin', value: { x: -45, y: -15 } },
                { entity: 1, comp: 'UIRect', prop: 'offsetMax', value: { x: 55, y: 35 } },
            ]);
        });

        it('does not redirect when entity has no UIRect', () => {
            entityMap.set(1, makeEntityData(1, [
                { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } },
            ]));

            pipeline.handlePropertyNotification(
                makeEvent(1, 'Transform', 'position',
                    { x: 0, y: 0, z: 0 },
                    { x: 5, y: 5, z: 0 },
                ),
            );

            expect(writes).toEqual([]);
        });

        it('skips redirect when delta is zero', () => {
            entityMap.set(1, makeEntityData(1, [
                { type: 'Transform', data: { position: { x: 10, y: 20, z: 0 } } },
                { type: 'UIRect', data: {
                    offsetMin: { x: 0, y: 0 },
                    offsetMax: { x: 100, y: 100 },
                } },
            ]));

            pipeline.handlePropertyNotification(
                makeEvent(1, 'Transform', 'position',
                    { x: 10, y: 20, z: 0 },
                    { x: 10, y: 20, z: 5 },
                ),
            );

            expect(writes).toEqual([]);
        });
    });

    describe('TextInput.backgroundColor → Sprite.color', () => {
        it('syncs backgroundColor to Sprite.color', () => {
            entityMap.set(1, makeEntityData(1, [
                { type: 'TextInput', data: { backgroundColor: { r: 1, g: 1, b: 1, a: 1 } } },
                { type: 'Sprite', data: { color: { r: 1, g: 1, b: 1, a: 1 } } },
            ]));

            const newColor = { r: 0.5, g: 0.5, b: 0.5, a: 1 };
            pipeline.handlePropertyNotification(
                makeEvent(1, 'TextInput', 'backgroundColor',
                    { r: 1, g: 1, b: 1, a: 1 },
                    newColor,
                ),
            );

            expect(writes).toEqual([
                { entity: 1, comp: 'Sprite', prop: 'color', value: newColor },
            ]);
        });

        it('does not trigger for other TextInput properties', () => {
            entityMap.set(1, makeEntityData(1, [
                { type: 'TextInput', data: { text: '' } },
            ]));

            pipeline.handlePropertyNotification(
                makeEvent(1, 'TextInput', 'text', '', 'hello'),
            );

            expect(writes).toEqual([]);
        });
    });

    describe('Button → Sprite.color transition', () => {
        it('syncs button transition color to Sprite.color', () => {
            const normalColor = { r: 1, g: 1, b: 1, a: 1 };
            const hoveredColor = { r: 0.8, g: 0.8, b: 0.8, a: 1 };
            entityMap.set(1, makeEntityData(1, [
                { type: 'Button', data: {
                    state: 0,
                    transition: {
                        normalColor,
                        hoveredColor,
                        pressedColor: { r: 0.6, g: 0.6, b: 0.6, a: 1 },
                        disabledColor: { r: 0.4, g: 0.4, b: 0.4, a: 1 },
                    },
                } },
                { type: 'Sprite', data: { color: { r: 1, g: 1, b: 1, a: 1 } } },
            ]));

            pipeline.handlePropertyNotification(
                makeEvent(1, 'Button', 'state', 0, 0),
            );

            expect(writes).toHaveLength(1);
            expect(writes[0].comp).toBe('Sprite');
            expect(writes[0].prop).toBe('color');
            expect(writes[0].value).toEqual(normalColor);
        });

        it('does not write when no transition data', () => {
            entityMap.set(1, makeEntityData(1, [
                { type: 'Button', data: { state: 0, transition: null } },
                { type: 'Sprite', data: { color: { r: 1, g: 1, b: 1, a: 1 } } },
            ]));

            pipeline.handlePropertyNotification(
                makeEvent(1, 'Button', 'state', 0, 1),
            );

            expect(writes).toEqual([]);
        });

        it('does not write when no Sprite component', () => {
            entityMap.set(1, makeEntityData(1, [
                { type: 'Button', data: {
                    state: 0,
                    transition: {
                        normalColor: { r: 1, g: 1, b: 1, a: 1 },
                        hoveredColor: { r: 0.8, g: 0.8, b: 0.8, a: 1 },
                        pressedColor: { r: 0.6, g: 0.6, b: 0.6, a: 1 },
                        disabledColor: { r: 0.4, g: 0.4, b: 0.4, a: 1 },
                    },
                } },
            ]));

            pipeline.handlePropertyNotification(
                makeEvent(1, 'Button', 'state', 0, 1),
            );

            expect(writes).toEqual([]);
        });
    });

    describe('Canvas → Camera.orthoSize', () => {
        it('syncs designResolution to Camera orthoSize', () => {
            const cameraEntity = makeEntityData(2, [
                { type: 'Camera', data: { orthoSize: 540 } },
            ]);
            entityMap.set(1, makeEntityData(1, [
                { type: 'Canvas', data: { designResolution: { x: 1920, y: 1080 } } },
            ]));
            entityMap.set(2, cameraEntity);
            scene.entities = [entityMap.get(1)!, cameraEntity];

            pipeline.handlePropertyNotification(
                makeEvent(1, 'Canvas', 'designResolution',
                    { x: 1280, y: 720 },
                    { x: 1920, y: 1080 },
                ),
            );

            expect(writes).toEqual([
                { entity: 2, comp: 'Camera', prop: 'orthoSize', value: 540 },
            ]);
        });

        it('does nothing when no Camera entity exists', () => {
            entityMap.set(1, makeEntityData(1, [
                { type: 'Canvas', data: { designResolution: { x: 1920, y: 1080 } } },
            ]));
            scene.entities = [entityMap.get(1)!];

            pipeline.handlePropertyNotification(
                makeEvent(1, 'Canvas', 'designResolution',
                    { x: 1280, y: 720 },
                    { x: 1920, y: 1080 },
                ),
            );

            expect(writes).toEqual([]);
        });
    });
});
