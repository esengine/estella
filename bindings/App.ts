/**
 * @file    App.ts
 * @brief   Type-safe ECS Application wrapper for TypeScript
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

import type {
    ESEngineModule,
    Registry,
    NativeApp,
    EntityVector,
    Entity,
    LocalTransform as ILocalTransform,
    WorldTransform as IWorldTransform,
    Sprite as ISprite,
    Camera as ICamera,
    Canvas as ICanvas,
    Velocity as IVelocity,
    Parent as IParent,
    Children as IChildren
} from './esengine';

// =============================================================================
// Component Classes
// =============================================================================

export class LocalTransform {
    static readonly componentName = 'LocalTransform';
    position = { x: 0, y: 0, z: 0 };
    rotation = { w: 1, x: 0, y: 0, z: 0 };
    scale = { x: 1, y: 1, z: 1 };
}

export class WorldTransform {
    static readonly componentName = 'WorldTransform';
    matrix: number[] = [];
    position = { x: 0, y: 0, z: 0 };
    rotation = { w: 1, x: 0, y: 0, z: 0 };
    scale = { x: 1, y: 1, z: 1 };
}

export class Sprite {
    static readonly componentName = 'Sprite';
    texture = 0;
    color = { x: 1, y: 1, z: 1, w: 1 };
    size = { x: 32, y: 32 };
    uvOffset = { x: 0, y: 0 };
    uvScale = { x: 1, y: 1 };
    layer = 0;
    flipX = false;
    flipY = false;
}

export class Camera {
    static readonly componentName = 'Camera';
    projectionType = 0;
    fov = 60;
    orthoSize = 5;
    nearPlane = 0.1;
    farPlane = 1000;
    aspectRatio = 1.77;
    isActive = true;
    priority = 0;
}

export class Canvas {
    static readonly componentName = 'Canvas';
    designResolution = { x: 1920, y: 1080 };
    pixelsPerUnit = 100;
    scaleMode = 0;
    matchWidthOrHeight = 0.5;
    backgroundColor = { x: 0, y: 0, z: 0, w: 1 };
}

export class Velocity {
    static readonly componentName = 'Velocity';
    linear = { x: 0, y: 0, z: 0 };
    angular = { x: 0, y: 0, z: 0 };
}

export class Parent {
    static readonly componentName = 'Parent';
    entity = 0;
}

export class Children {
    static readonly componentName = 'Children';
    entities: Entity[] = [];
}

// =============================================================================
// Component Type Utilities
// =============================================================================

type ComponentClass<T = unknown> = {
    new(): T;
    readonly componentName: string;
};

type InstanceOf<T> = T extends ComponentClass<infer I> ? I : never;

type ComponentInstances<T extends ComponentClass[]> = {
    [K in keyof T]: InstanceOf<T[K]>;
};

// =============================================================================
// Schedule
// =============================================================================

export enum Schedule {
    Startup = 0,
    PreUpdate = 1,
    Update = 2,
    PostUpdate = 3,
    PreRender = 4,
    Render = 5,
    PostRender = 6,
}

// =============================================================================
// Time
// =============================================================================

export interface Time {
    readonly delta: number;
    readonly elapsed: number;
    readonly frameCount: number;
}

// =============================================================================
// Query
// =============================================================================

export class Query<T extends ComponentClass[]> {
    private readonly module_: ESEngineModule;
    private readonly registry_: Registry;
    private readonly components_: T;

    constructor(module: ESEngineModule, registry: Registry, components: T) {
        this.module_ = module;
        this.registry_ = registry;
        this.components_ = components;
    }

    *[Symbol.iterator](): Iterator<[Entity, ...ComponentInstances<T>]> {
        const entities = this.getEntities();

        for (const entity of entities) {
            const components = this.components_.map(C =>
                this.getComponent(entity, C.componentName)
            ) as ComponentInstances<T>;
            yield [entity, ...components];
        }
    }

    forEach(callback: (entity: Entity, ...components: ComponentInstances<T>) => void): void {
        for (const [entity, ...components] of this) {
            callback(entity, ...components);
        }
    }

    single(): [Entity, ...ComponentInstances<T>] | null {
        for (const result of this) {
            return result;
        }
        return null;
    }

    isEmpty(): boolean {
        return this.single() === null;
    }

    private getEntities(): Entity[] {
        const names = this.components_.map(C => C.componentName).join('');
        const queryName = `query${names}`;
        const queryFn = this.module_[queryName] as
            ((registry: Registry) => EntityVector) | undefined;

        if (typeof queryFn === 'function') {
            const entityVector = queryFn(this.registry_);
            const result: Entity[] = [];
            const size = entityVector.size();
            for (let i = 0; i < size; i++) {
                result.push(entityVector.get(i));
            }
            return result;
        }
        return [];
    }

    private getComponent(entity: Entity, name: string): unknown {
        const getter = `get${name}`;
        const getterFn = this.registry_[getter] as (entity: Entity) => unknown;
        return getterFn.call(this.registry_, entity);
    }
}

// =============================================================================
// Resources
// =============================================================================

export class Res<T> {
    constructor(private readonly value_: T) {}

    get(): T {
        return this.value_;
    }
}

export class ResMut<T> {
    constructor(private value_: T) {}

    get(): T {
        return this.value_;
    }

    set(value: T): void {
        this.value_ = value;
    }
}

// =============================================================================
// Entity Builder
// =============================================================================

export class EntityBuilder {
    private readonly registry_: Registry;
    private readonly entity_: Entity;

    constructor(registry: Registry) {
        this.registry_ = registry;
        this.entity_ = registry.create();
    }

    with<T extends ComponentClass>(Component: T, data: Partial<InstanceOf<T>>): this {
        const name = Component.componentName;
        const defaults = new Component();
        const component = Object.assign({}, defaults, data);
        const adder = `add${name}`;
        const addFn = this.registry_[adder] as (entity: Entity, component: unknown) => void;
        addFn.call(this.registry_, this.entity_, component);
        return this;
    }

    id(): Entity {
        return this.entity_;
    }
}

// =============================================================================
// Commands
// =============================================================================

export class Commands {
    private readonly registry_: Registry;
    private readonly pendingDespawns_: Entity[] = [];

    constructor(registry: Registry) {
        this.registry_ = registry;
    }

    spawn(): EntityBuilder {
        return new EntityBuilder(this.registry_);
    }

    despawn(entity: Entity): void {
        this.pendingDespawns_.push(entity);
    }

    insert<T extends ComponentClass>(entity: Entity, Component: T, data: Partial<InstanceOf<T>>): void {
        const name = Component.componentName;
        const defaults = new Component();
        const component = Object.assign({}, defaults, data);
        const adder = `add${name}`;
        const addFn = this.registry_[adder] as (entity: Entity, component: unknown) => void;
        addFn.call(this.registry_, entity, component);
    }

    remove<T extends ComponentClass>(entity: Entity, Component: T): void {
        const name = Component.componentName;
        const remover = `remove${name}`;
        const removeFn = this.registry_[remover] as (entity: Entity) => void;
        removeFn.call(this.registry_, entity);
    }

    has<T extends ComponentClass>(entity: Entity, Component: T): boolean {
        const name = Component.componentName;
        const checker = `has${name}`;
        const hasFn = this.registry_[checker] as (entity: Entity) => boolean;
        return hasFn.call(this.registry_, entity);
    }

    get<T extends ComponentClass>(entity: Entity, Component: T): InstanceOf<T> {
        const name = Component.componentName;
        const getter = `get${name}`;
        const getFn = this.registry_[getter] as (entity: Entity) => InstanceOf<T>;
        return getFn.call(this.registry_, entity);
    }

    flush(): void {
        for (const entity of this.pendingDespawns_) {
            this.registry_.destroy(entity);
        }
        this.pendingDespawns_.length = 0;
    }
}

// =============================================================================
// World
// =============================================================================

export class World {
    private readonly module_: ESEngineModule;
    private readonly registry_: Registry;

    constructor(module: ESEngineModule, registry: Registry) {
        this.module_ = module;
        this.registry_ = registry;
    }

    query<T extends ComponentClass[]>(...components: T): Query<T> {
        return new Query(this.module_, this.registry_, components);
    }

    spawn(): EntityBuilder {
        return new EntityBuilder(this.registry_);
    }

    commands(): Commands {
        return new Commands(this.registry_);
    }

    get<T extends ComponentClass>(entity: Entity, Component: T): InstanceOf<T> {
        const name = Component.componentName;
        const getter = `get${name}`;
        const getFn = this.registry_[getter] as (entity: Entity) => InstanceOf<T>;
        return getFn.call(this.registry_, entity);
    }

    has<T extends ComponentClass>(entity: Entity, Component: T): boolean {
        const name = Component.componentName;
        const checker = `has${name}`;
        const hasFn = this.registry_[checker] as (entity: Entity) => boolean;
        return hasFn.call(this.registry_, entity);
    }
}

// =============================================================================
// System Types
// =============================================================================

export type SystemFn = (world: World, time: Time) => void;

export abstract class System {
    protected world_!: World;
    protected time_!: Time;

    onStart?(): void;
    onUpdate?(): void;
    onDestroy?(): void;

    /** @internal */
    _bind(world: World, time: Time): void {
        this.world_ = world;
        this.time_ = time;
    }
}

export abstract class StartupSystem extends System {
    abstract onStart(): void;
}

export abstract class UpdateSystem extends System {
    abstract onUpdate(): void;
}

// =============================================================================
// App Config
// =============================================================================

export interface AppConfig {
    title?: string;
    width?: number;
    height?: number;
    vsync?: boolean;
}

// =============================================================================
// App
// =============================================================================

interface ModuleWithCallback extends ESEngineModule {
    _esRunJSSystems?: (schedule: number, dt: number) => void;
}

type SystemEntry = SystemFn | System;

export class App {
    private readonly module_: ESEngineModule;
    private readonly cppApp_: NativeApp;
    private readonly systems_ = new Map<Schedule, SystemEntry[]>();
    private readonly systemInstances_: System[] = [];
    private readonly resources_ = new Map<string, unknown>();

    constructor(module: ESEngineModule, config?: AppConfig) {
        this.module_ = module;

        if (config) {
            const cppConfig = new module.AppConfig();
            if (config.title) cppConfig.title = config.title;
            if (config.width) cppConfig.width = config.width;
            if (config.height) cppConfig.height = config.height;
            if (config.vsync !== undefined) cppConfig.vsync = config.vsync;
            this.cppApp_ = module.createAppWithConfig(cppConfig);
        } else {
            this.cppApp_ = module.createApp();
        }

        for (let i = 0; i <= Schedule.PostRender; i++) {
            this.systems_.set(i as Schedule, []);
        }

        (module as ModuleWithCallback)._esRunJSSystems = (schedule: number) => {
            this.runSystems(schedule as Schedule);
        };
    }

    addSystem(schedule: Schedule, system: SystemFn | System): this {
        const systems = this.systems_.get(schedule);
        if (systems) {
            systems.push(system);
            if (system instanceof System) {
                this.systemInstances_.push(system);
            }
        }
        return this;
    }

    addStartupSystem(system: SystemFn | StartupSystem): this {
        return this.addSystem(Schedule.Startup, system);
    }

    addUpdateSystem(system: SystemFn | UpdateSystem): this {
        return this.addSystem(Schedule.Update, system);
    }

    insertResource<T>(name: string, value: T): this {
        this.resources_.set(name, value);
        return this;
    }

    getResource<T>(name: string): T | undefined {
        return this.resources_.get(name) as T | undefined;
    }

    run(): void {
        this.cppApp_.run();
    }

    quit(): void {
        this.cppApp_.quit();
    }

    world(): World {
        return new World(this.module_, this.cppApp_.registry());
    }

    time(): Time {
        return this.cppApp_.time();
    }

    width(): number {
        return this.cppApp_.width();
    }

    height(): number {
        return this.cppApp_.height();
    }

    private runSystems(schedule: Schedule): void {
        const systems = this.systems_.get(schedule);
        if (!systems) return;

        const world = this.world();
        const time = this.time();

        for (const system of systems) {
            if (typeof system === 'function') {
                system(world, time);
            } else {
                system._bind(world, time);
                if (schedule === Schedule.Startup && system.onStart) {
                    system.onStart();
                } else if (system.onUpdate) {
                    system.onUpdate();
                }
            }
        }
    }
}

// =============================================================================
// Factory
// =============================================================================

export function createApp(module: ESEngineModule, config?: AppConfig): App {
    return new App(module, config);
}
