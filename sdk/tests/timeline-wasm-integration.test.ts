/**
 * Integration tests: Timeline property animation applied to real WASM-backed components.
 *
 * Requires pre-built WASM at desktop/public/wasm/esengine.wasm.
 * Run `node build-tools/cli.js build -t web` first if missing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { World } from '../src/world';
import { Transform, Children, Name, getComponent } from '../src/component';
import { UIRect, type UIRectData } from '../src/ui/UIRect';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule } from './helpers/loadWasm';
import {
    WrapMode,
    TrackType,
    type TimelineAsset,
    type PropertyTrack,
} from '../src/timeline/TimelineTypes';
import { TimelineInstance, advanceTimeline } from '../src/timeline/TimelineSystem';
import { setNestedProperty } from '../src/timeline/propertyUtils';

const WASM_PATH = resolve(__dirname, '../../desktop/public/wasm/esengine.wasm');
const HAS_WASM = existsSync(WASM_PATH);

function createPositionAsset(duration: number): TimelineAsset {
    return {
        version: '1.0',
        type: 'timeline',
        duration,
        wrapMode: WrapMode.Loop,
        tracks: [
            {
                type: TrackType.Property,
                name: 'MoveX',
                childPath: '',
                component: 'Transform',
                channels: [
                    {
                        property: 'position.x',
                        keyframes: [
                            { time: 0, value: 0, inTangent: 0, outTangent: 0 },
                            { time: duration, value: 100, inTangent: 0, outTangent: 0 },
                        ],
                    },
                    {
                        property: 'position.y',
                        keyframes: [
                            { time: 0, value: 0, inTangent: 0, outTangent: 0 },
                            { time: duration, value: 200, inTangent: 0, outTangent: 0 },
                        ],
                    },
                ],
            } as PropertyTrack,
        ],
    };
}

function createChildPositionAsset(duration: number): TimelineAsset {
    return {
        version: '1.0',
        type: 'timeline',
        duration,
        wrapMode: WrapMode.Once,
        tracks: [
            {
                type: TrackType.Property,
                name: 'MoveChild',
                childPath: 'Title',
                component: 'Transform',
                channels: [
                    {
                        property: 'position.x',
                        keyframes: [
                            { time: 0, value: 10, inTangent: 0, outTangent: 0 },
                            { time: duration, value: 300, inTangent: 0, outTangent: 0 },
                        ],
                    },
                ],
            } as PropertyTrack,
        ],
    };
}

function redirectPositionToUIRect(world: World, entity: number, posValues: Map<string, number>): void {
    const currentTransform = world.get(entity, Transform);
    const currentPos = currentTransform.position;
    const rect = world.get(entity, UIRect) as UIRectData;

    const dx = (posValues.has('position.x') ? posValues.get('position.x')! : currentPos.x) - currentPos.x;
    const dy = (posValues.has('position.y') ? posValues.get('position.y')! : currentPos.y) - currentPos.y;

    if (dx === 0 && dy === 0) return;

    world.set(entity, UIRect, {
        ...rect,
        offsetMin: { x: rect.offsetMin.x + dx, y: rect.offsetMin.y + dy },
        offsetMax: { x: rect.offsetMax.x + dx, y: rect.offsetMax.y + dy },
    });
}

function applyPropertyTrackResults(world: World, rootEntity: number, instance: TimelineInstance): void {
    const results = instance.evaluatePropertyTracks();
    for (const result of results) {
        const targetEntity = resolveChildEntity(world, rootEntity, result.childPath);
        if (targetEntity == null) continue;

        const componentDef = getComponent(result.component);
        if (!componentDef) continue;
        if (!world.has(targetEntity, componentDef)) continue;

        if (result.component === 'Transform' && world.has(targetEntity, UIRect)) {
            const posValues = new Map<string, number>();
            const nonPosValues = new Map<string, number>();
            for (const [propPath, value] of result.values) {
                if (propPath.startsWith('position.')) {
                    posValues.set(propPath, value);
                } else {
                    nonPosValues.set(propPath, value);
                }
            }

            if (posValues.size > 0) {
                redirectPositionToUIRect(world, targetEntity, posValues);
            }

            if (nonPosValues.size > 0) {
                const data = world.get(targetEntity, componentDef);
                let modified = false;
                for (const [propPath, value] of nonPosValues) {
                    if (setNestedProperty(data as Record<string, any>, propPath, value)) {
                        modified = true;
                    }
                }
                if (modified) {
                    world.set(targetEntity, componentDef, data);
                }
            }
            continue;
        }

        const data = world.get(targetEntity, componentDef);
        let modified = false;
        for (const [propPath, value] of result.values) {
            if (setNestedProperty(data as Record<string, any>, propPath, value)) {
                modified = true;
            }
        }

        if (modified) {
            world.set(targetEntity, componentDef, data);
        }
    }
}

function resolveChildEntity(world: World, rootEntity: number, childPath: string): number | null {
    if (!childPath) return rootEntity;

    const parts = childPath.split('/');
    let current = rootEntity;
    for (const part of parts) {
        const childrenData = world.tryGet(current, Children);
        const childEntities = childrenData?.entities
            ? Array.from(childrenData.entities as Iterable<any>)
            : [];
        if (childEntities.length === 0) return null;
        let found = false;
        for (const child of childEntities) {
            const nameData = world.tryGet(child, Name);
            if (nameData?.value === part) {
                current = child;
                found = true;
                break;
            }
        }
        if (!found) return null;
    }
    return current;
}

describe.skipIf(!HAS_WASM)('Timeline WASM Integration', () => {
    let module: ESEngineModule;

    beforeAll(async () => {
        module = await loadWasmModule();
    });

    function createWorld(): { world: World; registry: CppRegistry } {
        const registry = new module.Registry() as unknown as CppRegistry;
        const world = new World();
        world.connectCpp(registry, module);
        return { world, registry };
    }

    function disposeWorld(world: World, registry: CppRegistry): void {
        for (const e of world.getAllEntities()) {
            try { world.despawn(e); } catch (_) {}
        }
        world.disconnectCpp();
        (registry as any).delete();
    }

    describe('world.set updates C++ Transform', () => {
        it('should update position.x via world.set', () => {
            const { world, registry } = createWorld();
            const entity = world.spawn();
            world.insert(entity, Transform);

            const before = world.get(entity, Transform);
            expect(before.position.x).toBe(0);

            const data = world.get(entity, Transform);
            data.position.x = 42;
            world.set(entity, Transform, data);

            const after = world.get(entity, Transform);
            expect(after.position.x).toBeCloseTo(42, 5);

            disposeWorld(world, registry);
        });

        it('should update position via setNestedProperty + world.set', () => {
            const { world, registry } = createWorld();
            const entity = world.spawn();
            world.insert(entity, Transform);

            const data = world.get(entity, Transform) as Record<string, any>;
            setNestedProperty(data, 'position.x', 99);
            setNestedProperty(data, 'position.y', 55);
            world.set(entity, Transform, data as any);

            const after = world.get(entity, Transform);
            expect(after.position.x).toBeCloseTo(99, 5);
            expect(after.position.y).toBeCloseTo(55, 5);

            disposeWorld(world, registry);
        });

        it('should update position via world.insert on existing component', () => {
            const { world, registry } = createWorld();
            const entity = world.spawn();
            world.insert(entity, Transform);

            const data = world.get(entity, Transform) as Record<string, any>;
            setNestedProperty(data, 'position.x', 77);
            world.insert(entity, Transform, data as any);

            const after = world.get(entity, Transform);
            expect(after.position.x).toBeCloseTo(77, 5);

            disposeWorld(world, registry);
        });
    });

    describe('getComponent resolves Transform', () => {
        it('should return Transform def from getComponent("Transform")', () => {
            const def = getComponent('Transform');
            expect(def).toBeDefined();
            expect(def!._name).toBe('Transform');
        });
    });

    describe('timeline applies position to root entity', () => {
        it('should move entity via timeline property track', () => {
            const { world, registry } = createWorld();
            const entity = world.spawn();
            world.insert(entity, Transform);

            const asset = createPositionAsset(2.0);
            const instance = new TimelineInstance(asset);
            instance.play();

            advanceTimeline(instance, 1.0);
            applyPropertyTrackResults(world, entity, instance);

            const t = world.get(entity, Transform);
            expect(t.position.x).toBeCloseTo(50, 0);
            expect(t.position.y).toBeCloseTo(100, 0);

            disposeWorld(world, registry);
        });

        it('should animate over multiple frames', () => {
            const { world, registry } = createWorld();
            const entity = world.spawn();
            world.insert(entity, Transform);

            const asset = createPositionAsset(1.0);
            const instance = new TimelineInstance(asset);
            instance.play();

            const positions: number[] = [];
            for (let i = 0; i < 10; i++) {
                advanceTimeline(instance, 0.1);
                applyPropertyTrackResults(world, entity, instance);
                const t = world.get(entity, Transform);
                positions.push(t.position.x);
            }

            for (let i = 1; i < positions.length; i++) {
                expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1]);
            }
            expect(positions[positions.length - 1]).toBeCloseTo(100, 0);

            disposeWorld(world, registry);
        });
    });

    describe('UIRect entities redirect position to offsets', () => {
        it('should modify UIRect offsets instead of Transform.position for UIRect entities', () => {
            const { world, registry } = createWorld();
            const entity = world.spawn();
            world.insert(entity, Transform);
            world.insert(entity, UIRect, {
                anchorMin: { x: 0.5, y: 0.5 },
                anchorMax: { x: 0.5, y: 0.5 },
                offsetMin: { x: 0, y: 0 },
                offsetMax: { x: 0, y: 0 },
                size: { x: 100, y: 100 },
                pivot: { x: 0.5, y: 0.5 },
            });

            const initialRect = world.get(entity, UIRect) as UIRectData;
            expect(initialRect.offsetMin.x).toBe(0);

            const asset = createPositionAsset(1.0);
            const instance = new TimelineInstance(asset);
            instance.play();

            advanceTimeline(instance, 0.5);
            applyPropertyTrackResults(world, entity, instance);

            const rect = world.get(entity, UIRect) as UIRectData;
            expect(rect.offsetMin.x).toBeCloseTo(50, 0);
            expect(rect.offsetMin.y).toBeCloseTo(100, 0);
            expect(rect.offsetMax.x).toBeCloseTo(50, 0);
            expect(rect.offsetMax.y).toBeCloseTo(100, 0);

            disposeWorld(world, registry);
        });

        it('should apply non-position properties directly for UIRect entities', () => {
            const { world, registry } = createWorld();
            const entity = world.spawn();
            world.insert(entity, Transform);
            world.insert(entity, UIRect);

            const asset: TimelineAsset = {
                version: '1.0',
                type: 'timeline',
                duration: 1,
                wrapMode: WrapMode.Once,
                tracks: [{
                    type: TrackType.Property,
                    name: 'ScaleX',
                    childPath: '',
                    component: 'Transform',
                    channels: [{
                        property: 'scale.x',
                        keyframes: [
                            { time: 0, value: 1, inTangent: 0, outTangent: 0 },
                            { time: 1, value: 2, inTangent: 0, outTangent: 0 },
                        ],
                    }],
                } as PropertyTrack],
            };
            const instance = new TimelineInstance(asset);
            instance.play();

            advanceTimeline(instance, 0.5);
            applyPropertyTrackResults(world, entity, instance);

            const t = world.get(entity, Transform);
            expect(t.scale.x).toBeCloseTo(1.5, 1);

            disposeWorld(world, registry);
        });

        it('should not modify UIRect for entities without UIRect', () => {
            const { world, registry } = createWorld();
            const entity = world.spawn();
            world.insert(entity, Transform);

            const asset = createPositionAsset(1.0);
            const instance = new TimelineInstance(asset);
            instance.play();

            advanceTimeline(instance, 0.5);
            applyPropertyTrackResults(world, entity, instance);

            const t = world.get(entity, Transform);
            expect(t.position.x).toBeCloseTo(50, 0);
            expect(t.position.y).toBeCloseTo(100, 0);

            disposeWorld(world, registry);
        });
    });

    describe('timeline applies position to child entity', () => {
        it('should resolve child by name and update transform', () => {
            const { world, registry } = createWorld();
            const root = world.spawn();
            world.insert(root, Transform);
            world.insert(root, Name, { value: 'Root' });

            const child = world.spawn();
            world.insert(child, Transform);
            world.insert(child, Name, { value: 'Title' });
            world.setParent(child, root);

            const asset = createChildPositionAsset(1.0);
            const instance = new TimelineInstance(asset);
            instance.play();

            advanceTimeline(instance, 0.5);
            applyPropertyTrackResults(world, root, instance);

            const t = world.get(child, Transform);
            expect(t.position.x).toBeCloseTo(155, 0);

            disposeWorld(world, registry);
        });
    });
});
