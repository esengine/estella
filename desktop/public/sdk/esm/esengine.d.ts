declare const DEFAULT_DESIGN_WIDTH = 1920;
declare const DEFAULT_DESIGN_HEIGHT = 1080;
declare const DEFAULT_PIXELS_PER_UNIT = 100;
declare const DEFAULT_TEXT_CANVAS_SIZE = 512;
declare const RuntimeConfig: {
    sceneTransitionDuration: number;
    sceneTransitionColor: {
        r: number;
        g: number;
        b: number;
        a: number;
    };
    defaultFontFamily: string;
    canvasScaleMode: number;
    canvasMatchWidthOrHeight: number;
    maxDeltaTime: number;
    maxFixedSteps: number;
    textCanvasSize: number;
};
declare function applyRuntimeConfig(components: {
    Text?: {
        _default: Record<string, unknown>;
    };
    TextInput?: {
        _default: Record<string, unknown>;
    };
    Canvas?: {
        _default: Record<string, unknown>;
    };
}): void;

/**
 * @file    types.ts
 * @brief   Core type definitions for ESEngine SDK
 */
type Entity = number;
declare const INVALID_ENTITY: Entity;
type TextureHandle = number;
declare const INVALID_TEXTURE: TextureHandle;
type FontHandle = number;
declare const INVALID_FONT: FontHandle;
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
interface Color {
    r: number;
    g: number;
    b: number;
    a: number;
}
declare const vec2: (x?: number, y?: number) => Vec2;
declare const vec3: (x?: number, y?: number, z?: number) => Vec3;
declare const vec4: (x?: number, y?: number, z?: number, w?: number) => Vec4;
declare const color: (r?: number, g?: number, b?: number, a?: number) => Color;
declare const quat: (w?: number, x?: number, y?: number, z?: number) => Quat;

interface RigidBodyData {
    bodyType: number;
    gravityScale: number;
    linearDamping: number;
    angularDamping: number;
    fixedRotation: boolean;
    bullet: boolean;
    enabled: boolean;
}
interface BoxColliderData {
    halfExtents: Vec2;
    offset: Vec2;
    density: number;
    friction: number;
    restitution: number;
    isSensor: boolean;
    enabled: boolean;
}
interface CircleColliderData {
    radius: number;
    offset: Vec2;
    density: number;
    friction: number;
    restitution: number;
    isSensor: boolean;
    enabled: boolean;
}
interface CapsuleColliderData {
    radius: number;
    halfHeight: number;
    offset: Vec2;
    density: number;
    friction: number;
    restitution: number;
    isSensor: boolean;
    enabled: boolean;
}
declare const RigidBody$1: BuiltinComponentDef<RigidBodyData>;
declare const BoxCollider$1: BuiltinComponentDef<BoxColliderData>;
declare const CircleCollider$1: BuiltinComponentDef<CircleColliderData>;
declare const CapsuleCollider$1: BuiltinComponentDef<CapsuleColliderData>;
declare const BodyType: {
    readonly Static: 0;
    readonly Kinematic: 1;
    readonly Dynamic: 2;
};
type BodyType = (typeof BodyType)[keyof typeof BodyType];

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
interface CameraData {
    projectionType: number;
    fov: number;
    orthoSize: number;
    nearPlane: number;
    farPlane: number;
    aspectRatio: number;
    isActive: boolean;
    priority: number;
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
declare const LocalTransform$1: BuiltinComponentDef<LocalTransformData>;
declare const WorldTransform$1: BuiltinComponentDef<WorldTransformData>;
declare const Sprite$1: BuiltinComponentDef<SpriteData>;
declare const Camera$1: BuiltinComponentDef<CameraData>;
declare const Canvas$1: BuiltinComponentDef<CanvasData>;
declare const Velocity$1: BuiltinComponentDef<VelocityData>;
declare const Parent$1: BuiltinComponentDef<ParentData>;
declare const Children$1: BuiltinComponentDef<ChildrenData>;
declare const BitmapText$1: BuiltinComponentDef<BitmapTextData>;
declare const SpineAnimation$1: BuiltinComponentDef<SpineAnimationData>;
declare const Name: ComponentDef<NameData>;
declare const SceneOwner: ComponentDef<SceneOwnerData>;

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
 * @file    wasm.generated.ts
 * @brief   ESEngine WASM Bindings TypeScript Definitions
 * @details Generated by EHT - DO NOT EDIT
 */

interface UVec2 {
    x: number;
    y: number;
}
interface BoxCollider {
    halfExtents: Vec2;
    offset: Vec2;
    density: number;
    friction: number;
    restitution: number;
    isSensor: boolean;
    enabled: boolean;
}
interface CircleCollider {
    radius: number;
    offset: Vec2;
    density: number;
    friction: number;
    restitution: number;
    isSensor: boolean;
    enabled: boolean;
}
interface CapsuleCollider {
    radius: number;
    halfHeight: number;
    offset: Vec2;
    density: number;
    friction: number;
    restitution: number;
    isSensor: boolean;
    enabled: boolean;
}
interface LocalTransform {
    position: Vec3;
    rotation: Quat;
    scale: Vec3;
}
interface WorldTransform {
    position: Vec3;
    rotation: Quat;
    scale: Vec3;
}
interface Velocity {
    linear: Vec3;
    angular: Vec3;
}
interface SpineAnimation {
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
    enabled: boolean;
}
interface RigidBody {
    bodyType: number;
    gravityScale: number;
    linearDamping: number;
    angularDamping: number;
    fixedRotation: boolean;
    bullet: boolean;
    enabled: boolean;
}
interface BitmapText {
    text: string;
    color: Vec4;
    fontSize: number;
    align: number;
    spacing: number;
    layer: number;
    font: number;
    enabled: boolean;
}
interface Sprite {
    texture: number;
    color: Vec4;
    size: Vec2;
    uvOffset: Vec2;
    uvScale: Vec2;
    layer: number;
    flipX: boolean;
    flipY: boolean;
    material: number;
    enabled: boolean;
}
interface Parent {
    entity: number;
}
interface Children {
}
interface Canvas {
    designResolution: UVec2;
    pixelsPerUnit: number;
    scaleMode: number;
    matchWidthOrHeight: number;
    backgroundColor: Vec4;
}
interface Camera {
    projectionType: number;
    fov: number;
    orthoSize: number;
    nearPlane: number;
    farPlane: number;
    aspectRatio: number;
    isActive: boolean;
    priority: number;
    viewportX: number;
    viewportY: number;
    viewportW: number;
    viewportH: number;
    clearFlags: number;
}
interface Registry {
    create(): Entity;
    destroy(entity: Entity): void;
    valid(entity: Entity): boolean;
    entityCount(): number;
    hasBoxCollider(entity: Entity): boolean;
    getBoxCollider(entity: Entity): BoxCollider;
    addBoxCollider(entity: Entity, component: BoxCollider): void;
    removeBoxCollider(entity: Entity): void;
    hasCircleCollider(entity: Entity): boolean;
    getCircleCollider(entity: Entity): CircleCollider;
    addCircleCollider(entity: Entity, component: CircleCollider): void;
    removeCircleCollider(entity: Entity): void;
    hasCapsuleCollider(entity: Entity): boolean;
    getCapsuleCollider(entity: Entity): CapsuleCollider;
    addCapsuleCollider(entity: Entity, component: CapsuleCollider): void;
    removeCapsuleCollider(entity: Entity): void;
    hasLocalTransform(entity: Entity): boolean;
    getLocalTransform(entity: Entity): LocalTransform;
    addLocalTransform(entity: Entity, component: LocalTransform): void;
    removeLocalTransform(entity: Entity): void;
    hasWorldTransform(entity: Entity): boolean;
    getWorldTransform(entity: Entity): WorldTransform;
    addWorldTransform(entity: Entity, component: WorldTransform): void;
    removeWorldTransform(entity: Entity): void;
    hasVelocity(entity: Entity): boolean;
    getVelocity(entity: Entity): Velocity;
    addVelocity(entity: Entity, component: Velocity): void;
    removeVelocity(entity: Entity): void;
    hasSpineAnimation(entity: Entity): boolean;
    getSpineAnimation(entity: Entity): SpineAnimation;
    addSpineAnimation(entity: Entity, component: SpineAnimation): void;
    removeSpineAnimation(entity: Entity): void;
    hasRigidBody(entity: Entity): boolean;
    getRigidBody(entity: Entity): RigidBody;
    addRigidBody(entity: Entity, component: RigidBody): void;
    removeRigidBody(entity: Entity): void;
    hasBitmapText(entity: Entity): boolean;
    getBitmapText(entity: Entity): BitmapText;
    addBitmapText(entity: Entity, component: BitmapText): void;
    removeBitmapText(entity: Entity): void;
    hasSprite(entity: Entity): boolean;
    getSprite(entity: Entity): Sprite;
    addSprite(entity: Entity, component: Sprite): void;
    removeSprite(entity: Entity): void;
    hasParent(entity: Entity): boolean;
    getParent(entity: Entity): Parent;
    addParent(entity: Entity, component: Parent): void;
    removeParent(entity: Entity): void;
    hasChildren(entity: Entity): boolean;
    getChildren(entity: Entity): Children;
    addChildren(entity: Entity, component: Children): void;
    removeChildren(entity: Entity): void;
    hasCanvas(entity: Entity): boolean;
    getCanvas(entity: Entity): Canvas;
    addCanvas(entity: Entity, component: Canvas): void;
    removeCanvas(entity: Entity): void;
    hasCamera(entity: Entity): boolean;
    getCamera(entity: Entity): Camera;
    addCamera(entity: Entity, component: Camera): void;
    removeCamera(entity: Entity): void;
    setParent(child: Entity, parent: Entity): void;
}

/**
 * @file    wasm.ts
 * @brief   WASM module type definitions
 */

interface CppRegistry extends Registry {
    delete(): void;
    removeParent(entity: Entity): void;
    [key: string]: Function | undefined;
}
interface CppResourceManager {
    createTexture(width: number, height: number, pixels: number, pixelsLen: number, format: number, flipY: boolean): number;
    createShader(vertSrc: string, fragSrc: string): number;
    registerExternalTexture(glTextureId: number, width: number, height: number): number;
    getTextureGLId(handle: number): number;
    releaseTexture(handle: number): void;
    releaseShader(handle: number): void;
    setTextureMetadata(handle: number, left: number, right: number, top: number, bottom: number): void;
    registerTextureWithPath(handle: number, path: string): void;
    loadBitmapFont(fntContent: string, textureHandle: number, texWidth: number, texHeight: number): number;
    createLabelAtlasFont(textureHandle: number, texWidth: number, texHeight: number, chars: string, charWidth: number, charHeight: number): number;
    releaseBitmapFont(handle: number): void;
    measureBitmapText(fontHandle: number, text: string, fontSize: number, spacing: number): {
        width: number;
        height: number;
    };
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
    materialDataProvider?: (materialId: number, outShaderIdPtr: number, outBlendModePtr: number, outUniformBufferPtr: number, outUniformCountPtr: number) => void;
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
    getSpineBounds?(registry: CppRegistry, entity: number): SpineBounds;
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
    renderer_flush(): void;
    renderer_end(): void;
    renderer_submitSprites(registry: CppRegistry): void;
    renderer_submitBitmapText(registry: CppRegistry): void;
    renderer_submitSpine?(registry: CppRegistry): void;
    renderer_submitTriangles(verticesPtr: number, vertexCount: number, indicesPtr: number, indexCount: number, textureId: number, blendMode: number, transformPtr: number): void;
    renderer_setStage(stage: number): void;
    renderer_createTarget(width: number, height: number, flags: number): number;
    renderer_releaseTarget(handle: number): void;
    renderer_getTargetTexture(handle: number): number;
    renderer_getTargetDepthTexture(handle: number): number;
    renderer_getDrawCalls(): number;
    renderer_getTriangles(): number;
    renderer_getSprites(): number;
    renderer_getText(): number;
    renderer_getSpine?(): number;
    renderer_getMeshes(): number;
    renderer_getCulled(): number;
    renderer_setClearColor(r: number, g: number, b: number, a: number): void;
    renderer_setViewport(x: number, y: number, w: number, h: number): void;
    renderer_setScissor(x: number, y: number, w: number, h: number, enable: boolean): void;
    renderer_clearBuffers(flags: number): void;
    renderer_setEntityClipRect(entity: number, x: number, y: number, w: number, h: number): void;
    renderer_clearEntityClipRect(entity: number): void;
    renderer_clearAllClipRects(): void;
    renderer_clearStencil(): void;
    renderer_setEntityStencilMask(entity: number, refValue: number): void;
    renderer_setEntityStencilTest(entity: number, refValue: number): void;
    renderer_clearEntityStencilMask(entity: number): void;
    renderer_clearAllStencilMasks(): void;
    registry_getCanvasEntity(registry: CppRegistry): number;
    registry_getCameraEntities(registry: CppRegistry): number[];
    getChildEntities(registry: CppRegistry, entity: number): number[];
    gl_enableErrorCheck(enabled: boolean): void;
    gl_checkErrors(context: string): number;
    renderer_diagnose(): void;
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
    private entityComponents_;
    private queryPool_;
    private queryPoolIdx_;
    private worldVersion_;
    private queryCache_;
    private builtinMethodCache_;
    private iterationDepth_;
    connectCpp(cppRegistry: CppRegistry): void;
    disconnectCpp(): void;
    get hasCpp(): boolean;
    spawn(): Entity;
    despawn(entity: Entity): void;
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
    resetQueryPool(): void;
    getComponentTypes(entity: Entity): string[];
    getEntitiesWithComponents(components: AnyComponentDef[], withFilters?: AnyComponentDef[], withoutFilters?: AnyComponentDef[]): Entity[];
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
    private readonly actualComponents_;
    private readonly allRequired_;
    private readonly result_;
    private readonly mutData_;
    constructor(world: World, descriptor: QueryDescriptor<C>);
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
    private readonly argsCache_;
    constructor(world: World, resources: ResourceStorage);
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
}
type SpineRendererFn = (registry: {
    _cpp: CppRegistry;
}, elapsed: number) => void;
type MaskProcessorFn = (registry: CppRegistry, vp: Float32Array, viewportX: number, viewportY: number, viewportW: number, viewportH: number) => void;
declare class RenderPipeline {
    private spineRenderer_;
    private maskProcessor_;
    private lastWidth_;
    private lastHeight_;
    private activeScenes_;
    get spineRenderer(): SpineRendererFn | null;
    setSpineRenderer(fn: SpineRendererFn | null): void;
    get maskProcessor(): MaskProcessorFn | null;
    setMaskProcessor(fn: MaskProcessorFn | null): void;
    setActiveScenes(scenes: Set<string> | null): void;
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
type EditorAssetType = 'texture' | 'material' | 'shader' | 'spine-atlas' | 'spine-skeleton' | 'bitmap-font' | 'prefab' | 'json' | 'audio' | 'scene' | 'unknown';
interface AssetTypeEntry {
    extensions: string[];
    contentType: AssetContentType;
    editorType: EditorAssetType;
    addressableType: AddressableAssetType | null;
    wechatPackInclude: boolean;
    hasTransitiveDeps: boolean;
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
    loadBitmapFont(fontPath: string, baseUrl?: string): Promise<FontHandle>;
    getFont(fontPath: string): FontHandle | undefined;
    releaseFont(fontPath: string): void;
    private loadBmfontAsset;
    private loadFntFile;
    loadPrefab(path: string, baseUrl?: string): Promise<PrefabData>;
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
interface SceneLoadOptions {
    assetServer?: AssetServer;
    assetBaseUrl?: string;
}
type AssetFieldType = 'texture' | 'material' | 'font';
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
    addPostProcessPass(name: string, shader: ShaderHandle): number;
    removePostProcessPass(name: string): void;
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
    private loadPromises_;
    constructor(app: App);
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

interface Plugin {
    name?: string;
    dependencies?: ResourceDef<any>[];
    build(app: App): void;
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
    private readonly sortedSystemsCache_;
    private error_handler_;
    private system_error_handler_;
    private frame_paused_;
    private user_paused_;
    private step_pending_;
    private play_speed_;
    private constructor();
    static new(): App;
    addPlugin(plugin: Plugin): this;
    addSystemToSchedule(schedule: Schedule, system: SystemDef, options?: {
        runBefore?: string[];
        runAfter?: string[];
    }): this;
    addSystem(system: SystemDef): this;
    addStartupSystem(system: SystemDef): this;
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
    insertResource<T>(resource: ResourceDef<T>, value: T): this;
    getResource<T>(resource: ResourceDef<T>): T;
    hasResource<T>(resource: ResourceDef<T>): boolean;
    registerScene(config: SceneConfig): this;
    setInitialScene(name: string): this;
    run(): void;
    private mainLoop;
    quit(): void;
    private sortSystems;
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

declare class InputState {
    keysDown: Set<string>;
    keysPressed: Set<string>;
    keysReleased: Set<string>;
    mouseX: number;
    mouseY: number;
    mouseButtons: Set<number>;
    mouseButtonsPressed: Set<number>;
    mouseButtonsReleased: Set<number>;
    scrollDeltaX: number;
    scrollDeltaY: number;
    isKeyDown(key: string): boolean;
    isKeyPressed(key: string): boolean;
    isKeyReleased(key: string): boolean;
    getMousePosition(): {
        x: number;
        y: number;
    };
    isMouseButtonDown(button: number): boolean;
    isMouseButtonPressed(button: number): boolean;
    isMouseButtonReleased(button: number): boolean;
    getScrollDelta(): {
        x: number;
        y: number;
    };
}
declare const Input: ResourceDef<InputState>;
declare class InputPlugin implements Plugin {
    private target_;
    constructor(target?: unknown);
    build(app: App): void;
}
declare const inputPlugin: InputPlugin;

interface ColorTransition {
    normalColor: Color;
    hoveredColor: Color;
    pressedColor: Color;
    disabledColor: Color;
}
declare const FillDirection: {
    readonly LeftToRight: 0;
    readonly RightToLeft: 1;
    readonly BottomToTop: 2;
    readonly TopToBottom: 3;
};
type FillDirection = (typeof FillDirection)[keyof typeof FillDirection];

declare const TextAlign: {
    readonly Left: 0;
    readonly Center: 1;
    readonly Right: 2;
};
type TextAlign = (typeof TextAlign)[keyof typeof TextAlign];
declare const TextVerticalAlign: {
    readonly Top: 0;
    readonly Middle: 1;
    readonly Bottom: 2;
};
type TextVerticalAlign = (typeof TextVerticalAlign)[keyof typeof TextVerticalAlign];
declare const TextOverflow: {
    readonly Visible: 0;
    readonly Clip: 1;
    readonly Ellipsis: 2;
};
type TextOverflow = (typeof TextOverflow)[keyof typeof TextOverflow];
interface TextData {
    content: string;
    fontFamily: string;
    fontSize: number;
    color: Color;
    align: TextAlign;
    verticalAlign: TextVerticalAlign;
    wordWrap: boolean;
    overflow: TextOverflow;
    lineHeight: number;
}
declare const Text: ComponentDef<TextData>;

interface UIRectData {
    anchorMin: Vec2;
    anchorMax: Vec2;
    offsetMin: Vec2;
    offsetMax: Vec2;
    size: Vec2;
    pivot: Vec2;
    _dirty: boolean;
}
declare const UIRect: ComponentDef<UIRectData>;

/**
 * @file    TextRenderer.ts
 * @brief   Renders text to GPU textures using Canvas 2D API
 */

interface SizedRect {
    size: {
        x: number;
        y: number;
    };
}
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
    renderText(text: TextData, uiRect?: SizedRect | null): TextRenderResult;
    private truncateWithEllipsis;
    /**
     * Renders text for an entity and caches the result
     */
    renderForEntity(entity: Entity, text: TextData, uiRect?: SizedRect | null): TextRenderResult;
    /**
     * Gets cached render result for entity
     */
    getCached(entity: Entity): TextRenderResult | undefined;
    /**
     * Releases texture for entity
     */
    release(entity: Entity): void;
    cleanupOrphaned(isAlive: (entity: Entity) => boolean): void;
    /**
     * Releases all cached textures
     */
    releaseAll(): void;
    private measureWidth;
    private mapAlign;
}

/**
 * @file    TextPlugin.ts
 * @brief   Plugin that automatically syncs Text components to Sprite textures
 */

declare class TextPlugin implements Plugin {
    build(app: App): void;
}
declare const textPlugin: TextPlugin;

type MaskMode = 'scissor' | 'stencil';
interface UIMaskData {
    enabled: boolean;
    mode: MaskMode;
}
declare const UIMask: ComponentDef<UIMaskData>;

declare function createMaskProcessor(wasm: ESEngineModule, world: World): MaskProcessorFn;
declare class UIMaskPlugin implements Plugin {
    build(app: App): void;
}
declare const uiMaskPlugin: UIMaskPlugin;

interface ScreenRect {
    x: number;
    y: number;
    w: number;
    h: number;
}
declare function intersectRects(a: ScreenRect, b: ScreenRect): ScreenRect;
declare function worldRectToScreen(worldX: number, worldY: number, worldW: number, worldH: number, pivotX: number, pivotY: number, vp: Float32Array, vpX: number, vpY: number, vpW: number, vpH: number): ScreenRect;
declare function invertMatrix4(m: Float32Array, result?: Float32Array): Float32Array;
declare function screenToWorld(screenX: number, screenY: number, inverseVP: Float32Array, vpX: number, vpY: number, vpW: number, vpH: number): {
    x: number;
    y: number;
};
declare function pointInWorldRect(px: number, py: number, worldX: number, worldY: number, worldW: number, worldH: number, pivotX: number, pivotY: number): boolean;
declare function pointInOBB(px: number, py: number, worldX: number, worldY: number, worldW: number, worldH: number, pivotX: number, pivotY: number, rotationZ: number, rotationW: number): boolean;

interface InteractableData {
    enabled: boolean;
    blockRaycast: boolean;
    raycastTarget: boolean;
}
declare const Interactable: ComponentDef<InteractableData>;

interface UIInteractionData {
    hovered: boolean;
    pressed: boolean;
    justPressed: boolean;
    justReleased: boolean;
}
declare const UIInteraction: ComponentDef<UIInteractionData>;

type ButtonTransition = ColorTransition;
declare const ButtonState: {
    readonly Normal: 0;
    readonly Hovered: 1;
    readonly Pressed: 2;
    readonly Disabled: 3;
};
type ButtonState = (typeof ButtonState)[keyof typeof ButtonState];
interface ButtonData {
    state: ButtonState;
    transition: ColorTransition | null;
}
declare const Button: ComponentDef<ButtonData>;

type UIEventType = 'click' | 'press' | 'release' | 'hover_enter' | 'hover_exit' | 'focus' | 'blur' | 'submit' | 'change' | 'drag_start' | 'drag_move' | 'drag_end' | 'scroll';
interface UIEvent {
    entity: Entity;
    type: UIEventType;
    target: Entity;
    currentTarget: Entity;
}
declare class UIEventQueue {
    private events_;
    emit(entity: Entity, type: UIEventType, target?: Entity): void;
    drain(): UIEvent[];
    query(type: UIEventType): UIEvent[];
    hasEvent(entity: Entity, type: UIEventType): boolean;
}
declare const UIEvents: ResourceDef<UIEventQueue>;

interface UICameraData {
    viewProjection: Float32Array;
    vpX: number;
    vpY: number;
    vpW: number;
    vpH: number;
    screenW: number;
    screenH: number;
    worldLeft: number;
    worldBottom: number;
    worldRight: number;
    worldTop: number;
    worldMouseX: number;
    worldMouseY: number;
    valid: boolean;
}
declare const UICameraInfo: ResourceDef<UICameraData>;

declare const ScreenSpace: ComponentDef<{}>;

interface LayoutRect {
    left: number;
    bottom: number;
    right: number;
    top: number;
}
interface LayoutResult {
    centerX: number;
    centerY: number;
    width: number;
    height: number;
    rect: LayoutRect;
}
declare function computeUIRectLayout(anchorMin: {
    x: number;
    y: number;
}, anchorMax: {
    x: number;
    y: number;
}, offsetMin: {
    x: number;
    y: number;
}, offsetMax: {
    x: number;
    y: number;
}, size: {
    x: number;
    y: number;
}, parentRect: LayoutRect): LayoutResult;

declare class UILayoutPlugin implements Plugin {
    build(app: App): void;
}
declare const uiLayoutPlugin: UILayoutPlugin;

declare class UIInteractionPlugin implements Plugin {
    build(app: App): void;
}
declare const uiInteractionPlugin: UIInteractionPlugin;

interface TextInputData {
    value: string;
    placeholder: string;
    placeholderColor: Color;
    fontFamily: string;
    fontSize: number;
    color: Color;
    backgroundColor: Color;
    padding: number;
    maxLength: number;
    multiline: boolean;
    password: boolean;
    readOnly: boolean;
    focused: boolean;
    cursorPos: number;
    dirty: boolean;
}
declare const TextInput: ComponentDef<TextInputData>;

declare class TextInputPlugin implements Plugin {
    private cleanupListeners_;
    cleanup(): void;
    build(app: App): void;
}
declare const textInputPlugin: TextInputPlugin;

declare const ImageType: {
    readonly Simple: 0;
    readonly Sliced: 1;
    readonly Tiled: 2;
    readonly Filled: 3;
};
type ImageType = (typeof ImageType)[keyof typeof ImageType];
declare const FillMethod: {
    readonly Horizontal: 0;
    readonly Vertical: 1;
};
type FillMethod = (typeof FillMethod)[keyof typeof FillMethod];
declare const FillOrigin: {
    readonly Left: 0;
    readonly Right: 1;
    readonly Bottom: 2;
    readonly Top: 3;
};
type FillOrigin = (typeof FillOrigin)[keyof typeof FillOrigin];
interface ImageData {
    texture: number;
    color: Color;
    imageType: number;
    fillMethod: number;
    fillOrigin: number;
    fillAmount: number;
    preserveAspect: boolean;
    tileSize: {
        x: number;
        y: number;
    };
    layer: number;
    material: number;
    enabled: boolean;
}
declare const Image: ComponentDef<ImageData>;

type ToggleTransition = ColorTransition;
interface ToggleData {
    isOn: boolean;
    graphicEntity: Entity;
    group: Entity;
    transition: ColorTransition | null;
}
declare const Toggle: ComponentDef<ToggleData>;

declare const ProgressBarDirection: {
    readonly LeftToRight: 0;
    readonly RightToLeft: 1;
    readonly BottomToTop: 2;
    readonly TopToBottom: 3;
};
type ProgressBarDirection = FillDirection;
interface ProgressBarData {
    value: number;
    fillEntity: Entity;
    direction: FillDirection;
}
declare const ProgressBar: ComponentDef<ProgressBarData>;

interface DraggableData {
    enabled: boolean;
    dragThreshold: number;
    lockX: boolean;
    lockY: boolean;
    constraintMin: {
        x: number;
        y: number;
    } | null;
    constraintMax: {
        x: number;
        y: number;
    } | null;
}
declare const Draggable: ComponentDef<DraggableData>;
interface DragStateData {
    isDragging: boolean;
    startWorldPos: {
        x: number;
        y: number;
    };
    currentWorldPos: {
        x: number;
        y: number;
    };
    deltaWorld: {
        x: number;
        y: number;
    };
    totalDeltaWorld: {
        x: number;
        y: number;
    };
    pointerStartWorld: {
        x: number;
        y: number;
    };
}
declare const DragState: ComponentDef<DragStateData>;

interface ScrollViewData {
    contentEntity: Entity;
    horizontalEnabled: boolean;
    verticalEnabled: boolean;
    contentWidth: number;
    contentHeight: number;
    scrollX: number;
    scrollY: number;
    inertia: boolean;
    decelerationRate: number;
}
declare const ScrollView: ComponentDef<ScrollViewData>;

declare const SliderDirection: {
    readonly LeftToRight: 0;
    readonly RightToLeft: 1;
    readonly BottomToTop: 2;
    readonly TopToBottom: 3;
};
type SliderDirection = FillDirection;
interface SliderData {
    value: number;
    minValue: number;
    maxValue: number;
    direction: FillDirection;
    fillEntity: Entity;
    handleEntity: Entity;
    wholeNumbers: boolean;
}
declare const Slider: ComponentDef<SliderData>;

interface FocusableData {
    tabIndex: number;
    isFocused: boolean;
}
declare const Focusable: ComponentDef<FocusableData>;
declare class FocusManagerState {
    focusedEntity: Entity | null;
    focus(entity: Entity): Entity | null;
    blur(): Entity | null;
}
declare const FocusManager: ResourceDef<FocusManagerState>;

interface SafeAreaData {
    applyTop: boolean;
    applyBottom: boolean;
    applyLeft: boolean;
    applyRight: boolean;
}
declare const SafeArea: ComponentDef<SafeAreaData>;

type ListViewItemRenderer = (index: number, entity: Entity) => void;
interface ListViewData {
    itemHeight: number;
    itemCount: number;
    scrollY: number;
    overscan: number;
}
declare const ListView: ComponentDef<ListViewData>;

declare function setListViewRenderer(entity: Entity, renderer: ListViewItemRenderer): void;

interface DropdownData {
    options: string[];
    selectedIndex: number;
    isOpen: boolean;
    listEntity: Entity;
    labelEntity: Entity;
}
declare const Dropdown: ComponentDef<DropdownData>;

declare class AsyncCache<T> {
    private cache_;
    private pending_;
    getOrLoad(key: string, loader: () => Promise<T>, timeout?: number): Promise<T>;
    get(key: string): T | undefined;
    has(key: string): boolean;
    delete(key: string): boolean;
    clear(): void;
    clearAll(): void;
    values(): IterableIterator<T>;
}

type AssetsData = AssetServer;
declare const Assets: ResourceDef<AssetServer>;
declare class AssetPlugin implements Plugin {
    build(app: App): void;
}
declare const assetPlugin: AssetPlugin;

/**
 * @file    AssetRefCounter.ts
 * @brief   Optional asset reference counting for debugging and monitoring
 */
interface AssetRefInfo {
    assetPath: string;
    refCount: number;
    entities: number[];
}
declare class AssetRefCounter {
    private textureRefs_;
    private fontRefs_;
    private materialRefs_;
    addTextureRef(path: string, entity: number): void;
    removeTextureRef(path: string, entity: number): void;
    getTextureRefCount(path: string): number;
    getTextureRefs(path: string): number[];
    addFontRef(path: string, entity: number): void;
    removeFontRef(path: string, entity: number): void;
    getFontRefCount(path: string): number;
    getFontRefs(path: string): number[];
    addMaterialRef(path: string, entity: number): void;
    removeMaterialRef(path: string, entity: number): void;
    getMaterialRefCount(path: string): number;
    getMaterialRefs(path: string): number[];
    getAllTextureRefs(): AssetRefInfo[];
    getAllFontRefs(): AssetRefInfo[];
    getAllMaterialRefs(): AssetRefInfo[];
    removeAllRefsForEntity(entity: number): void;
    clear(): void;
    getTotalRefCount(): {
        textures: number;
        fonts: number;
        materials: number;
    };
}

/**
 * @file    index.ts
 * @brief   Asset module exports
 */

declare function registerEmbeddedAssets(app: App, assets: Record<string, string>): void;

/**
 * @file    scenePlugin.ts
 * @brief   Plugin that provides scene management capabilities
 */

declare const sceneManagerPlugin: Plugin;

/**
 * @file    sceneTransition.ts
 * @brief   Convenience wrapper for scene transitions
 */

interface TransitionConfig {
    duration: number;
    type: 'fade';
    color?: Color;
}
declare function transitionTo(app: App, targetScene: string, config: TransitionConfig): Promise<void>;

declare class PrefabServer {
    private readonly world_;
    private readonly assetServer_;
    constructor(world: World, assetServer: AssetServer);
    instantiate(pathOrAddress: string, options?: {
        baseUrl?: string;
        parent?: Entity;
        overrides?: PrefabOverride[];
    }): Promise<InstantiatePrefabResult>;
}
declare const Prefabs: ResourceDef<PrefabServer>;
declare class PrefabsPlugin implements Plugin {
    name: string;
    dependencies: ResourceDef<AssetServer>[];
    build(app: App): void;
}
declare const prefabsPlugin: PrefabsPlugin;

/**
 * @file    PhysicsModuleLoader.ts
 * @brief   Loads and initializes the Physics WASM module (standalone or side module)
 */
interface PhysicsWasmModule {
    _physics_init(gx: number, gy: number, timestep: number, substeps: number): void;
    _physics_shutdown(): void;
    _physics_createBody(entityId: number, bodyType: number, x: number, y: number, angle: number, gravityScale: number, linearDamping: number, angularDamping: number, fixedRotation: number, bullet: number): void;
    _physics_destroyBody(entityId: number): void;
    _physics_hasBody(entityId: number): number;
    _physics_addBoxShape(entityId: number, halfW: number, halfH: number, offX: number, offY: number, density: number, friction: number, restitution: number, isSensor: number): void;
    _physics_addCircleShape(entityId: number, radius: number, offX: number, offY: number, density: number, friction: number, restitution: number, isSensor: number): void;
    _physics_addCapsuleShape(entityId: number, radius: number, halfHeight: number, offX: number, offY: number, density: number, friction: number, restitution: number, isSensor: number): void;
    _physics_step(dt: number): void;
    _physics_setBodyTransform(entityId: number, x: number, y: number, angle: number): void;
    _physics_getDynamicBodyCount(): number;
    _physics_getDynamicBodyTransforms(): number;
    _physics_collectEvents(): void;
    _physics_getCollisionEnterCount(): number;
    _physics_getCollisionEnterBuffer(): number;
    _physics_getCollisionExitCount(): number;
    _physics_getCollisionExitBuffer(): number;
    _physics_getSensorEnterCount(): number;
    _physics_getSensorEnterBuffer(): number;
    _physics_getSensorExitCount(): number;
    _physics_getSensorExitBuffer(): number;
    _physics_applyForce(entityId: number, forceX: number, forceY: number): void;
    _physics_applyImpulse(entityId: number, impulseX: number, impulseY: number): void;
    _physics_setLinearVelocity(entityId: number, vx: number, vy: number): void;
    _physics_getLinearVelocity(entityId: number): number;
    _physics_setGravity(gx: number, gy: number): void;
    _physics_getGravity(): number;
    _physics_setAngularVelocity(entityId: number, omega: number): void;
    _physics_getAngularVelocity(entityId: number): number;
    _physics_applyTorque(entityId: number, torque: number): void;
    _physics_applyAngularImpulse(entityId: number, impulse: number): void;
    _physics_updateBodyProperties(entityId: number, bodyType: number, gravityScale: number, linearDamping: number, angularDamping: number, fixedRotation: number, bullet: number): void;
    HEAPF32: Float32Array;
    HEAPU8: Uint8Array;
    HEAPU32: Uint32Array;
    _malloc(size: number): number;
    _free(ptr: number): void;
}
type PhysicsModuleFactory = (config?: Record<string, unknown>) => Promise<PhysicsWasmModule>;
declare function loadPhysicsModule(wasmUrl: string, factory?: PhysicsModuleFactory): Promise<PhysicsWasmModule>;

/**
 * @file    runtimeLoader.ts
 * @brief   Runtime scene loader for builder targets (WeChat, Playable, etc.)
 */

interface RuntimeAssetProvider {
    loadPixels(ref: string): Promise<{
        width: number;
        height: number;
        pixels: Uint8Array;
    }>;
    loadPixelsRaw?(ref: string): Promise<{
        width: number;
        height: number;
        pixels: Uint8Array;
    }>;
    readText(ref: string): string | Promise<string>;
    readBinary(ref: string): Uint8Array | Promise<Uint8Array>;
    resolvePath(ref: string): string;
}
declare function loadRuntimeScene(app: App, module: ESEngineModule, sceneData: SceneData, provider: RuntimeAssetProvider, spineModule?: SpineWasmModule | null, physicsModule?: PhysicsWasmModule | null, physicsConfig?: {
    gravity?: Vec2;
    fixedTimestep?: number;
    subStepCount?: number;
}, manifest?: AddressableManifest | null, sceneName?: string): Promise<void>;
interface RuntimeSceneOptions {
    app: App;
    module: ESEngineModule;
    provider: RuntimeAssetProvider;
    spineModule?: SpineWasmModule | null;
    physicsModule?: PhysicsWasmModule | null;
    physicsConfig?: {
        gravity?: Vec2;
        fixedTimestep?: number;
        subStepCount?: number;
    };
    manifest?: AddressableManifest | null;
}
declare function createRuntimeSceneConfig(name: string, sceneData: SceneData, options: RuntimeSceneOptions): SceneConfig;

/**
 * @file    PreviewPlugin.ts
 * @brief   Plugin for editor preview functionality
 */

declare class PreviewPlugin implements Plugin {
    private sceneUrl_;
    private baseUrl_;
    private app_;
    private loadPromise_;
    private eventSource_;
    private onMessage_;
    private onError_;
    constructor(sceneUrl: string, baseUrl?: string);
    build(app: App): void;
    /**
     * @brief Wait for scene loading to complete
     */
    waitForReady(): Promise<void>;
    private loadRuntimeData;
    private ensureCamera;
    cleanup(): void;
    private setupHotReload;
    private reloadScene;
}

/**
 * @file    WebAssetProvider.ts
 * @brief   RuntimeAssetProvider for browser-based preview
 */

declare class WebAssetProvider implements RuntimeAssetProvider {
    private textCache_;
    private binaryCache_;
    private baseUrl_;
    constructor(baseUrl: string);
    prefetch(sceneData: SceneData): Promise<void>;
    readText(ref: string): string;
    readBinary(ref: string): Uint8Array;
    loadPixels(ref: string): Promise<{
        width: number;
        height: number;
        pixels: Uint8Array;
    }>;
    resolvePath(ref: string): string;
    private resolveUrl;
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
interface InputEventCallbacks {
    onKeyDown(code: string): void;
    onKeyUp(code: string): void;
    onPointerMove(x: number, y: number): void;
    onPointerDown(button: number, x: number, y: number): void;
    onPointerUp(button: number): void;
    onWheel(deltaX: number, deltaY: number): void;
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
    /**
     * Create a 2D canvas for offscreen rendering
     */
    createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas;
    /**
     * High-resolution timestamp in milliseconds
     */
    now(): number;
    /**
     * Create an Image element for loading textures
     */
    createImage(): HTMLImageElement;
    /**
     * Bind input events (keyboard, pointer, wheel)
     * @param callbacks - Event callbacks
     * @param target - Optional event target (canvas element)
     */
    bindInputEvents(callbacks: InputEventCallbacks, target?: unknown): void;
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
    text: number;
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
    flush(): void;
    end(): void;
    submitSprites(registry: {
        _cpp: CppRegistry;
    }): void;
    submitBitmapText(registry: {
        _cpp: CppRegistry;
    }): void;
    submitSpine(registry: {
        _cpp: CppRegistry;
    }): void;
    setStage(stage: RenderStage): void;
    createRenderTarget(width: number, height: number, flags?: number): RenderTargetHandle;
    releaseRenderTarget(handle: RenderTargetHandle): void;
    getTargetTexture(handle: RenderTargetHandle): number;
    getTargetDepthTexture(handle: RenderTargetHandle): number;
    setClearColor(r: number, g: number, b: number, a: number): void;
    setViewport(x: number, y: number, w: number, h: number): void;
    setScissor(x: number, y: number, w: number, h: number, enable: boolean): void;
    clearBuffers(flags: number): void;
    measureBitmapText(fontHandle: number, text: string, fontSize: number, spacing: number): {
        width: number;
        height: number;
    };
    getStats(): RenderStats;
};

interface RenderTextureOptions {
    width: number;
    height: number;
    depth?: boolean;
    filter?: 'nearest' | 'linear';
}
interface RenderTextureHandle {
    _handle: RenderTargetHandle;
    textureId: number;
    width: number;
    height: number;
}
declare const RenderTexture: {
    create(options: RenderTextureOptions): RenderTextureHandle;
    release(rt: RenderTextureHandle): void;
    resize(rt: RenderTextureHandle, width: number, height: number): RenderTextureHandle;
    begin(rt: RenderTextureHandle, viewProjection: Float32Array): void;
    end(): void;
    getDepthTexture(rt: RenderTextureHandle): number;
};

declare function setEditorMode(active: boolean): void;
declare function isEditor(): boolean;
declare function isRuntime(): boolean;

interface PhysicsPluginConfig {
    gravity?: Vec2;
    fixedTimestep?: number;
    subStepCount?: number;
}
interface CollisionEnterEvent {
    entityA: Entity;
    entityB: Entity;
    normalX: number;
    normalY: number;
    contactX: number;
    contactY: number;
}
interface SensorEvent {
    sensorEntity: Entity;
    visitorEntity: Entity;
}
interface PhysicsEventsData {
    collisionEnters: CollisionEnterEvent[];
    collisionExits: Array<{
        entityA: Entity;
        entityB: Entity;
    }>;
    sensorEnters: SensorEvent[];
    sensorExits: SensorEvent[];
}
declare const PhysicsEvents: ResourceDef<PhysicsEventsData>;
declare class PhysicsPlugin implements Plugin {
    private config_;
    private wasmUrl_;
    private factory_?;
    constructor(wasmUrl: string, config?: PhysicsPluginConfig, factory?: PhysicsModuleFactory);
    build(app: App): void;
}
declare class Physics {
    private module_;
    constructor(app: App);
    /** @internal */
    static _fromModule(module: PhysicsWasmModule): Physics;
    applyForce(entity: Entity, force: Vec2): void;
    applyImpulse(entity: Entity, impulse: Vec2): void;
    setLinearVelocity(entity: Entity, velocity: Vec2): void;
    getLinearVelocity(entity: Entity): Vec2;
    setGravity(gravity: Vec2): void;
    getGravity(): Vec2;
    setAngularVelocity(entity: Entity, omega: number): void;
    getAngularVelocity(entity: Entity): number;
    applyTorque(entity: Entity, torque: number): void;
    applyAngularImpulse(entity: Entity, impulse: number): void;
}

/**
 * @file    logger.ts
 * @brief   Centralized logging system for SDK
 */
declare enum LogLevel {
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3
}
interface LogEntry {
    timestamp: number;
    level: LogLevel;
    category: string;
    message: string;
    data?: unknown;
}
interface LogHandler {
    handle(entry: LogEntry): void;
}
declare class Logger {
    private handlers_;
    private minLevel_;
    constructor();
    setMinLevel(level: LogLevel): void;
    addHandler(handler: LogHandler): void;
    removeHandler(handler: LogHandler): void;
    clearHandlers(): void;
    debug(category: string, message: string, data?: unknown): void;
    info(category: string, message: string, data?: unknown): void;
    warn(category: string, message: string, data?: unknown): void;
    error(category: string, message: string, data?: unknown): void;
    private log;
}
declare function getLogger(): Logger;
declare function setLogLevel(level: LogLevel): void;
declare function debug(category: string, message: string, data?: unknown): void;
declare function info(category: string, message: string, data?: unknown): void;
declare function warn(category: string, message: string, data?: unknown): void;
declare function error(category: string, message: string, data?: unknown): void;

/**
 * @file    glDebug.ts
 * @brief   GL error checking API for debugging rendering issues
 */

declare function initGLDebugAPI(wasmModule: ESEngineModule): void;
declare function shutdownGLDebugAPI(): void;
declare const GLDebug: {
    enable(): void;
    disable(): void;
    check(context: string): number;
    diagnose(): void;
};

type WasmErrorHandler = (error: unknown, context: string) => void;
declare function setWasmErrorHandler(handler: WasmErrorHandler | null): void;

declare const uiPlugins: Plugin[];

declare function createWebApp(module: ESEngineModule, options?: WebAppOptions): App;

export { App, AssetPlugin, AssetRefCounter, AssetServer, Assets, AsyncCache, BitmapText$1 as BitmapText, BlendMode, BodyType, BoxCollider$1 as BoxCollider, Button, ButtonState, Camera$1 as Camera, Canvas$1 as Canvas, CapsuleCollider$1 as CapsuleCollider, Children$1 as Children, CircleCollider$1 as CircleCollider, ClearFlags, Commands, CommandsInstance, DEFAULT_DESIGN_HEIGHT, DEFAULT_DESIGN_WIDTH, DEFAULT_PIXELS_PER_UNIT, DEFAULT_TEXT_CANVAS_SIZE, DataType, DragState, Draggable, Draw, Dropdown, EntityCommands, FillMethod, FillOrigin, FocusManager, FocusManagerState, Focusable, GLDebug, Geometry, INVALID_ENTITY, INVALID_FONT, INVALID_TEXTURE, Image, ImageType, Input, InputPlugin, InputState, Interactable, ListView, LocalTransform$1 as LocalTransform, LogLevel, Logger, Material, MaterialLoader, Mut, Name, Parent$1 as Parent, Physics, PhysicsEvents, PhysicsPlugin, PostProcess, PrefabServer, Prefabs, PrefabsPlugin, PreviewPlugin, ProgressBar, ProgressBarDirection, ProjectionType, Query, QueryInstance, RenderPipeline, RenderStage, RenderTexture, Renderer, Res, ResMut, ResMutInstance, RigidBody$1 as RigidBody, RuntimeConfig, SafeArea, ScaleMode, SceneManager, SceneManagerState, SceneOwner, Schedule, ScreenSpace, ScrollView, ShaderSources, Slider, SliderDirection, SpineAnimation$1 as SpineAnimation, Sprite$1 as Sprite, SystemRunner, Text, TextAlign, TextInput, TextInputPlugin, TextOverflow, TextPlugin, TextRenderer, TextVerticalAlign, Time, Toggle, UICameraInfo, UIEventQueue, UIEvents, UIInteraction, UIInteractionPlugin, UILayoutPlugin, UIMask, UIMaskPlugin, UIRect, Velocity$1 as Velocity, WebAssetProvider, World, WorldTransform$1 as WorldTransform, addStartupSystem, addSystem, addSystemToSchedule, applyRuntimeConfig, assetPlugin, clearDrawCallbacks, clearUserComponents, color, computeUIRectLayout, createMaskProcessor, createRuntimeSceneConfig, createWebApp, debug, defineComponent, defineResource, defineSystem, defineTag, error, findEntityByName, flushPendingSystems, getAddressableType, getAddressableTypeByEditorType, getAllAssetExtensions, getAssetMimeType, getAssetTypeEntry, getComponent, getComponentAssetFields, getComponentDefaults, getCustomExtensions, getEditorType, getLogger, getPlatform, getPlatformType, getUserComponent, getWeChatPackOptions, info, initDrawAPI, initGLDebugAPI, initGeometryAPI, initMaterialAPI, initPostProcessAPI, initRendererAPI, inputPlugin, instantiatePrefab, intersectRects, invertMatrix4, isBuiltinComponent, isCustomExtension, isEditor, isKnownAssetExtension, isPlatformInitialized, isRuntime, isTextureRef, isWeChat, isWeb, loadComponent, loadPhysicsModule, loadRuntimeScene, loadSceneData, loadSceneWithAssets, looksLikeAssetPath, platformFetch, platformFileExists, platformInstantiateWasm, platformReadFile, platformReadTextFile, pointInOBB, pointInWorldRect, prefabsPlugin, quat, registerComponent, registerComponentAssetFields, registerDrawCallback, registerEmbeddedAssets, registerMaterialCallback, sceneManagerPlugin, screenToWorld, setEditorMode, setListViewRenderer, setLogLevel, setWasmErrorHandler, shutdownDrawAPI, shutdownGLDebugAPI, shutdownGeometryAPI, shutdownMaterialAPI, shutdownPostProcessAPI, shutdownRendererAPI, textInputPlugin, textPlugin, transitionTo, uiInteractionPlugin, uiLayoutPlugin, uiMaskPlugin, uiPlugins, unregisterComponent, unregisterDrawCallback, updateCameraAspectRatio, vec2, vec3, vec4, warn, worldRectToScreen, wrapSceneSystem };
export type { AddressableAssetType, AddressableManifest, AddressableManifestAsset, AddressableManifestGroup, AddressableResultMap, AnyComponentDef, AssetBundle, AssetContentType, AssetRefInfo, AssetTypeEntry, AssetsData, BitmapTextData, BoxColliderData, BuiltinComponentDef, ButtonData, ButtonTransition, CameraData, CameraRenderParams, CanvasData, CapsuleColliderData, ChildrenData, CircleColliderData, CollisionEnterEvent, Color, CommandsDescriptor, ComponentData, ComponentDef, CppRegistry, CppResourceManager, DragStateData, DraggableData, DrawAPI, DrawCallback, DropdownData, ESEngineModule, EditorAssetType, Entity, FileLoadOptions, FocusableData, FontHandle, GeometryHandle, GeometryOptions, ImageData, InferParam, InferParams, InstantiatePrefabOptions, InstantiatePrefabResult, InteractableData, LayoutRect, LayoutResult, ListViewData, ListViewItemRenderer, LoadedMaterial, LocalTransformData, LogEntry, LogHandler, MaskMode, MaskProcessorFn, MaterialAssetData, MaterialHandle, MaterialOptions, MutWrapper, NameData, ParentData, PhysicsEventsData, PhysicsModuleFactory, PhysicsPluginConfig, PhysicsWasmModule, PlatformAdapter, PlatformRequestOptions, PlatformResponse, PlatformType, Plugin, PrefabData, PrefabEntityData, PrefabOverride, ProgressBarData, Quat, QueryDescriptor, QueryResult, RenderParams, RenderStats, RenderTargetHandle, RenderTextureHandle, RenderTextureOptions, ResDescriptor, ResMutDescriptor, ResourceDef, RigidBodyData, RuntimeAssetProvider, RuntimeSceneOptions, SafeAreaData, SceneComponentData, SceneConfig, SceneContext, SceneData, SceneEntityData, SceneLoadOptions, SceneOwnerData, SceneStatus, ScreenRect, ScrollViewData, SensorEvent, ShaderHandle, ShaderLoader, SliceBorder$1 as SliceBorder, SliderData, SpineAnimationData, SpineDescriptor, SpineLoadResult, SpineRendererFn, SpriteData, SystemDef, SystemOptions, SystemParam, TextData, TextInputData, TextRenderResult, TextureHandle, TextureInfo, TextureRef, TimeData, ToggleData, ToggleTransition, TransitionConfig, TransitionOptions, UICameraData, UIEvent, UIEventType, UIInteractionData, UIMaskData, UIRectData, UniformValue, Vec2, Vec3, Vec4, VelocityData, VertexAttributeDescriptor, WebAppOptions, WorldTransformData };
