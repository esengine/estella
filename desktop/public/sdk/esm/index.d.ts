/**
 * @file    types.ts
 * @brief   Core type definitions for ESEngine SDK
 */
type Entity = number;
declare const INVALID_ENTITY: Entity;
type TextureHandle = number;
declare const INVALID_TEXTURE: TextureHandle;
interface Vec2 {
    x: number;
    y: number;
}
interface Vec3 {
    x: number;
    y: number;
    z: number;
}
interface Vec4 {
    x: number;
    y: number;
    z: number;
    w: number;
}
interface Quat {
    w: number;
    x: number;
    y: number;
    z: number;
}
type Color = Vec4;
declare const vec2: (x?: number, y?: number) => Vec2;
declare const vec3: (x?: number, y?: number, z?: number) => Vec3;
declare const vec4: (x?: number, y?: number, z?: number, w?: number) => Vec4;
declare const color: (r?: number, g?: number, b?: number, a?: number) => Color;
declare const quat: (w?: number, x?: number, y?: number, z?: number) => Quat;

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
interface BuiltinComponentDef<T> {
    readonly _id: symbol;
    readonly _name: string;
    readonly _cppName: string;
    readonly _builtin: true;
    readonly _default: T;
}
type AnyComponentDef = ComponentDef<any> | BuiltinComponentDef<any>;
declare function isBuiltinComponent(comp: AnyComponentDef): comp is BuiltinComponentDef<any>;
interface LocalTransformData {
    position: Vec3;
    rotation: Quat;
    scale: Vec3;
}
interface WorldTransformData {
    position: Vec3;
    rotation: Quat;
    scale: Vec3;
}
interface SpriteData {
    texture: number;
    color: Vec4;
    size: Vec2;
    uvOffset: Vec2;
    uvScale: Vec2;
    layer: number;
    flipX: boolean;
    flipY: boolean;
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
}
interface CanvasData {
    designResolution: Vec2;
    pixelsPerUnit: number;
    scaleMode: number;
    matchWidthOrHeight: number;
    backgroundColor: Vec4;
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
    color: Vec4;
    layer: number;
    skeletonScale: number;
}
declare const LocalTransform: BuiltinComponentDef<LocalTransformData>;
declare const WorldTransform: BuiltinComponentDef<WorldTransformData>;
declare const Sprite: BuiltinComponentDef<SpriteData>;
declare const Camera: BuiltinComponentDef<CameraData>;
declare const Canvas: BuiltinComponentDef<CanvasData>;
declare const Velocity: BuiltinComponentDef<VelocityData>;
declare const Parent: BuiltinComponentDef<ParentData>;
declare const Children: BuiltinComponentDef<ChildrenData>;
declare const SpineAnimation: BuiltinComponentDef<SpineAnimationData>;
type ComponentData<C> = C extends BuiltinComponentDef<infer T> ? T : C extends ComponentDef<infer T> ? T : never;

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
}
declare class ResourceStorage {
    private resources_;
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
interface InputState {
    keysDown: Set<string>;
    keysPressed: Set<string>;
    keysReleased: Set<string>;
    mouseX: number;
    mouseY: number;
    mouseButtons: Set<number>;
}
declare const Input: ResourceDef<InputState>;

/**
 * @file    wasm.ts
 * @brief   WASM module type definitions
 */

interface CppRegistry {
    create(): Entity;
    destroy(entity: Entity): void;
    valid(entity: Entity): boolean;
    delete(): void;
    addLocalTransform(entity: Entity, data: unknown): void;
    getLocalTransform(entity: Entity): unknown;
    hasLocalTransform(entity: Entity): boolean;
    removeLocalTransform(entity: Entity): void;
    addWorldTransform(entity: Entity, data: unknown): void;
    getWorldTransform(entity: Entity): unknown;
    hasWorldTransform(entity: Entity): boolean;
    removeWorldTransform(entity: Entity): void;
    addSprite(entity: Entity, data: unknown): void;
    getSprite(entity: Entity): unknown;
    hasSprite(entity: Entity): boolean;
    removeSprite(entity: Entity): void;
    addCamera(entity: Entity, data: unknown): void;
    getCamera(entity: Entity): unknown;
    hasCamera(entity: Entity): boolean;
    removeCamera(entity: Entity): void;
    addCanvas(entity: Entity, data: unknown): void;
    getCanvas(entity: Entity): unknown;
    hasCanvas(entity: Entity): boolean;
    removeCanvas(entity: Entity): void;
    addVelocity(entity: Entity, data: unknown): void;
    getVelocity(entity: Entity): unknown;
    hasVelocity(entity: Entity): boolean;
    removeVelocity(entity: Entity): void;
    addParent(entity: Entity, data: unknown): void;
    getParent(entity: Entity): unknown;
    hasParent(entity: Entity): boolean;
    removeParent(entity: Entity): void;
    addChildren(entity: Entity, data: unknown): void;
    getChildren(entity: Entity): unknown;
    hasChildren(entity: Entity): boolean;
    removeChildren(entity: Entity): void;
    addSpineAnimation(entity: Entity, data: unknown): void;
    getSpineAnimation(entity: Entity): unknown;
    hasSpineAnimation(entity: Entity): boolean;
    removeSpineAnimation(entity: Entity): void;
    setParent(child: Entity, parent: Entity): void;
    [key: string]: any;
}
interface CppResourceManager {
    createTexture(width: number, height: number, pixels: number, pixelsLen: number, format: number): number;
    createShader(vertSrc: string, fragSrc: string): number;
    releaseTexture(handle: number): void;
    releaseShader(handle: number): void;
    setTextureMetadata(handle: number, left: number, right: number, top: number, bottom: number): void;
    registerTextureWithPath(handle: number, path: string): void;
}
interface EmscriptenFS {
    writeFile(path: string, data: string | Uint8Array): void;
    readFile(path: string, opts?: {
        encoding?: string;
    }): string | Uint8Array;
    mkdir(path: string): void;
    mkdirTree(path: string): void;
    unlink(path: string): void;
    stat(path: string): {
        mode: number;
        size: number;
    };
    isFile(mode: number): boolean;
    isDir(mode: number): boolean;
    analyzePath(path: string): {
        exists: boolean;
        parentExists: boolean;
    };
}
interface SpineBounds {
    x: number;
    y: number;
    width: number;
    height: number;
    valid: boolean;
}
interface ESEngineModule {
    Registry: new () => CppRegistry;
    HEAPU8: Uint8Array;
    HEAPF32: Float32Array;
    FS: EmscriptenFS;
    initRenderer(): void;
    initRendererWithCanvas(canvasSelector: string): boolean;
    initRendererWithContext(contextHandle: number): boolean;
    shutdownRenderer(): void;
    GL: {
        registerContext(ctx: WebGLRenderingContext | WebGL2RenderingContext, options: {
            majorVersion: number;
            minorVersion: number;
            enableExtensionsByDefault?: boolean;
        }): number;
    };
    renderFrame(registry: CppRegistry, width: number, height: number): void;
    renderFrameWithMatrix(registry: CppRegistry, width: number, height: number, matrixPtr: number): void;
    getResourceManager(): CppResourceManager;
    getSpineBounds(registry: CppRegistry, entity: number): SpineBounds;
    _malloc(size: number): number;
    _free(ptr: number): void;
}

/**
 * @file    world.ts
 * @brief   ECS World with C++ Registry integration
 */

declare class World {
    private cppRegistry_;
    private entities_;
    private tsStorage_;
    connectCpp(cppRegistry: CppRegistry): void;
    get hasCpp(): boolean;
    spawn(): Entity;
    despawn(entity: Entity): void;
    valid(entity: Entity): boolean;
    entityCount(): number;
    getAllEntities(): Entity[];
    setParent(child: Entity, parent: Entity): void;
    insert(entity: Entity, component: AnyComponentDef, data?: unknown): unknown;
    get(entity: Entity, component: AnyComponentDef): unknown;
    has(entity: Entity, component: AnyComponentDef): boolean;
    remove(entity: Entity, component: AnyComponentDef): void;
    private insertBuiltin;
    private getBuiltin;
    private hasBuiltin;
    private removeBuiltin;
    private insertScript;
    private getScript;
    private hasScript;
    private removeScript;
    private getStorage;
    getEntitiesWithComponents(components: AnyComponentDef[]): Entity[];
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
type QueryArg$1 = AnyComponentDef | MutWrapper<AnyComponentDef>;
interface QueryDescriptor<C extends readonly QueryArg$1[]> {
    readonly _type: 'query';
    readonly _components: C;
    readonly _mutIndices: number[];
    readonly _with: AnyComponentDef[];
    readonly _without: AnyComponentDef[];
}
declare function Query<C extends QueryArg$1[]>(...components: C): QueryDescriptor<C>;
type UnwrapQueryArg<T> = T extends MutWrapper<infer C> ? C : T;
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
    private pendingMutations_;
    constructor(world: World, descriptor: QueryDescriptor<C>);
    private getActualComponent;
    private commitPending;
    [Symbol.iterator](): Iterator<QueryResult<C>>;
    forEach(callback: (entity: Entity, ...components: ComponentsData<C>) => void): void;
    single(): QueryResult<C> | null;
    isEmpty(): boolean;
    count(): number;
    toArray(): QueryResult<C>[];
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
    private finalize;
}
declare class CommandsInstance {
    private readonly world_;
    private readonly resources_;
    private pending_;
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
type QueryArg = AnyComponentDef | MutWrapper<AnyComponentDef>;
type SystemParam = QueryDescriptor<readonly QueryArg[]> | ResDescriptor<unknown> | ResMutDescriptor<unknown> | CommandsDescriptor;
type InferParam<P> = P extends QueryDescriptor<infer C> ? QueryInstance<C> : P extends ResDescriptor<infer T> ? T : P extends ResMutDescriptor<infer T> ? ResMutInstance<T> : P extends CommandsDescriptor ? CommandsInstance : never;
type InferParams<P extends readonly SystemParam[]> = {
    [K in keyof P]: InferParam<P[K]>;
};
interface SystemDef {
    readonly _id: symbol;
    readonly _params: readonly SystemParam[];
    readonly _fn: (...args: unknown[]) => void;
    readonly _name: string;
}
declare function defineSystem<P extends readonly SystemParam[]>(params: [...P], fn: (...args: InferParams<P>) => void, options?: {
    name?: string;
}): SystemDef;
declare class SystemRunner {
    private readonly world_;
    private readonly resources_;
    constructor(world: World, resources: ResourceStorage);
    run(system: SystemDef): void;
    private resolveParam;
}

/**
 * @file    app.ts
 * @brief   Application builder and web platform integration
 */

interface Plugin {
    build(app: App): void;
}
declare class App {
    private readonly world_;
    private readonly resources_;
    private readonly systems_;
    private runner_;
    private running_;
    private lastTime_;
    private module_;
    private constructor();
    static new(): App;
    addPlugin(plugin: Plugin): this;
    addSystemToSchedule(schedule: Schedule, system: SystemDef): this;
    addSystem(system: SystemDef): this;
    addStartupSystem(system: SystemDef): this;
    connectCpp(cppRegistry: CppRegistry, module?: ESEngineModule): this;
    get wasmModule(): ESEngineModule | null;
    get world(): World;
    insertResource<T>(resource: ResourceDef<T>, value: T): this;
    getResource<T>(resource: ResourceDef<T>): T;
    hasResource<T>(resource: ResourceDef<T>): boolean;
    run(): void;
    private mainLoop;
    quit(): void;
    private runSchedule;
    private updateTime;
}
interface WebAppOptions {
    getViewportSize?: () => {
        width: number;
        height: number;
    };
    glContextHandle?: number;
}
declare function createWebApp(module: ESEngineModule, options?: WebAppOptions): App;

declare enum TextAlign {
    Left = 0,
    Center = 1,
    Right = 2
}
declare enum TextVerticalAlign {
    Top = 0,
    Middle = 1,
    Bottom = 2
}
declare enum TextOverflow {
    Visible = 0,
    Clip = 1,
    Ellipsis = 2
}
interface TextData {
    content: string;
    fontFamily: string;
    fontSize: number;
    color: Vec4;
    align: TextAlign;
    verticalAlign: TextVerticalAlign;
    wordWrap: boolean;
    overflow: TextOverflow;
    lineHeight: number;
    dirty: boolean;
}
declare const Text: ComponentDef<TextData>;

interface UIRectData {
    size: Vec2;
    anchor: Vec2;
    pivot: Vec2;
}
declare const UIRect: ComponentDef<UIRectData>;

/**
 * @file    TextRenderer.ts
 * @brief   Renders text to GPU textures using Canvas 2D API
 */

interface TextRenderResult {
    textureHandle: number;
    width: number;
    height: number;
}
declare class TextRenderer {
    private canvas;
    private ctx;
    private module;
    private cache;
    constructor(module: ESEngineModule);
    /**
     * Renders text to a texture and returns the handle
     */
    renderText(text: TextData, uiRect?: UIRectData | null): TextRenderResult;
    private truncateWithEllipsis;
    /**
     * Renders text for an entity and caches the result
     */
    renderForEntity(entity: Entity, text: TextData, uiRect?: UIRectData | null): TextRenderResult;
    /**
     * Gets cached render result for entity
     */
    getCached(entity: Entity): TextRenderResult | undefined;
    /**
     * Releases texture for entity
     */
    release(entity: Entity): void;
    /**
     * Releases all cached textures
     */
    releaseAll(): void;
    private wrapText;
    private measureWidth;
    private mapAlign;
    private nextPowerOf2;
    private flipVertically;
}

/**
 * @file    TextPlugin.ts
 * @brief   Plugin that automatically syncs Text components to Sprite textures
 */

declare class TextPlugin implements Plugin {
    build(app: App): void;
}
declare const textPlugin: TextPlugin;

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
declare class AssetServer {
    private module_;
    private cache_;
    private pending_;
    private canvas_;
    private ctx_;
    constructor(module: ESEngineModule);
    loadTexture(source: string): Promise<TextureInfo>;
    getTexture(source: string): TextureInfo | undefined;
    hasTexture(source: string): boolean;
    releaseTexture(source: string): void;
    releaseAll(): void;
    setTextureMetadata(handle: TextureHandle, border: SliceBorder$1): void;
    setTextureMetadataByPath(source: string, border: SliceBorder$1): boolean;
    private loadTextureInternal;
    private loadImage;
    private createTextureFromImage;
    private unpremultiplyAlpha;
    private flipVertically;
    private nextPowerOf2;
}

interface AssetsData {
    server: AssetServer;
}
declare const Assets: ResourceDef<AssetsData>;
declare class AssetPlugin implements Plugin {
    build(app: App): void;
}
declare const assetPlugin: AssetPlugin;

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
interface SceneLoadOptions {
    assetServer?: AssetServer;
    assetBaseUrl?: string;
}
declare function loadSceneData(world: World, sceneData: SceneData): Map<number, Entity>;
declare function loadSceneWithAssets(world: World, sceneData: SceneData, options?: SceneLoadOptions): Promise<Map<number, Entity>>;
declare function updateCameraAspectRatio(world: World, aspectRatio: number): void;

/**
 * @file    PreviewPlugin.ts
 * @brief   Plugin for editor preview functionality
 */

declare class PreviewPlugin implements Plugin {
    private sceneUrl_;
    private app_;
    private loadPromise_;
    constructor(sceneUrl: string);
    build(app: App): void;
    /**
     * @brief Wait for scene loading to complete
     */
    waitForReady(): Promise<void>;
    private loadScene;
    private ensureCamera;
}

/**
 * @file    types.ts
 * @brief   Platform adapter interface definitions
 */
interface PlatformResponse {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    json<T = unknown>(): Promise<T>;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
}
interface PlatformRequestOptions {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD' | 'OPTIONS';
    headers?: Record<string, string>;
    body?: string | ArrayBuffer;
    responseType?: 'text' | 'arraybuffer' | 'json';
    timeout?: number;
}
interface WasmInstantiateResult {
    instance: WebAssembly.Instance;
    module: WebAssembly.Module;
}
interface PlatformAdapter {
    /**
     * Platform name identifier
     */
    readonly name: 'web' | 'wechat';
    /**
     * Fetch resource from URL
     */
    fetch(url: string, options?: PlatformRequestOptions): Promise<PlatformResponse>;
    /**
     * Read local file as ArrayBuffer
     * @param path - File path (relative to game root)
     */
    readFile(path: string): Promise<ArrayBuffer>;
    /**
     * Read local file as text
     * @param path - File path (relative to game root)
     */
    readTextFile(path: string): Promise<string>;
    /**
     * Check if file exists
     * @param path - File path
     */
    fileExists(path: string): Promise<boolean>;
    /**
     * Instantiate WebAssembly module
     * @param pathOrBuffer - WASM file path (WeChat) or ArrayBuffer (Web)
     * @param imports - Import object
     */
    instantiateWasm(pathOrBuffer: string | ArrayBuffer, imports: WebAssembly.Imports): Promise<WasmInstantiateResult>;
}
type PlatformType = 'web' | 'wechat';

/**
 * Get the current platform adapter
 * @throws Error if platform not initialized
 */
declare function getPlatform(): PlatformAdapter;
/**
 * Check if platform is initialized
 */
declare function isPlatformInitialized(): boolean;
/**
 * Get platform type
 */
declare function getPlatformType(): 'web' | 'wechat' | null;
/**
 * Check if running on WeChat
 */
declare function isWeChat(): boolean;
/**
 * Check if running on Web
 */
declare function isWeb(): boolean;
declare function platformFetch(url: string, options?: PlatformRequestOptions): Promise<PlatformResponse>;
declare function platformReadFile(path: string): Promise<ArrayBuffer>;
declare function platformReadTextFile(path: string): Promise<string>;
declare function platformFileExists(path: string): Promise<boolean>;
declare function platformInstantiateWasm(pathOrBuffer: string | ArrayBuffer, imports: WebAssembly.Imports): Promise<WasmInstantiateResult>;

/**
 * @file    spine.ts
 * @brief   Spine animation control API
 */

/**
 * Spine event types
 */
type SpineEventType = 'start' | 'interrupt' | 'end' | 'complete' | 'dispose' | 'event';
/**
 * Spine event callback
 */
type SpineEventCallback = (event: SpineEvent) => void;
/**
 * Spine event data
 */
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
/**
 * Track entry info for animation queries
 */
interface TrackEntryInfo {
    animation: string;
    track: number;
    loop: boolean;
    timeScale: number;
    trackTime: number;
    animationTime: number;
    duration: number;
    isComplete: boolean;
}
/**
 * Controller for Spine skeletal animations
 *
 * @example
 * ```typescript
 * const spine = new SpineController(wasmModule);
 *
 * // Play animation
 * spine.play(entity, 'run', true);
 *
 * // Queue next animation
 * spine.addAnimation(entity, 'idle', true, 0.2);
 *
 * // Change skin
 * spine.setSkin(entity, 'warrior');
 *
 * // Get bone position for effects
 * const pos = spine.getBonePosition(entity, 'weapon');
 * if (pos) {
 *     spawnEffect(pos.x, pos.y);
 * }
 *
 * // Listen for events
 * spine.on(entity, 'event', (e) => {
 *     if (e.eventName === 'footstep') {
 *         playSound('footstep');
 *     }
 * });
 * ```
 */
declare class SpineController {
    private module_;
    private listeners_;
    constructor(wasmModule: any);
    /**
     * Plays an animation, replacing any current animation on the track
     * @param entity Target entity
     * @param animation Animation name
     * @param loop Whether to loop the animation
     * @param track Animation track (default 0)
     * @returns True if animation was set
     */
    play(entity: Entity, animation: string, loop?: boolean, track?: number): boolean;
    /**
     * Adds an animation to the queue
     * @param entity Target entity
     * @param animation Animation name
     * @param loop Whether to loop
     * @param delay Delay before starting (seconds)
     * @param track Animation track (default 0)
     * @returns True if animation was queued
     */
    addAnimation(entity: Entity, animation: string, loop?: boolean, delay?: number, track?: number): boolean;
    /**
     * Sets an empty animation to mix out the current animation
     * @param entity Target entity
     * @param mixDuration Duration of the mix out
     * @param track Animation track (default 0)
     */
    setEmptyAnimation(entity: Entity, mixDuration?: number, track?: number): void;
    /**
     * Clears all animations on a track
     * @param entity Target entity
     * @param track Animation track (default 0)
     */
    clearTrack(entity: Entity, track?: number): void;
    /**
     * Clears all tracks
     * @param entity Target entity
     */
    clearTracks(entity: Entity): void;
    /**
     * Sets the current skin
     * @param entity Target entity
     * @param skinName Skin name
     * @returns True if skin was set
     */
    setSkin(entity: Entity, skinName: string): boolean;
    /**
     * Gets available skin names
     * @param entity Target entity
     * @returns Array of skin names
     */
    getSkins(entity: Entity): string[];
    /**
     * Gets available animation names
     * @param entity Target entity
     * @returns Array of animation names
     */
    getAnimations(entity: Entity): string[];
    /**
     * Gets the current animation on a track
     * @param entity Target entity
     * @param track Animation track (default 0)
     * @returns Animation name or null
     */
    getCurrentAnimation(entity: Entity, track?: number): string | null;
    /**
     * Gets the duration of an animation
     * @param entity Target entity
     * @param animation Animation name
     * @returns Duration in seconds, or 0 if not found
     */
    getAnimationDuration(entity: Entity, animation: string): number;
    /**
     * Gets detailed track entry info
     * @param entity Target entity
     * @param track Animation track (default 0)
     * @returns Track entry info or null
     */
    getTrackEntry(entity: Entity, track?: number): TrackEntryInfo | null;
    /**
     * Gets world position of a bone
     * @param entity Target entity
     * @param boneName Bone name
     * @returns Position or null if not found
     */
    getBonePosition(entity: Entity, boneName: string): Vec2 | null;
    /**
     * Gets world rotation of a bone in degrees
     * @param entity Target entity
     * @param boneName Bone name
     * @returns Rotation in degrees or null
     */
    getBoneRotation(entity: Entity, boneName: string): number | null;
    /**
     * Sets the attachment for a slot
     * @param entity Target entity
     * @param slotName Slot name
     * @param attachmentName Attachment name (null to clear)
     */
    setAttachment(entity: Entity, slotName: string, attachmentName: string | null): void;
    /**
     * Registers an event callback
     * @param entity Target entity
     * @param type Event type
     * @param callback Callback function
     */
    on(entity: Entity, type: SpineEventType, callback: SpineEventCallback): void;
    /**
     * Unregisters an event callback
     * @param entity Target entity
     * @param type Event type
     * @param callback Callback function
     */
    off(entity: Entity, type: SpineEventType, callback: SpineEventCallback): void;
    /**
     * Removes all event listeners for an entity
     * @param entity Target entity
     */
    removeAllListeners(entity: Entity): void;
    private setupEventBridge;
    private dispatchEvent;
}
/**
 * Creates a SpineController instance
 * @param wasmModule The ESEngine WASM module
 * @returns SpineController instance
 */
declare function createSpineController(wasmModule: any): SpineController;

export { App, AssetPlugin, AssetServer, Assets, Camera, Canvas, Children, Commands, CommandsInstance, EntityCommands, INVALID_ENTITY, INVALID_TEXTURE, Input, LocalTransform, Mut, Parent, PreviewPlugin, Query, QueryInstance, Res, ResMut, ResMutInstance, Schedule, SpineAnimation, SpineController, Sprite, SystemRunner, Text, TextAlign, TextOverflow, TextPlugin, TextRenderer, TextVerticalAlign, Time, UIRect, Velocity, World, WorldTransform, assetPlugin, color, createSpineController, createWebApp, defineComponent, defineResource, defineSystem, defineTag, getPlatform, getPlatformType, isBuiltinComponent, isPlatformInitialized, isWeChat, isWeb, loadSceneData, loadSceneWithAssets, platformFetch, platformFileExists, platformInstantiateWasm, platformReadFile, platformReadTextFile, quat, textPlugin, updateCameraAspectRatio, vec2, vec3, vec4 };
export type { AnyComponentDef, AssetsData, BuiltinComponentDef, CameraData, CanvasData, ChildrenData, Color, CommandsDescriptor, ComponentData, ComponentDef, CppRegistry, CppResourceManager, ESEngineModule, Entity, InferParam, InferParams, InputState, LocalTransformData, MutWrapper, ParentData, PlatformAdapter, PlatformRequestOptions, PlatformResponse, PlatformType, Plugin, Quat, QueryDescriptor, QueryResult, ResDescriptor, ResMutDescriptor, ResourceDef, SceneComponentData, SceneData, SceneEntityData, SceneLoadOptions, SpineAnimationData, SpineEvent, SpineEventCallback, SpineEventType, SpriteData, SystemDef, SystemParam, TextData, TextRenderResult, TextureHandle, TextureInfo, TimeData, TrackEntryInfo, UIRectData, Vec2, Vec3, Vec4, VelocityData, WebAppOptions, WorldTransformData };
