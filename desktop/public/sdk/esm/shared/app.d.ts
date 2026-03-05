import { C as Color, V as Vec2, a as Entity, b as Vec3, Q as Quat, c as CppRegistry, E as ESEngineModule, d as Vec4, T as TextureHandle, F as FontHandle } from './wasm.js';

/**
 * @file    component.ts
 * @brief   Component definition and builtin components
 */

interface ComponentDef<T> {
    readonly _id: symbol;
    readonly _name: string;
    readonly _default: T;
    readonly _builtin: false;
    create(data?: Partial<T>): T;
}
declare function defineComponent<T extends object>(name: string, defaults: T): ComponentDef<T>;
declare function defineTag(name: string): ComponentDef<{}>;
declare function getUserComponent(name: string): ComponentDef<any> | undefined;
declare function clearUserComponents(): void;
declare function unregisterComponent(name: string): void;
interface BuiltinComponentDef<T> {
    readonly _id: symbol;
    readonly _name: string;
    readonly _cppName: string;
    readonly _builtin: true;
    readonly _default: T;
    readonly _colorKeys: readonly string[];
}
type AnyComponentDef = ComponentDef<any> | BuiltinComponentDef<any>;
declare function isBuiltinComponent(comp: AnyComponentDef): comp is BuiltinComponentDef<any>;
declare function registerComponent(name: string, def: AnyComponentDef): void;
declare function getComponent(name: string): AnyComponentDef | undefined;
declare const ProjectionType: {
    readonly Perspective: 0;
    readonly Orthographic: 1;
};
type ProjectionType = (typeof ProjectionType)[keyof typeof ProjectionType];
declare const ClearFlags: {
    readonly None: 0;
    readonly ColorOnly: 1;
    readonly DepthOnly: 2;
    readonly ColorAndDepth: 3;
};
type ClearFlags = (typeof ClearFlags)[keyof typeof ClearFlags];
declare const ScaleMode: {
    readonly FixedWidth: 0;
    readonly FixedHeight: 1;
    readonly Expand: 2;
    readonly Shrink: 3;
    readonly Match: 4;
};
type ScaleMode = (typeof ScaleMode)[keyof typeof ScaleMode];
interface TransformData {
    position: Vec3;
    rotation: Quat;
    scale: Vec3;
    worldPosition: Vec3;
    worldRotation: Quat;
    worldScale: Vec3;
}
type LocalTransformData = TransformData;
type WorldTransformData = TransformData;
interface SpriteData {
    texture: number;
    color: Color;
    size: Vec2;
    uvOffset: Vec2;
    uvScale: Vec2;
    layer: number;
    flipX: boolean;
    flipY: boolean;
    material: number;
    enabled: boolean;
}
declare const ShapeType: {
    readonly Circle: 0;
    readonly Capsule: 1;
    readonly RoundedRect: 2;
};
type ShapeType = (typeof ShapeType)[keyof typeof ShapeType];
interface ShapeRendererData {
    shapeType: number;
    color: Color;
    size: Vec2;
    cornerRadius: number;
    layer: number;
    enabled: boolean;
}
interface CameraData {
    projectionType: number;
    fov: number;
    orthoSize: number;
    nearPlane: number;
    farPlane: number;
    aspectRatio: number;
    isActive: boolean;
    priority: number;
    /** Editor-only: not synced to C++ Camera component, used for gizmo rendering */
    showFrustum: boolean;
    viewportX: number;
    viewportY: number;
    viewportW: number;
    viewportH: number;
    clearFlags: number;
}
interface CanvasData {
    designResolution: Vec2;
    pixelsPerUnit: number;
    scaleMode: number;
    matchWidthOrHeight: number;
    backgroundColor: Color;
}
interface VelocityData {
    linear: Vec3;
    angular: Vec3;
}
interface ParentData {
    entity: Entity;
}
interface ChildrenData {
    entities: Entity[];
}
interface SpineAnimationData {
    skeletonPath: string;
    atlasPath: string;
    skin: string;
    animation: string;
    timeScale: number;
    loop: boolean;
    playing: boolean;
    flipX: boolean;
    flipY: boolean;
    color: Color;
    layer: number;
    skeletonScale: number;
    material: number;
    enabled: boolean;
}
interface BitmapTextData {
    text: string;
    color: Color;
    fontSize: number;
    align: number;
    spacing: number;
    layer: number;
    font: number;
    enabled: boolean;
}
interface NameData {
    value: string;
}
interface SceneOwnerData {
    scene: string;
    persistent: boolean;
}
declare const Transform: BuiltinComponentDef<TransformData>;
declare const LocalTransform: BuiltinComponentDef<TransformData>;
declare const WorldTransform: BuiltinComponentDef<TransformData>;
declare const Sprite: BuiltinComponentDef<SpriteData>;
declare const ShapeRenderer: BuiltinComponentDef<ShapeRendererData>;
declare const Camera: BuiltinComponentDef<CameraData>;
declare const Canvas: BuiltinComponentDef<CanvasData>;
declare const Velocity: BuiltinComponentDef<VelocityData>;
declare const Parent: BuiltinComponentDef<ParentData>;
declare const Children: BuiltinComponentDef<ChildrenData>;
declare const BitmapText: BuiltinComponentDef<BitmapTextData>;
declare const SpineAnimation: BuiltinComponentDef<SpineAnimationData>;
declare const EmitterShape: {
    readonly Point: 0;
    readonly Circle: 1;
    readonly Rectangle: 2;
    readonly Cone: 3;
};
type EmitterShape = (typeof EmitterShape)[keyof typeof EmitterShape];
declare const SimulationSpace: {
    readonly World: 0;
    readonly Local: 1;
};
type SimulationSpace = (typeof SimulationSpace)[keyof typeof SimulationSpace];
declare const ParticleEasing: {
    readonly Linear: 0;
    readonly EaseIn: 1;
    readonly EaseOut: 2;
    readonly EaseInOut: 3;
};
type ParticleEasing = (typeof ParticleEasing)[keyof typeof ParticleEasing];
interface ParticleEmitterData {
    rate: number;
    burstCount: number;
    burstInterval: number;
    duration: number;
    looping: boolean;
    playOnStart: boolean;
    maxParticles: number;
    lifetimeMin: number;
    lifetimeMax: number;
    shape: number;
    shapeRadius: number;
    shapeSize: Vec2;
    shapeAngle: number;
    speedMin: number;
    speedMax: number;
    angleSpreadMin: number;
    angleSpreadMax: number;
    startSizeMin: number;
    startSizeMax: number;
    endSizeMin: number;
    endSizeMax: number;
    sizeEasing: number;
    startColor: Color;
    endColor: Color;
    colorEasing: number;
    rotationMin: number;
    rotationMax: number;
    angularVelocityMin: number;
    angularVelocityMax: number;
    gravity: Vec2;
    damping: number;
    texture: number;
    spriteColumns: number;
    spriteRows: number;
    spriteFPS: number;
    spriteLoop: boolean;
    blendMode: number;
    layer: number;
    material: number;
    simulationSpace: number;
    enabled: boolean;
}
declare const ParticleEmitter: BuiltinComponentDef<ParticleEmitterData>;
declare const Name: ComponentDef<NameData>;
declare const SceneOwner: ComponentDef<SceneOwnerData>;
interface PostProcessVolumeData {
    effects: {
        type: string;
        enabled: boolean;
        uniforms: Record<string, number>;
    }[];
    isGlobal: boolean;
    shape: 'box' | 'sphere';
    size: {
        x: number;
        y: number;
    };
    priority: number;
    weight: number;
    blendDistance: number;
}
declare const PostProcessVolume: ComponentDef<PostProcessVolumeData>;

type ComponentData<C> = C extends BuiltinComponentDef<infer T> ? T : C extends ComponentDef<infer T> ? T : never;
declare function getComponentDefaults(typeName: string): Record<string, unknown> | null;

/**
 * @file    resource.ts
 * @brief   Resource system for global singleton data
 */
interface ResourceDef<T> {
    readonly _id: symbol;
    readonly _name: string;
    readonly _default: T;
}
declare function defineResource<T>(defaultValue: T, name?: string): ResourceDef<T>;
interface ResDescriptor<T> {
    readonly _type: 'res';
    readonly _resource: ResourceDef<T>;
}
interface ResMutDescriptor<T> {
    readonly _type: 'res_mut';
    readonly _resource: ResourceDef<T>;
}
declare function Res<T>(resource: ResourceDef<T>): ResDescriptor<T>;
declare function ResMut<T>(resource: ResourceDef<T>): ResMutDescriptor<T>;
declare class ResMutInstance<T> {
    private value_;
    private readonly setter_;
    constructor(value: T, setter: (v: T) => void);
    get(): T;
    set(value: T): void;
    modify(fn: (value: T) => void): void;
    /** @internal */
    updateValue(value: T): void;
}
declare class ResourceStorage {
    private resources_;
    private resMutPool_;
    insert<T>(resource: ResourceDef<T>, value: T): void;
    get<T>(resource: ResourceDef<T>): T;
    set<T>(resource: ResourceDef<T>, value: T): void;
    has<T>(resource: ResourceDef<T>): boolean;
    remove<T>(resource: ResourceDef<T>): void;
    getResMut<T>(resource: ResourceDef<T>): ResMutInstance<T>;
}
interface TimeData {
    delta: number;
    elapsed: number;
    frameCount: number;
}
declare const Time: ResourceDef<TimeData>;

/**
 * @file    world.ts
 * @brief   ECS World with C++ Registry integration
 */

declare class World {
    private cppRegistry_;
    private module_;
    private entities_;
    private tsStorage_;
    private entityComponents_;
    private builtinEntitySets_;
    private worldVersion_;
    private queryCache_;
    private builtinMethodCache_;
    private iterationDepth_;
    private nextEntityId_;
    private nextGeneration_;
    private spawnCallbacks_;
    private despawnCallbacks_;
    private worldTick_;
    private componentAddedTicks_;
    private componentChangedTicks_;
    private componentRemovedBuffer_;
    private trackedComponents_;
    connectCpp(cppRegistry: CppRegistry, module?: ESEngineModule): void;
    disconnectCpp(): void;
    get hasCpp(): boolean;
    getCppRegistry(): CppRegistry | null;
    /** @internal */
    getWasmModule(): ESEngineModule | null;
    spawn(): Entity;
    despawn(entity: Entity): void;
    onSpawn(callback: (entity: Entity) => void): () => void;
    onDespawn(callback: (entity: Entity) => void): () => void;
    valid(entity: Entity): boolean;
    entityCount(): number;
    getWorldVersion(): number;
    beginIteration(): void;
    endIteration(): void;
    resetIterationDepth(): void;
    isIterating(): boolean;
    getAllEntities(): Entity[];
    setParent(child: Entity, parent: Entity): void;
    removeParent(entity: Entity): void;
    insert<C extends AnyComponentDef>(entity: Entity, component: C, data?: Partial<ComponentData<C>>): ComponentData<C>;
    set<C extends AnyComponentDef>(entity: Entity, component: C, data: ComponentData<C>): void;
    get<C extends AnyComponentDef>(entity: Entity, component: C): ComponentData<C>;
    has(entity: Entity, component: AnyComponentDef): boolean;
    tryGet<C extends AnyComponentDef>(entity: Entity, component: C): ComponentData<C> | null;
    remove(entity: Entity, component: AnyComponentDef): void;
    private getBuiltinMethods;
    private insertBuiltin;
    private getBuiltin;
    private hasBuiltin;
    private removeBuiltin;
    private insertScript;
    private getScript;
    private hasScript;
    private removeScript;
    private getStorage;
    /** @internal Pre-resolve a component to its direct storage/getter for fast iteration. */
    resolveGetter(component: AnyComponentDef): ((entity: Entity) => unknown) | null;
    /** @internal Pre-resolve a component to a direct has-check for fast query matching. */
    resolveHas(component: AnyComponentDef): ((entity: Entity) => boolean) | null;
    /** @internal Pre-resolve a component to a direct setter for fast Mut write-back. */
    resolveSetter(component: AnyComponentDef): ((entity: Entity, data: unknown) => void) | null;
    private resolvePtrFn_;
    private resolvePtrSetter_;
    private resolvePtrGetter_;
    resetQueryPool(): void;
    getComponentTypes(entity: Entity): string[];
    private resolveStorages_;
    getEntitiesWithComponents(components: AnyComponentDef[], withFilters?: AnyComponentDef[], withoutFilters?: AnyComponentDef[], precomputedKey?: string): Entity[];
    advanceTick(): void;
    getWorldTick(): number;
    enableChangeTracking(component: AnyComponentDef): void;
    isAddedSince(entity: Entity, component: AnyComponentDef, sinceTick: number): boolean;
    isChangedSince(entity: Entity, component: AnyComponentDef, sinceTick: number): boolean;
    getRemovedEntitiesSince(component: AnyComponentDef, sinceTick: number): Entity[];
    cleanRemovedBuffer(beforeTick: number): void;
    private recordAddedTick_;
    /** @internal Mark component as changed without writing data (for in-place Mut query) */
    markChanged(entity: Entity, component: AnyComponentDef): void;
    private recordChangedTick_;
    private recordRemovedTick_;
}

/**
 * @file    query.ts
 * @brief   Component query system with mutable component support
 */

interface MutWrapper<T extends AnyComponentDef> {
    readonly _type: 'mut';
    readonly _component: T;
}
declare function Mut<T extends AnyComponentDef>(component: T): MutWrapper<T>;
interface AddedWrapper<T extends AnyComponentDef> {
    readonly _filterType: 'added';
    readonly _component: T;
}
interface ChangedWrapper<T extends AnyComponentDef> {
    readonly _filterType: 'changed';
    readonly _component: T;
}
declare function Added<T extends AnyComponentDef>(component: T): AddedWrapper<T>;
declare function Changed<T extends AnyComponentDef>(component: T): ChangedWrapper<T>;
type QueryArg$1 = AnyComponentDef | MutWrapper<AnyComponentDef> | AddedWrapper<AnyComponentDef> | ChangedWrapper<AnyComponentDef>;
interface QueryDescriptor<C extends readonly QueryArg$1[]> {
    readonly _type: 'query';
    readonly _components: C;
    readonly _mutIndices: number[];
    readonly _with: AnyComponentDef[];
    readonly _without: AnyComponentDef[];
    readonly _addedFilters: Array<{
        index: number;
        component: AnyComponentDef;
    }>;
    readonly _changedFilters: Array<{
        index: number;
        component: AnyComponentDef;
    }>;
}
interface QueryBuilder<C extends readonly QueryArg$1[]> extends QueryDescriptor<C> {
    with(...components: AnyComponentDef[]): QueryBuilder<C>;
    without(...components: AnyComponentDef[]): QueryBuilder<C>;
}
declare function Query<C extends QueryArg$1[]>(...components: C): QueryBuilder<C>;
type UnwrapQueryArg<T> = T extends MutWrapper<infer C> ? C : T extends AddedWrapper<infer C> ? C : T extends ChangedWrapper<infer C> ? C : T;
type ComponentsData<C extends readonly QueryArg$1[]> = {
    [K in keyof C]: ComponentData<UnwrapQueryArg<C[K]>>;
};
type QueryResult<C extends readonly QueryArg$1[]> = [
    Entity,
    ...ComponentsData<C>
];
declare class QueryInstance<C extends readonly QueryArg$1[]> implements Iterable<QueryResult<C>> {
    private readonly world_;
    private readonly descriptor_;
    private readonly actualComponents_;
    private readonly allRequired_;
    private readonly result_;
    private readonly mutData_;
    private readonly cacheKey_;
    private lastRunTick_;
    private readonly getters_;
    private readonly mutSetters_;
    private readonly mutIsBuiltin_;
    constructor(world: World, descriptor: QueryDescriptor<C>, lastRunTick?: number);
    /** @internal Update lastRunTick for reuse across system runs */
    resetTick(tick: number): void;
    private passesChangeFilters_;
    [Symbol.iterator](): Iterator<QueryResult<C>>;
    forEach(callback: (entity: Entity, ...components: ComponentsData<C>) => void): void;
    single(): QueryResult<C> | null;
    isEmpty(): boolean;
    count(): number;
    toArray(): QueryResult<C>[];
}
interface RemovedQueryDescriptor<T extends AnyComponentDef> {
    readonly _type: 'removed';
    readonly _component: T;
}
declare function Removed<T extends AnyComponentDef>(component: T): RemovedQueryDescriptor<T>;
declare class RemovedQueryInstance<T extends AnyComponentDef> implements Iterable<Entity> {
    private readonly world_;
    private readonly component_;
    private lastRunTick_;
    constructor(world: World, component: T, lastRunTick: number);
    /** @internal Update lastRunTick for reuse across system runs */
    resetTick(tick: number): void;
    [Symbol.iterator](): Iterator<Entity>;
    isEmpty(): boolean;
    toArray(): Entity[];
}

/**
 * @file    commands.ts
 * @brief   Deferred entity/component operations
 */

interface CommandsDescriptor {
    readonly _type: 'commands';
}
declare function Commands(): CommandsDescriptor;
interface SpawnComponentEntry {
    component: AnyComponentDef;
    data: unknown;
}
declare class EntityCommands {
    private readonly commands_;
    private readonly entityRef_;
    private readonly components_;
    private isNew_;
    constructor(commands: CommandsInstance, entity: Entity | null);
    insert<T extends object>(component: AnyComponentDef, data?: Partial<T>): this;
    remove(component: AnyComponentDef): this;
    id(): Entity;
    finalize(): void;
}
declare class CommandsInstance {
    private readonly world_;
    private readonly resources_;
    private pending_;
    private spawned_;
    constructor(world: World, resources: ResourceStorage);
    spawn(): EntityCommands;
    entity(entity: Entity): EntityCommands;
    despawn(entity: Entity): this;
    insertResource<T>(resource: ResourceDef<T>, value: T): this;
    queueInsert(entity: Entity, component: AnyComponentDef, data: unknown): void;
    queueRemove(entity: Entity, component: AnyComponentDef): void;
    spawnImmediate(components: SpawnComponentEntry[], entityRef: {
        entity: Entity;
    }): void;
    flush(): void;
    private executeCommand;
}

/**
 * @file    event.ts
 * @brief   Event system with double-buffered event buses
 */
interface EventDef<T> {
    readonly _id: symbol;
    readonly _name: string;
    readonly _phantom?: T;
}
declare function defineEvent<T>(name: string): EventDef<T>;
declare class EventBus<T> {
    private readBuffer_;
    private writeBuffer_;
    send(event: T): void;
    getReadBuffer(): readonly T[];
    swap(): void;
}
declare class EventRegistry {
    private readonly buses_;
    register<T>(event: EventDef<T>): void;
    getBus<T>(event: EventDef<T>): EventBus<T>;
    swapAll(): void;
}
interface EventWriterDescriptor<T> {
    readonly _type: 'event_writer';
    readonly _event: EventDef<T>;
}
interface EventReaderDescriptor<T> {
    readonly _type: 'event_reader';
    readonly _event: EventDef<T>;
}
declare function EventWriter<T>(event: EventDef<T>): EventWriterDescriptor<T>;
declare function EventReader<T>(event: EventDef<T>): EventReaderDescriptor<T>;
declare class EventWriterInstance<T> {
    private readonly bus_;
    constructor(bus: EventBus<T>);
    send(event: T): void;
}
declare class EventReaderInstance<T> implements Iterable<T> {
    private readonly bus_;
    constructor(bus: EventBus<T>);
    [Symbol.iterator](): Iterator<T>;
    isEmpty(): boolean;
    toArray(): T[];
}

/**
 * @file    system.ts
 * @brief   System definition and scheduling
 */

declare enum Schedule {
    Startup = 0,
    First = 1,
    PreUpdate = 2,
    Update = 3,
    PostUpdate = 4,
    Last = 5,
    FixedPreUpdate = 10,
    FixedUpdate = 11,
    FixedPostUpdate = 12
}
interface GetWorldDescriptor {
    readonly _type: 'get_world';
}
declare function GetWorld(): GetWorldDescriptor;
type QueryArg = AnyComponentDef | MutWrapper<AnyComponentDef>;
type SystemParam = QueryDescriptor<readonly QueryArg[]> | ResDescriptor<unknown> | ResMutDescriptor<unknown> | CommandsDescriptor | EventWriterDescriptor<unknown> | EventReaderDescriptor<unknown> | RemovedQueryDescriptor<AnyComponentDef> | GetWorldDescriptor;
type InferParam<P> = P extends QueryDescriptor<infer C> ? QueryInstance<C> : P extends ResDescriptor<infer T> ? T : P extends ResMutDescriptor<infer T> ? ResMutInstance<T> : P extends CommandsDescriptor ? CommandsInstance : P extends EventWriterDescriptor<infer T> ? EventWriterInstance<T> : P extends EventReaderDescriptor<infer T> ? EventReaderInstance<T> : P extends RemovedQueryDescriptor<infer _T> ? RemovedQueryInstance<_T> : P extends GetWorldDescriptor ? World : never;
type InferParams<P extends readonly SystemParam[]> = {
    [K in keyof P]: InferParam<P[K]>;
};
interface SystemDef {
    readonly _id: symbol;
    readonly _params: readonly SystemParam[];
    readonly _fn: (...args: never[]) => void;
    readonly _name: string;
}
interface SystemOptions {
    name?: string;
    runBefore?: string[];
    runAfter?: string[];
}
declare function defineSystem<P extends readonly SystemParam[]>(params: [...P], fn: (...args: InferParams<P>) => void, options?: SystemOptions): SystemDef;
declare function addSystem(system: SystemDef): void;
declare function addStartupSystem(system: SystemDef): void;
declare function addSystemToSchedule(schedule: Schedule, system: SystemDef): void;
declare class SystemRunner {
    private readonly world_;
    private readonly resources_;
    private readonly eventRegistry_;
    private readonly argsCache_;
    private readonly systemTicks_;
    private readonly queryCache_;
    private readonly removedCache_;
    private currentLastRunTick_;
    private timings_;
    constructor(world: World, resources: ResourceStorage, eventRegistry?: EventRegistry);
    setTimingEnabled(enabled: boolean): void;
    getTimings(): ReadonlyMap<string, number> | null;
    run(system: SystemDef): void;
    private resolveParam;
}

/**
 * @file    renderPipeline.ts
 * @brief   Unified render pipeline for runtime and editor
 */

interface RenderParams {
    registry: {
        _cpp: CppRegistry;
    };
    viewProjection: Float32Array;
    width: number;
    height: number;
    elapsed: number;
}
interface CameraRenderParams {
    registry: {
        _cpp: CppRegistry;
    };
    viewProjection: Float32Array;
    viewportPixels: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    clearFlags: number;
    elapsed: number;
    cameraEntity?: Entity;
}
type SpineRendererFn = (registry: {
    _cpp: CppRegistry;
}, elapsed: number) => void;
type TilemapRendererFn = () => void;
type MaskProcessorFn = (registry: CppRegistry, vp: Float32Array, viewportX: number, viewportY: number, viewportW: number, viewportH: number) => void;
declare class RenderPipeline {
    private spineRenderer_;
    private tilemapRenderer_;
    private maskProcessor_;
    private lastWidth_;
    private lastHeight_;
    private activeScenes_;
    get spineRenderer(): SpineRendererFn | null;
    setSpineRenderer(fn: SpineRendererFn | null): void;
    setTilemapRenderer(fn: TilemapRendererFn | null): void;
    get maskProcessor(): MaskProcessorFn | null;
    setMaskProcessor(fn: MaskProcessorFn | null): void;
    setActiveScenes(scenes: Set<string> | null): void;
    beginScreenCapture(): void;
    endScreenCapture(): void;
    render(params: RenderParams): void;
    renderCamera(params: CameraRenderParams): void;
    private executeDrawCallbacks;
}

/**
 * @file    blend.ts
 * @brief   Blend mode definitions for rendering
 */
declare enum BlendMode {
    Normal = 0,
    Additive = 1,
    Multiply = 2,
    Screen = 3,
    PremultipliedAlpha = 4
}

/**
 * @file    material.ts
 * @brief   Material and Shader API for custom rendering
 * @details Provides shader creation and material management for custom visual effects.
 */

type ShaderHandle = number;
type MaterialHandle = number;
interface TextureRef {
    __textureRef: true;
    textureId: number;
    slot?: number;
}
type UniformValue = number | Vec2 | Vec3 | Vec4 | number[] | TextureRef;
declare function isTextureRef(v: UniformValue): v is TextureRef;
interface MaterialOptions {
    shader: ShaderHandle;
    uniforms?: Record<string, UniformValue>;
    blendMode?: BlendMode;
    depthTest?: boolean;
}
interface MaterialAssetData {
    version: string;
    type: 'material';
    shader: string;
    blendMode: number;
    depthTest: boolean;
    properties: Record<string, unknown>;
}
interface MaterialData {
    shader: ShaderHandle;
    uniforms: Map<string, UniformValue>;
    blendMode: BlendMode;
    depthTest: boolean;
    dirty_: boolean;
    cachedBuffer_: Float32Array | null;
    cachedIdx_: number;
}
declare function initMaterialAPI(wasmModule: ESEngineModule): void;
declare function shutdownMaterialAPI(): void;
declare const Material: {
    /**
     * Creates a shader from vertex and fragment source code.
     * @param vertexSrc GLSL vertex shader source
     * @param fragmentSrc GLSL fragment shader source
     * @returns Shader handle, or 0 on failure
     */
    createShader(vertexSrc: string, fragmentSrc: string): ShaderHandle;
    /**
     * Releases a shader.
     * @param shader Shader handle to release
     */
    releaseShader(shader: ShaderHandle): void;
    /**
     * Creates a material with a shader and optional settings.
     * @param options Material creation options
     * @returns Material handle
     */
    create(options: MaterialOptions): MaterialHandle;
    /**
     * Gets material data by handle.
     * @param material Material handle
     * @returns Material data or undefined
     */
    get(material: MaterialHandle): MaterialData | undefined;
    /**
     * Sets a uniform value on a material.
     * @param material Material handle
     * @param name Uniform name
     * @param value Uniform value
     */
    setUniform(material: MaterialHandle, name: string, value: UniformValue): void;
    /**
     * Gets a uniform value from a material.
     * @param material Material handle
     * @param name Uniform name
     * @returns Uniform value or undefined
     */
    getUniform(material: MaterialHandle, name: string): UniformValue | undefined;
    /**
     * Sets the blend mode for a material.
     * @param material Material handle
     * @param mode Blend mode
     */
    setBlendMode(material: MaterialHandle, mode: BlendMode): void;
    /**
     * Gets the blend mode of a material.
     * @param material Material handle
     * @returns Blend mode
     */
    getBlendMode(material: MaterialHandle): BlendMode;
    /**
     * Sets depth test enabled for a material.
     * @param material Material handle
     * @param enabled Whether depth test is enabled
     */
    setDepthTest(material: MaterialHandle, enabled: boolean): void;
    /**
     * Gets the shader handle for a material.
     * @param material Material handle
     * @returns Shader handle
     */
    getShader(material: MaterialHandle): ShaderHandle;
    /**
     * Releases a material (does not release the shader).
     * @param material Material handle
     */
    release(material: MaterialHandle): void;
    /**
     * Checks if a material exists.
     * @param material Material handle
     * @returns True if material exists
     */
    isValid(material: MaterialHandle): boolean;
    releaseAll(): void;
    /**
     * Creates a material from asset data.
     * @param data Material asset data (properties object)
     * @param shaderHandle Pre-loaded shader handle
     * @returns Material handle
     */
    createFromAsset(data: MaterialAssetData, shaderHandle: ShaderHandle): MaterialHandle;
    /**
     * Creates a material instance that shares the shader with source.
     * @param source Source material handle
     * @returns New material handle with copied settings
     */
    createInstance(source: MaterialHandle): MaterialHandle;
    /**
     * Exports material to serializable asset data.
     * @param material Material handle
     * @param shaderPath Shader file path for asset reference
     * @returns Material asset data
     */
    toAssetData(material: MaterialHandle, shaderPath: string): MaterialAssetData | null;
    /**
     * Gets all uniforms from a material.
     * @param material Material handle
     * @returns Map of uniform names to values
     */
    getUniforms(material: MaterialHandle): Map<string, UniformValue>;
    tex(textureId: number, slot?: number): TextureRef;
};
declare function registerMaterialCallback(): void;
/**
 * Built-in ES 3.0 shader sources for SDK custom materials.
 * These use the batch renderer vertex layout (vec3 position + vec4 color + vec2 texCoord)
 * and are NOT duplicates of the .esshader files (which are ES 1.0 with different layouts).
 */
declare const ShaderSources: {
    SPRITE_VERTEX: string;
    SPRITE_FRAGMENT: string;
    COLOR_VERTEX: string;
    COLOR_FRAGMENT: string;
};

/**
 * @file    MaterialLoader.ts
 * @brief   Material asset loading and caching
 */

interface LoadedMaterial {
    handle: MaterialHandle;
    shaderHandle: ShaderHandle;
    path: string;
}
interface ShaderLoader {
    load(path: string): Promise<ShaderHandle>;
    get(path: string): ShaderHandle | undefined;
}
declare class MaterialLoader {
    private cache_;
    private shaderLoader_;
    private basePath_;
    constructor(shaderLoader: ShaderLoader, basePath?: string);
    load(path: string): Promise<LoadedMaterial>;
    get(path: string): LoadedMaterial | undefined;
    has(path: string): boolean;
    release(path: string): void;
    releaseAll(): void;
    private loadInternal;
    private resolvePath;
    private resolveShaderPath;
}

interface PrefabData {
    version: string;
    name: string;
    rootEntityId: number;
    entities: PrefabEntityData[];
}
interface PrefabEntityData {
    prefabEntityId: number;
    name: string;
    parent: number | null;
    children: number[];
    components: {
        type: string;
        data: Record<string, unknown>;
    }[];
    visible: boolean;
    nestedPrefab?: {
        prefabPath: string;
        overrides: PrefabOverride[];
    };
}
interface PrefabOverride {
    prefabEntityId: number;
    type: 'property' | 'component_added' | 'component_removed' | 'name' | 'visibility';
    componentType?: string;
    propertyName?: string;
    value?: unknown;
    componentData?: {
        type: string;
        data: Record<string, unknown>;
    };
}
interface InstantiatePrefabOptions {
    assetServer?: AssetServer;
    assetBaseUrl?: string;
    parent?: Entity;
    overrides?: PrefabOverride[];
}
interface InstantiatePrefabResult {
    root: Entity;
    entities: Map<number, Entity>;
}
declare function instantiatePrefab(world: World, prefab: PrefabData, options?: InstantiatePrefabOptions): Promise<InstantiatePrefabResult>;

/**
 * @file    SpineModuleLoader.ts
 * @brief   Loads and initializes the standalone Spine WASM module
 */
interface SpineWasmModule {
    _spine_loadSkeleton(skelDataPtr: number, skelDataLen: number, atlasText: number, atlasLen: number, isBinary: number): number;
    _spine_unloadSkeleton(handle: number): void;
    _spine_getAtlasPageCount(handle: number): number;
    _spine_getAtlasPageTextureName(handle: number, pageIndex: number): number;
    _spine_setAtlasPageTexture(handle: number, pageIndex: number, textureId: number, width: number, height: number): void;
    _spine_createInstance(skeletonHandle: number): number;
    _spine_destroyInstance(instanceId: number): void;
    _spine_playAnimation(instanceId: number, name: number, loop: number, track: number): number;
    _spine_addAnimation(instanceId: number, name: number, loop: number, delay: number, track: number): number;
    _spine_setSkin(instanceId: number, name: number): void;
    _spine_update(instanceId: number, dt: number): void;
    _spine_getAnimations(instanceId: number): number;
    _spine_getSkins(instanceId: number): number;
    _spine_getBonePosition(instanceId: number, bone: number, outXPtr: number, outYPtr: number): number;
    _spine_getBoneRotation(instanceId: number, bone: number): number;
    _spine_getBounds(instanceId: number, outXPtr: number, outYPtr: number, outWPtr: number, outHPtr: number): void;
    _spine_getMeshBatchCount(instanceId: number): number;
    _spine_getMeshBatchVertexCount(instanceId: number, batchIndex: number): number;
    _spine_getMeshBatchIndexCount(instanceId: number, batchIndex: number): number;
    _spine_getMeshBatchData(instanceId: number, batchIndex: number, outVerticesPtr: number, outIndicesPtr: number, outTextureIdPtr: number, outBlendModePtr: number): void;
    cwrap(ident: string, returnType: string | null, argTypes: string[]): (...args: unknown[]) => unknown;
    UTF8ToString(ptr: number): string;
    stringToNewUTF8(str: string): number;
    HEAPF32: Float32Array;
    HEAPU8: Uint8Array;
    HEAPU32: Uint32Array;
    _malloc(size: number): number;
    _free(ptr: number): void;
}
interface SpineWrappedAPI {
    loadSkeleton(skelDataPtr: number, skelDataLen: number, atlasText: string, atlasLen: number, isBinary: boolean): number;
    getLastError(): string;
    unloadSkeleton(handle: number): void;
    getAtlasPageCount(handle: number): number;
    getAtlasPageTextureName(handle: number, pageIndex: number): string;
    setAtlasPageTexture(handle: number, pageIndex: number, textureId: number, width: number, height: number): void;
    createInstance(skeletonHandle: number): number;
    destroyInstance(instanceId: number): void;
    playAnimation(instanceId: number, name: string, loop: boolean, track: number): boolean;
    addAnimation(instanceId: number, name: string, loop: boolean, delay: number, track: number): boolean;
    setSkin(instanceId: number, name: string): void;
    update(instanceId: number, dt: number): void;
    getAnimations(instanceId: number): string;
    getSkins(instanceId: number): string;
    getBonePosition(instanceId: number, bone: string, outXPtr: number, outYPtr: number): boolean;
    getBoneRotation(instanceId: number, bone: string): number;
    getBounds(instanceId: number, outXPtr: number, outYPtr: number, outWPtr: number, outHPtr: number): void;
    getMeshBatchCount(instanceId: number): number;
    getMeshBatchVertexCount(instanceId: number, batchIndex: number): number;
    getMeshBatchIndexCount(instanceId: number, batchIndex: number): number;
    getMeshBatchData(instanceId: number, batchIndex: number, outVerticesPtr: number, outIndicesPtr: number, outTextureIdPtr: number, outBlendModePtr: number): void;
}
declare function wrapSpineModule(raw: SpineWasmModule): SpineWrappedAPI;
type SpineModuleFactory = (config?: Record<string, unknown>) => Promise<SpineWasmModule>;
declare function loadSpineModule(wasmUrl: string, factory?: SpineModuleFactory): Promise<{
    raw: SpineWasmModule;
    api: SpineWrappedAPI;
}>;

/**
 * @file    SpineController.ts
 * @brief   Spine animation control for the modular Spine WASM module
 */

type SpineEventType = 'start' | 'interrupt' | 'end' | 'complete' | 'dispose' | 'event';
type SpineEventCallback = (event: SpineEvent) => void;
interface SpineEvent {
    type: SpineEventType;
    entity: Entity;
    track: number;
    animation: string | null;
    eventName?: string;
    intValue?: number;
    floatValue?: number;
    stringValue?: string;
}
declare class SpineModuleController {
    private raw_;
    private api_;
    private listeners_;
    constructor(raw: SpineWasmModule, api: SpineWrappedAPI);
    get raw(): SpineWasmModule;
    loadSkeleton(skelData: Uint8Array | string, atlasText: string, isBinary: boolean): number;
    getLastError(): string;
    unloadSkeleton(handle: number): void;
    getAtlasPageCount(handle: number): number;
    getAtlasPageTextureName(handle: number, pageIndex: number): string;
    setAtlasPageTexture(handle: number, pageIndex: number, textureId: number, width: number, height: number): void;
    createInstance(skeletonHandle: number): number;
    destroyInstance(instanceId: number): void;
    play(instanceId: number, animation: string, loop?: boolean, track?: number): boolean;
    addAnimation(instanceId: number, animation: string, loop?: boolean, delay?: number, track?: number): boolean;
    setSkin(instanceId: number, skinName: string): void;
    update(instanceId: number, dt: number): void;
    getAnimations(instanceId: number): string[];
    getSkins(instanceId: number): string[];
    getBonePosition(instanceId: number, boneName: string): Vec2 | null;
    getBoneRotation(instanceId: number, boneName: string): number;
    getBounds(instanceId: number): {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    extractMeshBatches(instanceId: number): {
        vertices: Float32Array;
        indices: Uint16Array;
        textureId: number;
        blendMode: number;
    }[];
    on(entity: Entity, type: SpineEventType, callback: SpineEventCallback): void;
    off(entity: Entity, type: SpineEventType, callback: SpineEventCallback): void;
    removeAllListeners(entity: Entity): void;
}

type AssetContentType = 'json' | 'text' | 'binary' | 'image' | 'audio';
type AddressableAssetType = 'texture' | 'material' | 'spine' | 'bitmap-font' | 'prefab' | 'json' | 'text' | 'binary' | 'audio';
type EditorAssetType = 'texture' | 'material' | 'shader' | 'spine-atlas' | 'spine-skeleton' | 'bitmap-font' | 'prefab' | 'json' | 'audio' | 'scene' | 'anim-clip' | 'tilemap' | 'timeline' | 'unknown';
type AssetBuildTransform = (content: string, context: unknown) => string;
interface AssetTypeEntry {
    extensions: string[];
    contentType: AssetContentType;
    editorType: EditorAssetType;
    addressableType: AddressableAssetType | null;
    wechatPackInclude: boolean;
    hasTransitiveDeps: boolean;
    buildTransform?: AssetBuildTransform;
}
declare function getAssetTypeEntry(extensionOrPath: string): AssetTypeEntry | undefined;
declare function getEditorType(path: string): EditorAssetType;
declare function getAddressableType(path: string): AddressableAssetType | null;
declare function getAddressableTypeByEditorType(editorType: string): AddressableAssetType | null;
declare function isKnownAssetExtension(ext: string): boolean;
declare function getAllAssetExtensions(): Set<string>;
declare function looksLikeAssetPath(value: unknown): value is string;
declare function getCustomExtensions(): string[];
declare function getWeChatPackOptions(): Array<{
    type: string;
    value: string;
}>;
declare function getAssetMimeType(ext: string): string | undefined;
declare function isCustomExtension(path: string): boolean;
declare function toBuildPath(path: string): string;
declare function registerAssetBuildTransform(editorType: EditorAssetType, transform: AssetBuildTransform): void;
declare function getAssetBuildTransform(extensionOrPath: string): AssetBuildTransform | undefined;

/**
 * @file    AssetServer.ts
 * @brief   Asset loading and caching system
 */

interface TextureInfo {
    handle: TextureHandle;
    width: number;
    height: number;
}
interface SliceBorder$1 {
    left: number;
    right: number;
    top: number;
    bottom: number;
}
interface SpineLoadResult {
    success: boolean;
    error?: string;
}
interface SpineDescriptor {
    skeleton: string;
    atlas: string;
    baseUrl?: string;
}
interface FileLoadOptions {
    baseUrl?: string;
    noCache?: boolean;
}

interface AddressableResultMap {
    texture: TextureInfo;
    material: LoadedMaterial;
    spine: SpineLoadResult;
    'bitmap-font': FontHandle;
    prefab: PrefabData;
    json: unknown;
    text: string;
    binary: ArrayBuffer;
    audio: ArrayBuffer;
}
interface AssetBundle {
    textures: Map<string, TextureInfo>;
    materials: Map<string, LoadedMaterial>;
    spine: Map<string, SpineLoadResult>;
    fonts: Map<string, FontHandle>;
    prefabs: Map<string, PrefabData>;
    json: Map<string, unknown>;
    text: Map<string, string>;
    binary: Map<string, ArrayBuffer>;
}
interface AddressableManifestAsset {
    path: string;
    address?: string;
    type: AddressableAssetType;
    size: number;
    labels: string[];
    metadata?: {
        atlas?: string;
        atlasPage?: number;
        atlasFrame?: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
    };
}
interface AddressableManifestGroup {
    bundleMode: string;
    labels: string[];
    assets: Record<string, AddressableManifestAsset>;
}
interface AddressableManifest {
    version: '2.0';
    groups: Record<string, AddressableManifestGroup>;
}
declare class AssetServer {
    baseUrl?: string;
    private module_;
    private textureCache_;
    private shaderCache_;
    private jsonCache_;
    private textCache_;
    private binaryCache_;
    private loadedSpines_;
    private virtualFSPaths_;
    private materialLoader_;
    private canvas_;
    private ctx_;
    private fontCache_;
    private prefabCache_;
    private embedded_;
    private embeddedOnly_;
    private addressableManifest_;
    private addressIndex_;
    private labelIndex_;
    private groupAssets_;
    private spineController_;
    private spineSkeletons_;
    private textureRefCounts_;
    private assetRefResolver_;
    constructor(module: ESEngineModule);
    registerEmbeddedAssets(assets: Record<string, string>): void;
    setEmbeddedOnly(value: boolean): void;
    /**
     * Load texture with vertical flip (for Sprite/UI).
     * OpenGL UV origin is bottom-left, so standard images need flipping.
     */
    loadTexture(source: string): Promise<TextureInfo>;
    /**
     * Load texture without flip (for Spine).
     * Spine runtime handles UV coordinates internally.
     */
    loadTextureRaw(source: string): Promise<TextureInfo>;
    getTexture(source: string): TextureInfo | undefined;
    hasTexture(source: string): boolean;
    getTextureRefCount(source: string): number;
    releaseTexture(source: string): void;
    releaseAll(): void;
    private cleanupVirtualFS;
    setTextureMetadata(handle: TextureHandle, border: SliceBorder$1): void;
    setTextureMetadataByPath(source: string, border: SliceBorder$1): boolean;
    setSpineController(controller: SpineModuleController): void;
    getSpineSkeletonHandle(skeletonPath: string, atlasPath: string): number | undefined;
    loadSpine(skeletonPath: string, atlasPath: string, baseUrl?: string): Promise<SpineLoadResult>;
    isSpineLoaded(skeletonPath: string, atlasPath: string): boolean;
    releaseSpine(key: string): void;
    loadBitmapFont(fontPath: string, baseUrl?: string): Promise<FontHandle>;
    getFont(fontPath: string): FontHandle | undefined;
    releaseFont(fontPath: string): void;
    private loadBmfontAsset;
    private loadFntFile;
    setAssetRefResolver(resolver: (ref: string) => string | null): void;
    loadPrefab(path: string, baseUrl?: string): Promise<PrefabData>;
    private resolvePrefabRefs_;
    loadMaterial(path: string, baseUrl?: string): Promise<LoadedMaterial>;
    getMaterial(path: string, baseUrl?: string): LoadedMaterial | undefined;
    hasMaterial(path: string, baseUrl?: string): boolean;
    loadShader(path: string): Promise<ShaderHandle>;
    loadJson<T = unknown>(path: string, options?: FileLoadOptions): Promise<T>;
    loadText(path: string, options?: FileLoadOptions): Promise<string>;
    loadBinary(path: string, options?: FileLoadOptions): Promise<ArrayBuffer>;
    loadScene(world: World, sceneData: SceneData): Promise<Map<number, Entity>>;
    loadAll(manifest: AddressableManifest): Promise<AssetBundle>;
    setAddressableManifest(manifest: AddressableManifest): void;
    resolveAddress(address: string): AddressableManifestAsset | undefined;
    load<T extends AddressableAssetType = AddressableAssetType>(address: string): Promise<AddressableResultMap[T]>;
    loadByLabel(label: string): Promise<AssetBundle>;
    loadGroup(groupName: string): Promise<AssetBundle>;
    private loadAddressableAsset;
    private loadAddressableAssets;
    private textureCacheKey;
    private loadTextureWithFlip;
    private loadTextureInternal;
    private loadImage;
    private loadImageFromSrc;
    private createTextureFromImage;
    private getWebGL2Context;
    private createTextureWebGL2;
    private createTextureFallback;
    private unpremultiplyAlpha;
    private loadShaderInternal;
    private parseEsShader;
    private decodeDataUrlText;
    private decodeDataUrlBinary;
    private isLocalPath;
    private toLocalPath;
    private getEmbedded;
    private fetchJson;
    private fetchText;
    private fetchBinary;
    private writeToVirtualFS;
    private ensureVirtualDir;
    private resolveUrl;
    private nextPowerOf2;
    private parseAtlasTextures;
}

/**
 * @file    scene.ts
 * @brief   Scene loading utilities
 */

interface SceneEntityData {
    id: number;
    name: string;
    parent: number | null;
    children: number[];
    components: SceneComponentData[];
    visible?: boolean;
}
interface SceneComponentData {
    type: string;
    data: Record<string, unknown>;
}
interface SliceBorder {
    left: number;
    right: number;
    top: number;
    bottom: number;
}
interface TextureMetadata {
    version: string;
    type: 'texture';
    sliceBorder: SliceBorder;
}
interface SceneData {
    version: string;
    name: string;
    entities: SceneEntityData[];
    textureMetadata?: Record<string, TextureMetadata>;
}
interface LoadedSceneAssets {
    textureUrls: Set<string>;
    materialHandles: Set<number>;
    fontPaths: Set<string>;
    spineKeys: Set<string>;
}
interface SceneLoadOptions {
    assetServer?: AssetServer;
    assetBaseUrl?: string;
    collectAssets?: LoadedSceneAssets;
}
type AssetFieldType = 'texture' | 'material' | 'font' | 'anim-clip' | 'audio' | 'tilemap' | 'timeline';
interface AssetFieldDescriptor {
    field: string;
    type: AssetFieldType;
}
interface SpineFieldDescriptor {
    skeletonField: string;
    atlasField: string;
}
interface ComponentAssetFields {
    fields?: AssetFieldDescriptor[];
    spine?: SpineFieldDescriptor;
}
declare function registerComponentAssetFields(componentType: string, config: ComponentAssetFields): void;
declare function getComponentAssetFields(componentType: string): string[];
declare function getComponentAssetFieldDescriptors(componentType: string): readonly {
    field: string;
    type: AssetFieldType;
}[];
declare function getComponentSpineFieldDescriptor(componentType: string): {
    skeletonField: string;
    atlasField: string;
} | null;
declare function registerComponentEntityFields(componentType: string, fields: string[]): void;
declare function getComponentEntityFields(componentType: string): string[] | undefined;
declare function remapEntityFields(compData: SceneComponentData, entityMap: Map<number, Entity>): void;
declare function loadSceneData(world: World, sceneData: SceneData): Map<number, Entity>;
declare function loadSceneWithAssets(world: World, sceneData: SceneData, options?: SceneLoadOptions): Promise<Map<number, Entity>>;
declare function loadComponent(world: World, entity: Entity, compData: SceneComponentData, entityName?: string): void;
declare function updateCameraAspectRatio(world: World, aspectRatio: number): void;
declare function findEntityByName(world: World, name: string): Entity | null;

/**
 * @file    customDraw.ts
 * @brief   Custom draw callback registration for the render pipeline
 */
type DrawCallback = (elapsed: number) => void;
declare function registerDrawCallback(id: string, fn: DrawCallback, scene?: string): void;
declare function unregisterDrawCallback(id: string): void;
declare function clearDrawCallbacks(): void;

interface PassConfig {
    name: string;
    shader: ShaderHandle;
    enabled: boolean;
    floatUniforms: Map<string, number>;
    vec4Uniforms: Map<string, Vec4>;
}
declare class PostProcessStack {
    readonly id: number;
    private passes_;
    private destroyed_;
    constructor();
    addPass(name: string, shader: ShaderHandle): this;
    removePass(name: string): this;
    clearPasses(): this;
    setEnabled(name: string, enabled: boolean): this;
    setUniform(passName: string, uniform: string, value: number): this;
    setUniformVec4(passName: string, uniform: string, value: Vec4): this;
    setAllPassesEnabled(enabled: boolean): void;
    get passCount(): number;
    get enabledPassCount(): number;
    get passes(): readonly PassConfig[];
    get isDestroyed(): boolean;
    destroy(): void;
}

type SceneStatus = 'loading' | 'running' | 'paused' | 'sleeping' | 'unloading';
interface SceneConfig {
    name: string;
    path?: string;
    data?: SceneData;
    systems?: Array<{
        schedule: Schedule;
        system: SystemDef;
    }>;
    setup?: (ctx: SceneContext) => void | Promise<void>;
    cleanup?: (ctx: SceneContext) => void;
}
interface SceneContext {
    readonly name: string;
    readonly entities: ReadonlySet<Entity>;
    spawn(): Entity;
    despawn(entity: Entity): void;
    registerDrawCallback(id: string, fn: DrawCallback): void;
    bindPostProcess(camera: Entity, stack: PostProcessStack): void;
    unbindPostProcess(camera: Entity): void;
    setPersistent(entity: Entity, persistent: boolean): void;
}
interface TransitionOptions {
    keepPersistent?: boolean;
    transition?: 'none' | 'fade';
    duration?: number;
    color?: Color;
    onStart?: () => void;
    onComplete?: () => void;
}
declare class SceneManagerState {
    private readonly app_;
    private readonly configs_;
    private readonly scenes_;
    private readonly contexts_;
    private readonly additiveScenes_;
    private readonly pausedScenes_;
    private readonly sleepingScenes_;
    private readonly loadOrder_;
    private activeScene_;
    private initialScene_;
    private transition_;
    private switching_;
    private loadPromises_;
    constructor(app: App);
    reset(): void;
    register(config: SceneConfig): void;
    setInitial(name: string): void;
    getInitial(): string | null;
    isTransitioning(): boolean;
    switchTo(name: string, options?: TransitionOptions): Promise<void>;
    private startFadeTransition;
    updateTransition(dt: number): void;
    load(name: string): Promise<SceneContext>;
    loadAdditive(name: string): Promise<SceneContext>;
    unload(name: string, options?: TransitionOptions): Promise<void>;
    private loadSceneData_;
    private releaseSceneAssets_;
    pause(name: string): void;
    resume(name: string): void;
    sleep(name: string): void;
    wake(name: string): void;
    private setPostProcessPassesEnabled;
    isPaused(name: string): boolean;
    isSleeping(name: string): boolean;
    isLoaded(name: string): boolean;
    isActive(name: string): boolean;
    getActive(): string | null;
    getActiveScenes(): string[];
    getLoaded(): string[];
    getLoadOrder(): string[];
    bringToTop(name: string): void;
    getScene(name: string): SceneContext | null;
    getSceneStatus(name: string): SceneStatus | null;
}
declare const SceneManager: ResourceDef<SceneManagerState>;
declare function wrapSceneSystem(app: App, sceneName: string, system: SystemDef): SystemDef;

/**
 * @file    app.ts
 * @brief   Application builder and web platform integration
 */

type PluginDependency = string | ResourceDef<any>;
interface Plugin {
    name?: string;
    dependencies?: PluginDependency[];
    build(app: App): void;
    finish?(app: App): void;
    cleanup?(app?: App): void;
}
declare class App {
    private readonly world_;
    private readonly resources_;
    private readonly systems_;
    private runner_;
    private running_;
    private lastTime_;
    private fixedTimestep_;
    private fixedAccumulator_;
    private maxDeltaTime_;
    private maxFixedSteps_;
    private module_;
    private pipeline_;
    private spineInitPromise_?;
    private physicsInitPromise_?;
    private physicsModule_?;
    private readonly installed_plugins_;
    private readonly installedPluginSet_;
    private readonly installedPluginNames_;
    private pluginsFinished_;
    private readonly eventRegistry_;
    private readonly sortedSystemsCache_;
    private error_handler_;
    private system_error_handler_;
    private statsEnabled_;
    private phaseTimings_;
    private frame_paused_;
    private user_paused_;
    private step_pending_;
    private play_speed_;
    private constructor();
    static new(): App;
    addPlugin(plugin: Plugin): this;
    addEvent<T>(event: EventDef<T>): this;
    addSystemToSchedule(schedule: Schedule, system: SystemDef, options?: {
        runBefore?: string[];
        runAfter?: string[];
    }): this;
    addSystem(system: SystemDef): this;
    addStartupSystem(system: SystemDef): this;
    removeSystem(systemId: symbol): boolean;
    connectCpp(cppRegistry: CppRegistry, module?: ESEngineModule): this;
    get wasmModule(): ESEngineModule | null;
    get pipeline(): RenderPipeline | null;
    setPipeline(pipeline: RenderPipeline): void;
    setSpineRenderer(fn: SpineRendererFn | null): void;
    get spineInitPromise(): Promise<unknown> | undefined;
    set spineInitPromise(p: Promise<unknown> | undefined);
    get physicsInitPromise(): Promise<unknown> | undefined;
    set physicsInitPromise(p: Promise<unknown> | undefined);
    get physicsModule(): unknown;
    set physicsModule(m: unknown);
    get world(): World;
    setFixedTimestep(timestep: number): this;
    setMaxDeltaTime(v: number): this;
    setMaxFixedSteps(v: number): this;
    onError(handler: (error: unknown, systemName: string) => void): this;
    onSystemError(handler: (error: Error, systemName?: string) => 'continue' | 'pause'): this;
    onWasmError(handler: (error: unknown, context: string) => void): this;
    setPaused(paused: boolean): void;
    isPaused(): boolean;
    stepFrame(): void;
    setPlaySpeed(speed: number): void;
    getPlaySpeed(): number;
    enableStats(): this;
    getSystemTimings(): ReadonlyMap<string, number> | null;
    getPhaseTimings(): ReadonlyMap<string, number> | null;
    getEntityCount(): number;
    insertResource<T>(resource: ResourceDef<T>, value: T): this;
    getResource<T>(resource: ResourceDef<T>): T;
    hasResource<T>(resource: ResourceDef<T>): boolean;
    registerScene(config: SceneConfig): this;
    setInitialScene(name: string): this;
    tick(delta: number): void;
    run(): void;
    private mainLoop;
    quit(): void;
    private finishPlugins_;
    private sortSystems;
    private flushStartupSystems_;
    private runSchedule;
    private updateTime;
}
interface WebAppOptions {
    getViewportSize?: () => {
        width: number;
        height: number;
    };
    glContextHandle?: number;
    plugins?: Plugin[];
}
declare function flushPendingSystems(app: App): void;

export { CommandsInstance as $, App as A, BitmapText as H, Camera as K, Canvas as O, Changed as T, Children as V, World as W, ClearFlags as Y, Commands as Z, SpineModuleController as a, SceneOwner as a$, EmitterShape as a3, EntityCommands as a4, EventReader as a6, EventReaderInstance as a8, EventRegistry as a9, PostProcessVolume as aA, ProjectionType as aE, Query as aF, QueryInstance as aI, Removed as aK, RemovedQueryInstance as aM, RenderPipeline as aO, Res as aP, ResMut as aR, ResMutInstance as aT, ScaleMode as aU, SceneManager as aZ, SceneManagerState as a_, EventWriter as aa, EventWriterInstance as ac, GetWorld as ae, LocalTransform as ak, Material as am, MaterialLoader as ao, Mut as aq, Name as as, Parent as au, ParticleEasing as aw, ParticleEmitter as ax, isBuiltinComponent as b$, Schedule as b2, ShaderSources as b4, ShapeRenderer as b5, ShapeType as b7, SimulationSpace as b8, clearDrawCallbacks as bA, clearUserComponents as bB, defineComponent as bC, defineEvent as bD, defineResource as bE, defineSystem as bF, defineTag as bG, findEntityByName as bH, flushPendingSystems as bI, getAddressableType as bJ, getAddressableTypeByEditorType as bK, getAllAssetExtensions as bL, getAssetBuildTransform as bM, getAssetMimeType as bN, getAssetTypeEntry as bO, getComponent as bP, getComponentAssetFieldDescriptors as bQ, getComponentAssetFields as bR, getComponentDefaults as bS, getComponentEntityFields as bT, getComponentSpineFieldDescriptor as bU, getCustomExtensions as bV, getEditorType as bW, getUserComponent as bX, getWeChatPackOptions as bY, initMaterialAPI as bZ, instantiatePrefab as b_, SpineAnimation as ba, Sprite as bf, SystemRunner as bk, Time as bn, Transform as bp, Velocity as bt, WorldTransform as bv, addStartupSystem as bx, addSystem as by, addSystemToSchedule as bz, isCustomExtension as c0, isKnownAssetExtension as c1, isTextureRef as c2, loadComponent as c3, loadSceneData as c4, loadSceneWithAssets as c5, looksLikeAssetPath as c6, registerAssetBuildTransform as c7, registerComponent as c8, registerComponentAssetFields as c9, registerComponentEntityFields as ca, registerDrawCallback as cb, registerMaterialCallback as cc, remapEntityFields as cd, shutdownMaterialAPI as ce, toBuildPath as cf, unregisterComponent as cg, unregisterDrawCallback as ch, updateCameraAspectRatio as ci, wrapSceneSystem as cj, PostProcessStack as g, AssetServer as i, loadSpineModule as l, BlendMode as o, Added as r, wrapSpineModule as w };
export type { BuiltinComponentDef as B, ComponentDef as C, AssetBundle as D, AssetContentType as E, AssetFieldType as F, AssetTypeEntry as G, InstantiatePrefabResult as I, BitmapTextData as J, CameraData as L, MaskProcessorFn as M, CameraRenderParams as N, Plugin as P, CanvasData as Q, ResourceDef as R, SpineModuleFactory as S, ChangedWrapper as U, ChildrenData as X, CommandsDescriptor as _, ComponentData as a0, DrawCallback as a1, EditorAssetType as a2, EventDef as a5, EventReaderDescriptor as a7, PostProcessVolumeData as aB, PrefabData as aC, PrefabEntityData as aD, QueryBuilder as aG, QueryDescriptor as aH, QueryResult as aJ, RemovedQueryDescriptor as aL, RenderParams as aN, ResDescriptor as aQ, ResMutDescriptor as aS, SceneComponentData as aV, SceneContext as aW, SceneEntityData as aX, SceneLoadOptions as aY, EventWriterDescriptor as ab, FileLoadOptions as ad, GetWorldDescriptor as af, InferParam as ag, InferParams as ah, InstantiatePrefabOptions as ai, LoadedMaterial as aj, LocalTransformData as al, MaterialAssetData as an, MaterialOptions as ap, MutWrapper as ar, NameData as at, ParentData as av, ParticleEmitterData as ay, PluginDependency as az, SpineEvent as b, SceneOwnerData as b0, SceneStatus as b1, ShaderLoader as b3, ShapeRendererData as b6, SliceBorder$1 as b9, SpineAnimationData as bb, SpineDescriptor as bc, SpineLoadResult as bd, SpineRendererFn as be, SpriteData as bg, SystemDef as bh, SystemOptions as bi, SystemParam as bj, TextureInfo as bl, TextureRef as bm, TimeData as bo, TransformData as bq, TransitionOptions as br, UniformValue as bs, VelocityData as bu, WorldTransformData as bw, SpineEventCallback as c, SpineEventType as d, SpineWasmModule as e, SpineWrappedAPI as f, ShaderHandle as h, PrefabOverride as j, SceneData as k, AddressableManifest as m, SceneConfig as n, MaterialHandle as p, WebAppOptions as q, AddedWrapper as s, AddressableAssetType as t, AddressableManifestAsset as u, AddressableManifestGroup as v, AddressableResultMap as x, AnyComponentDef as y, AssetBuildTransform as z };
