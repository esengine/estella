/**
 * @file    resource.ts
 * @brief   Resource system for global singleton data
 */
interface ResourceDef<T> {
    readonly _id: symbol;
    readonly _name: string;
    readonly _default: T;
}
interface ResDescriptor<T> {
    readonly _type: 'res';
    readonly _resource: ResourceDef<T>;
}
interface ResMutDescriptor<T> {
    readonly _type: 'res_mut';
    readonly _resource: ResourceDef<T>;
}

/**
 * @file    types.ts
 * @brief   Core type definitions for ESEngine SDK
 */
type Entity = number;
interface Vec2 {
    x: number;
    y: number;
}

/**
 * @file    PhysicsComponents.ts
 * @brief   Physics component definitions for TypeScript SDK
 */

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
}
interface CircleColliderData {
    radius: number;
    offset: Vec2;
    density: number;
    friction: number;
    restitution: number;
    isSensor: boolean;
}
interface CapsuleColliderData {
    radius: number;
    halfHeight: number;
    offset: Vec2;
    density: number;
    friction: number;
    restitution: number;
    isSensor: boolean;
}
declare const RigidBody: BuiltinComponentDef<RigidBodyData>;
declare const BoxCollider: BuiltinComponentDef<BoxColliderData>;
declare const CircleCollider: BuiltinComponentDef<CircleColliderData>;
declare const CapsuleCollider: BuiltinComponentDef<CapsuleColliderData>;
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
interface BuiltinComponentDef<T> {
    readonly _id: symbol;
    readonly _name: string;
    readonly _cppName: string;
    readonly _builtin: true;
    readonly _default: T;
}
type AnyComponentDef = ComponentDef<any> | BuiltinComponentDef<any>;

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
    addRigidBody?(entity: Entity, data: unknown): void;
    getRigidBody?(entity: Entity): unknown;
    hasRigidBody?(entity: Entity): boolean;
    removeRigidBody?(entity: Entity): void;
    addBoxCollider?(entity: Entity, data: unknown): void;
    getBoxCollider?(entity: Entity): unknown;
    hasBoxCollider?(entity: Entity): boolean;
    removeBoxCollider?(entity: Entity): void;
    addCircleCollider?(entity: Entity, data: unknown): void;
    getCircleCollider?(entity: Entity): unknown;
    hasCircleCollider?(entity: Entity): boolean;
    removeCircleCollider?(entity: Entity): void;
    addCapsuleCollider?(entity: Entity, data: unknown): void;
    getCapsuleCollider?(entity: Entity): unknown;
    hasCapsuleCollider?(entity: Entity): boolean;
    removeCapsuleCollider?(entity: Entity): void;
    setParent(child: Entity, parent: Entity): void;
    [key: string]: any;
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
    renderer_getSpine?(): number;
    renderer_getMeshes(): number;
    renderer_getCulled(): number;
    renderer_setClearColor(r: number, g: number, b: number, a: number): void;
    renderer_setViewport(x: number, y: number, w: number, h: number): void;
    renderer_setScissor(x: number, y: number, w: number, h: number, enable: boolean): void;
    renderer_clearBuffers(flags: number): void;
    registry_getCanvasEntity(registry: CppRegistry): number;
    registry_getCameraEntities(registry: CppRegistry): number[];
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
type QueryArg$1 = AnyComponentDef | MutWrapper<AnyComponentDef>;
interface QueryDescriptor<C extends readonly QueryArg$1[]> {
    readonly _type: 'query';
    readonly _components: C;
    readonly _mutIndices: number[];
    readonly _with: AnyComponentDef[];
    readonly _without: AnyComponentDef[];
}

/**
 * @file    commands.ts
 * @brief   Deferred entity/component operations
 */

interface CommandsDescriptor {
    readonly _type: 'commands';
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
interface SystemDef {
    readonly _id: symbol;
    readonly _params: readonly SystemParam[];
    readonly _fn: (...args: unknown[]) => void;
    readonly _name: string;
}

/**
 * @file    renderPipeline.ts
 * @brief   Unified render pipeline for runtime and editor
 */

type SpineRendererFn = (registry: {
    _cpp: CppRegistry;
}, elapsed: number) => void;

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
    private fixedTimestep_;
    private fixedAccumulator_;
    private module_;
    private pipeline_;
    private constructor();
    static new(): App;
    addPlugin(plugin: Plugin): this;
    addSystemToSchedule(schedule: Schedule, system: SystemDef): this;
    addSystem(system: SystemDef): this;
    addStartupSystem(system: SystemDef): this;
    connectCpp(cppRegistry: CppRegistry, module?: ESEngineModule): this;
    get wasmModule(): ESEngineModule | null;
    setSpineRenderer(fn: SpineRendererFn | null): void;
    get world(): World;
    setFixedTimestep(timestep: number): this;
    insertResource<T>(resource: ResourceDef<T>, value: T): this;
    getResource<T>(resource: ResourceDef<T>): T;
    hasResource<T>(resource: ResourceDef<T>): boolean;
    run(): void;
    private mainLoop;
    quit(): void;
    private runSchedule;
    private updateTime;
}

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
interface ESEngineMainModule {
    loadDynamicLibrary(binary: Uint8Array, opts: {
        loadAsync: boolean;
        allowUndefined: boolean;
    }): Promise<void>;
    cwrap(name: string, returnType: string | null, argTypes: string[]): (...args: unknown[]) => unknown;
    HEAPF32: Float32Array;
    HEAPU8: Uint8Array;
    HEAPU32: Uint32Array;
    _malloc(size: number): number;
    _free(ptr: number): void;
}
declare function loadPhysicsSideModule(wasmBinary: ArrayBuffer, mainModule: ESEngineMainModule): Promise<PhysicsWasmModule>;

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
declare const PhysicsAPI: ResourceDef<Physics>;
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

export { BodyType, BoxCollider, CapsuleCollider, CircleCollider, Physics, PhysicsAPI, PhysicsEvents, PhysicsPlugin, RigidBody, loadPhysicsModule, loadPhysicsSideModule };
export type { BoxColliderData, CapsuleColliderData, CircleColliderData, CollisionEnterEvent, ESEngineMainModule, PhysicsEventsData, PhysicsModuleFactory, PhysicsPluginConfig, PhysicsWasmModule, RigidBodyData, SensorEvent };
