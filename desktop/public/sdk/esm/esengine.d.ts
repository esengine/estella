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
    material: number;
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
    material: number;
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
    HEAPU32: Uint32Array;
    HEAPF32: Float32Array;
    FS: EmscriptenFS;
    addFunction(func: (...args: any[]) => any, signature: string): number;
    setMaterialCallback(callbackPtr: number): void;
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
    draw_begin(matrixPtr: number): void;
    draw_end(): void;
    draw_line(fromX: number, fromY: number, toX: number, toY: number, r: number, g: number, b: number, a: number, thickness: number): void;
    draw_rect(x: number, y: number, width: number, height: number, r: number, g: number, b: number, a: number, filled: boolean): void;
    draw_rectOutline(x: number, y: number, width: number, height: number, r: number, g: number, b: number, a: number, thickness: number): void;
    draw_circle(centerX: number, centerY: number, radius: number, r: number, g: number, b: number, a: number, filled: boolean, segments: number): void;
    draw_circleOutline(centerX: number, centerY: number, radius: number, r: number, g: number, b: number, a: number, thickness: number, segments: number): void;
    draw_texture(x: number, y: number, width: number, height: number, textureId: number, r: number, g: number, b: number, a: number): void;
    draw_textureRotated(x: number, y: number, width: number, height: number, rotation: number, textureId: number, r: number, g: number, b: number, a: number): void;
    draw_setLayer(layer: number): void;
    draw_setDepth(depth: number): void;
    draw_getDrawCallCount(): number;
    draw_getPrimitiveCount(): number;
    draw_setBlendMode(mode: number): void;
    draw_setDepthTest(enabled: boolean): void;
    draw_mesh(geometryHandle: number, shaderHandle: number, transformPtr: number): void;
    draw_meshWithUniforms(geometryHandle: number, shaderHandle: number, transformPtr: number, uniformsPtr: number, uniformCount: number): void;
    geometry_create(): number;
    geometry_init(handle: number, verticesPtr: number, vertexCount: number, layoutPtr: number, layoutCount: number, dynamic: boolean): void;
    geometry_setIndices16(handle: number, indicesPtr: number, indexCount: number): void;
    geometry_setIndices32(handle: number, indicesPtr: number, indexCount: number): void;
    geometry_updateVertices(handle: number, verticesPtr: number, vertexCount: number, offset: number): void;
    geometry_release(handle: number): void;
    geometry_isValid(handle: number): boolean;
    postprocess_init(width: number, height: number): boolean;
    postprocess_shutdown(): void;
    postprocess_resize(width: number, height: number): void;
    postprocess_addPass(name: string, shaderHandle: number): number;
    postprocess_removePass(name: string): void;
    postprocess_setPassEnabled(name: string, enabled: boolean): void;
    postprocess_isPassEnabled(name: string): boolean;
    postprocess_setUniformFloat(passName: string, uniform: string, value: number): void;
    postprocess_setUniformVec4(passName: string, uniform: string, x: number, y: number, z: number, w: number): void;
    postprocess_begin(): void;
    postprocess_end(): void;
    postprocess_getPassCount(): number;
    postprocess_isInitialized(): boolean;
    postprocess_setBypass(bypass: boolean): void;
    postprocess_isBypassed(): boolean;
    renderer_init(width: number, height: number): void;
    renderer_resize(width: number, height: number): void;
    renderer_begin(matrixPtr: number, targetHandle: number): void;
    renderer_end(): void;
    renderer_submitSprites(registry: CppRegistry): void;
    renderer_submitSpine(registry: CppRegistry): void;
    renderer_setStage(stage: number): void;
    renderer_createTarget(width: number, height: number): number;
    renderer_releaseTarget(handle: number): void;
    renderer_getTargetTexture(handle: number): number;
    renderer_getDrawCalls(): number;
    renderer_getTriangles(): number;
    renderer_getSprites(): number;
    renderer_getSpine(): number;
    renderer_getMeshes(): number;
    renderer_getCulled(): number;
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
    removeParent(entity: Entity): void;
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
type UniformValue = number | Vec2 | Vec3 | Vec4 | number[];
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
};
declare function registerMaterialCallback(): void;
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
    private pending_;
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
interface SliceBorder$1 {
    left: number;
    right: number;
    top: number;
    bottom: number;
}
interface TextureMetadata {
    version: string;
    type: 'texture';
    sliceBorder: SliceBorder$1;
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
declare function loadComponent(world: World, entity: Entity, compData: SceneComponentData): void;
declare function updateCameraAspectRatio(world: World, aspectRatio: number): void;

/**
 * @file    AssetServer.ts
 * @brief   Asset loading and caching system
 */

interface TextureInfo {
    handle: TextureHandle;
    width: number;
    height: number;
}
interface SliceBorder {
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
interface AssetManifest {
    textures?: string[];
    materials?: string[];
    spine?: SpineDescriptor[];
    json?: string[];
    text?: string[];
    binary?: string[];
}
interface AssetBundle {
    textures: Map<string, TextureInfo>;
    materials: Map<string, LoadedMaterial>;
    spine: Map<string, SpineLoadResult>;
    json: Map<string, unknown>;
    text: Map<string, string>;
    binary: Map<string, ArrayBuffer>;
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
    constructor(module: ESEngineModule);
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
    releaseTexture(source: string): void;
    releaseAll(): void;
    setTextureMetadata(handle: TextureHandle, border: SliceBorder): void;
    setTextureMetadataByPath(source: string, border: SliceBorder): boolean;
    loadSpine(skeletonPath: string, atlasPath: string, baseUrl?: string): Promise<SpineLoadResult>;
    isSpineLoaded(skeletonPath: string, atlasPath: string): boolean;
    loadMaterial(path: string, baseUrl?: string): Promise<LoadedMaterial>;
    getMaterial(path: string, baseUrl?: string): LoadedMaterial | undefined;
    hasMaterial(path: string, baseUrl?: string): boolean;
    loadShader(path: string): Promise<ShaderHandle>;
    loadJson<T = unknown>(path: string, options?: FileLoadOptions): Promise<T>;
    loadText(path: string, options?: FileLoadOptions): Promise<string>;
    loadBinary(path: string, options?: FileLoadOptions): Promise<ArrayBuffer>;
    loadScene(world: World, sceneData: SceneData): Promise<Map<number, Entity>>;
    loadAll(manifest: AssetManifest): Promise<AssetBundle>;
    private textureCacheKey;
    private loadTextureWithFlip;
    private loadTextureInternal;
    private loadImage;
    private createTextureFromImage;
    private unpremultiplyAlpha;
    private loadShaderInternal;
    private parseEsShader;
    private fetchJson;
    private fetchText;
    private fetchBinary;
    private writeToVirtualFS;
    private ensureVirtualDir;
    private resolveUrl;
    private createCanvas;
    private nextPowerOf2;
    private parseAtlasTextures;
}

declare class AsyncCache<T> {
    private cache_;
    private pending_;
    getOrLoad(key: string, loader: () => Promise<T>): Promise<T>;
    get(key: string): T | undefined;
    has(key: string): boolean;
    delete(key: string): boolean;
    clear(): void;
    values(): IterableIterator<T>;
}

type AssetsData = AssetServer;
declare const Assets: ResourceDef<AssetServer>;
declare class AssetPlugin implements Plugin {
    build(app: App): void;
}
declare const assetPlugin: AssetPlugin;

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

/**
 * @file    geometry.ts
 * @brief   Geometry API for custom mesh rendering
 * @details Provides geometry creation and management for custom shapes,
 *          particles, trails, and other procedural meshes.
 */

type GeometryHandle = number;
declare enum DataType {
    Float = 1,
    Float2 = 2,
    Float3 = 3,
    Float4 = 4,
    Int = 5,
    Int2 = 6,
    Int3 = 7,
    Int4 = 8
}
interface VertexAttributeDescriptor {
    name: string;
    type: DataType;
}
interface GeometryOptions {
    vertices: Float32Array;
    layout: VertexAttributeDescriptor[];
    indices?: Uint16Array | Uint32Array;
    dynamic?: boolean;
}
declare function initGeometryAPI(wasmModule: ESEngineModule): void;
declare function shutdownGeometryAPI(): void;
declare const Geometry: {
    /**
     * Creates a new geometry with vertices and optional indices.
     * @param options Geometry creation options
     * @returns Geometry handle
     */
    create(options: GeometryOptions): GeometryHandle;
    /**
     * Updates vertices of a dynamic geometry.
     * @param handle Geometry handle
     * @param vertices New vertex data
     * @param offset Offset in floats
     */
    updateVertices(handle: GeometryHandle, vertices: Float32Array, offset?: number): void;
    /**
     * Releases a geometry.
     * @param handle Geometry handle
     */
    release(handle: GeometryHandle): void;
    /**
     * Checks if a geometry handle is valid.
     * @param handle Geometry handle
     * @returns True if valid
     */
    isValid(handle: GeometryHandle): boolean;
    /**
     * Creates a unit quad geometry (1x1, centered at origin).
     * @returns Geometry handle
     */
    createQuad(width?: number, height?: number): GeometryHandle;
    /**
     * Creates a circle geometry.
     * @param radius Circle radius
     * @param segments Number of segments
     * @returns Geometry handle
     */
    createCircle(radius?: number, segments?: number): GeometryHandle;
    /**
     * Creates a polygon geometry from vertices.
     * @param points Array of {x, y} points
     * @returns Geometry handle
     */
    createPolygon(points: Array<{
        x: number;
        y: number;
    }>): GeometryHandle;
};

/**
 * @file    draw.ts
 * @brief   Immediate mode 2D drawing API
 * @details Provides simple drawing primitives (lines, rectangles, circles)
 *          with automatic batching. All draw commands are cleared each frame.
 */

declare function initDrawAPI(wasmModule: ESEngineModule): void;
declare function shutdownDrawAPI(): void;
interface DrawAPI {
    /**
     * Begins a new draw frame with the given view-projection matrix.
     * Must be called before any draw commands.
     */
    begin(viewProjection: Float32Array): void;
    /**
     * Ends the current draw frame and submits all commands.
     * Must be called after all draw commands.
     */
    end(): void;
    /**
     * Draws a line between two points.
     * @param from Start point
     * @param to End point
     * @param color RGBA color
     * @param thickness Line thickness in pixels (default: 1)
     */
    line(from: Vec2, to: Vec2, color: Color, thickness?: number): void;
    /**
     * Draws a filled or outlined rectangle.
     * @param position Center position
     * @param size Width and height
     * @param color RGBA color
     * @param filled If true draws filled, if false draws outline (default: true)
     */
    rect(position: Vec2, size: Vec2, color: Color, filled?: boolean): void;
    /**
     * Draws a rectangle outline.
     * @param position Center position
     * @param size Width and height
     * @param color RGBA color
     * @param thickness Line thickness in pixels (default: 1)
     */
    rectOutline(position: Vec2, size: Vec2, color: Color, thickness?: number): void;
    /**
     * Draws a filled or outlined circle.
     * @param center Center position
     * @param radius Circle radius
     * @param color RGBA color
     * @param filled If true draws filled, if false draws outline (default: true)
     * @param segments Number of segments for approximation (default: 32)
     */
    circle(center: Vec2, radius: number, color: Color, filled?: boolean, segments?: number): void;
    /**
     * Draws a circle outline.
     * @param center Center position
     * @param radius Circle radius
     * @param color RGBA color
     * @param thickness Line thickness in pixels (default: 1)
     * @param segments Number of segments for approximation (default: 32)
     */
    circleOutline(center: Vec2, radius: number, color: Color, thickness?: number, segments?: number): void;
    /**
     * Draws a textured quad.
     * @param position Center position
     * @param size Width and height
     * @param textureHandle GPU texture handle
     * @param tint Color tint (default: white)
     */
    texture(position: Vec2, size: Vec2, textureHandle: number, tint?: Color): void;
    /**
     * Draws a rotated textured quad.
     * @param position Center position
     * @param size Width and height
     * @param rotation Rotation angle in radians
     * @param textureHandle GPU texture handle
     * @param tint Color tint (default: white)
     */
    textureRotated(position: Vec2, size: Vec2, rotation: number, textureHandle: number, tint?: Color): void;
    /**
     * Sets the current render layer.
     * @param layer Layer index (higher layers render on top)
     */
    setLayer(layer: number): void;
    /**
     * Sets the current depth for sorting within a layer.
     * @param depth Z depth value
     */
    setDepth(depth: number): void;
    /**
     * Gets the number of draw calls in the current/last frame.
     */
    getDrawCallCount(): number;
    /**
     * Gets the number of primitives drawn in the current/last frame.
     */
    getPrimitiveCount(): number;
    /**
     * Sets the blend mode for subsequent draw operations.
     * @param mode The blend mode to use
     */
    setBlendMode(mode: BlendMode): void;
    /**
     * Enables or disables depth testing.
     * @param enabled True to enable depth testing
     */
    setDepthTest(enabled: boolean): void;
    /**
     * Draws a custom mesh with a shader.
     * @param geometry Geometry handle
     * @param shader Shader handle
     * @param transform Transform matrix (4x4, column-major)
     */
    drawMesh(geometry: GeometryHandle, shader: ShaderHandle, transform: Float32Array): void;
    /**
     * Draws a custom mesh with a material.
     * @param geometry Geometry handle
     * @param material Material handle
     * @param transform Transform matrix (4x4, column-major)
     */
    drawMeshWithMaterial(geometry: GeometryHandle, material: MaterialHandle, transform: Float32Array): void;
}
declare const Draw: DrawAPI;

/**
 * @file    postprocess.ts
 * @brief   Post-processing effects API
 * @details Provides full-screen post-processing effects like blur, vignette, etc.
 */

declare function initPostProcessAPI(wasmModule: ESEngineModule): void;
declare function shutdownPostProcessAPI(): void;
declare const PostProcess: {
    /**
     * Initializes the post-processing pipeline.
     * @param width Framebuffer width
     * @param height Framebuffer height
     * @returns True on success
     */
    init(width: number, height: number): boolean;
    /**
     * Shuts down the post-processing pipeline.
     */
    shutdown(): void;
    /**
     * Resizes the framebuffers.
     * @param width New width
     * @param height New height
     */
    resize(width: number, height: number): void;
    /**
     * Adds a post-processing pass.
     * @param name Unique name for the pass
     * @param shader Shader handle
     * @returns Pass index
     */
    addPass(name: string, shader: ShaderHandle): number;
    /**
     * Removes a pass by name.
     * @param name Pass name
     */
    removePass(name: string): void;
    /**
     * Enables or disables a pass.
     * @param name Pass name
     * @param enabled Whether to enable the pass
     */
    setEnabled(name: string, enabled: boolean): void;
    /**
     * Checks if a pass is enabled.
     * @param name Pass name
     * @returns True if enabled
     */
    isEnabled(name: string): boolean;
    /**
     * Sets a float uniform on a pass.
     * @param passName Pass name
     * @param uniform Uniform name
     * @param value Float value
     */
    setUniform(passName: string, uniform: string, value: number): void;
    /**
     * Sets a vec4 uniform on a pass.
     * @param passName Pass name
     * @param uniform Uniform name
     * @param value Vec4 value
     */
    setUniformVec4(passName: string, uniform: string, value: Vec4): void;
    /**
     * Begins rendering to the post-process pipeline.
     * Call this before rendering your scene.
     */
    begin(): void;
    /**
     * Ends and processes all passes.
     * Call this after rendering your scene.
     */
    end(): void;
    /**
     * Gets the number of passes.
     */
    getPassCount(): number;
    /**
     * Checks if the pipeline is initialized.
     */
    isInitialized(): boolean;
    /**
     * Sets bypass mode to skip FBO rendering entirely.
     * When bypassed, begin()/end() become no-ops and scene renders directly to screen.
     * Use this when no post-processing passes are needed for maximum performance.
     * @param bypass Whether to bypass the pipeline
     */
    setBypass(bypass: boolean): void;
    /**
     * Checks if bypass mode is enabled.
     * @returns True if bypassed
     */
    isBypassed(): boolean;
    /**
     * Creates a blur effect shader.
     * @returns Shader handle
     */
    createBlur(): ShaderHandle;
    /**
     * Creates a vignette effect shader.
     * @returns Shader handle
     */
    createVignette(): ShaderHandle;
    /**
     * Creates a grayscale effect shader.
     * @returns Shader handle
     */
    createGrayscale(): ShaderHandle;
    /**
     * Creates a chromatic aberration effect shader.
     * @returns Shader handle
     */
    createChromaticAberration(): ShaderHandle;
};

declare enum RenderStage {
    Background = 0,
    Opaque = 1,
    Transparent = 2,
    Overlay = 3
}
type RenderTargetHandle = number;
interface RenderStats {
    drawCalls: number;
    triangles: number;
    sprites: number;
    spine: number;
    meshes: number;
    culled: number;
}
declare function initRendererAPI(wasmModule: ESEngineModule): void;
declare function shutdownRendererAPI(): void;
declare const Renderer: {
    init(width: number, height: number): void;
    resize(width: number, height: number): void;
    begin(viewProjection: Float32Array, target?: RenderTargetHandle): void;
    end(): void;
    submitSprites(registry: {
        _cpp: CppRegistry;
    }): void;
    submitSpine(registry: {
        _cpp: CppRegistry;
    }): void;
    setStage(stage: RenderStage): void;
    createRenderTarget(width: number, height: number): RenderTargetHandle;
    releaseRenderTarget(handle: RenderTargetHandle): void;
    getTargetTexture(handle: RenderTargetHandle): number;
    getStats(): RenderStats;
};

declare function setEditorMode(active: boolean): void;
declare function isEditor(): boolean;
declare function isRuntime(): boolean;

export { App, AssetPlugin, AssetServer, Assets, AsyncCache, BlendMode, Camera, Canvas, Children, Commands, CommandsInstance, DataType, Draw, EntityCommands, Geometry, INVALID_ENTITY, INVALID_TEXTURE, Input, LocalTransform, Material, MaterialLoader, Mut, Parent, PostProcess, PreviewPlugin, Query, QueryInstance, RenderStage, Renderer, Res, ResMut, ResMutInstance, Schedule, ShaderSources, SpineAnimation, SpineController, Sprite, SystemRunner, Text, TextAlign, TextOverflow, TextPlugin, TextRenderer, TextVerticalAlign, Time, UIRect, Velocity, World, WorldTransform, assetPlugin, color, createSpineController, createWebApp, defineComponent, defineResource, defineSystem, defineTag, getComponentDefaults, getPlatform, getPlatformType, initDrawAPI, initGeometryAPI, initMaterialAPI, initPostProcessAPI, initRendererAPI, isBuiltinComponent, isEditor, isPlatformInitialized, isRuntime, isWeChat, isWeb, loadComponent, loadSceneData, loadSceneWithAssets, platformFetch, platformFileExists, platformInstantiateWasm, platformReadFile, platformReadTextFile, quat, registerMaterialCallback, setEditorMode, shutdownDrawAPI, shutdownGeometryAPI, shutdownMaterialAPI, shutdownPostProcessAPI, shutdownRendererAPI, textPlugin, updateCameraAspectRatio, vec2, vec3, vec4 };
export type { AnyComponentDef, AssetBundle, AssetManifest, AssetsData, BuiltinComponentDef, CameraData, CanvasData, ChildrenData, Color, CommandsDescriptor, ComponentData, ComponentDef, CppRegistry, CppResourceManager, DrawAPI, ESEngineModule, Entity, FileLoadOptions, GeometryHandle, GeometryOptions, InferParam, InferParams, InputState, LoadedMaterial, LocalTransformData, MaterialAssetData, MaterialHandle, MaterialOptions, MutWrapper, ParentData, PlatformAdapter, PlatformRequestOptions, PlatformResponse, PlatformType, Plugin, Quat, QueryDescriptor, QueryResult, RenderStats, RenderTargetHandle, ResDescriptor, ResMutDescriptor, ResourceDef, SceneComponentData, SceneData, SceneEntityData, SceneLoadOptions, ShaderHandle, ShaderLoader, SliceBorder, SpineAnimationData, SpineDescriptor, SpineEvent, SpineEventCallback, SpineEventType, SpineLoadResult, SpriteData, SystemDef, SystemParam, TextData, TextRenderResult, TextureHandle, TextureInfo, TimeData, TrackEntryInfo, UIRectData, UniformValue, Vec2, Vec3, Vec4, VelocityData, VertexAttributeDescriptor, WebAppOptions, WorldTransformData };
