import { b as CppResourceManager, T as TextureHandle, F as FontHandle, a as ESEngineModule, V as Vec2, E as Entity, C as CppRegistry, c as Color, d as Vec3, Q as Quat, e as Vec4 } from './wasm.js';

interface Backend {
    fetchBinary(path: string): Promise<ArrayBuffer>;
    fetchText(path: string): Promise<string>;
    resolveUrl(path: string): string;
    setBaseUrl?(url: string): void;
}

interface AtlasFrameInfo {
    atlas: string;
    frame: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    uvOffset: [number, number];
    uvScale: [number, number];
}
interface CatalogEntry {
    type: string;
    atlas?: string;
    frame?: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    uv?: {
        offset: [number, number];
        scale: [number, number];
    };
    deps?: string[];
    buildPath?: string;
}
interface CatalogData {
    version: number;
    entries: Record<string, CatalogEntry>;
    addresses?: Record<string, string>;
    labels?: Record<string, string[]>;
}
declare class Catalog {
    private entries_;
    private addresses_;
    private labels_;
    private constructor();
    static fromJson(data: CatalogData): Catalog;
    static empty(): Catalog;
    resolve(ref: string): string;
    getEntry(path: string): CatalogEntry | null;
    getAtlasFrame(path: string): AtlasFrameInfo | null;
    getBuildPath(path: string): string;
    getDeps(path: string): string[];
    getByLabel(label: string): string[];
    getAllLabels(): string[];
    hasEntry(path: string): boolean;
    hasAddress(address: string): boolean;
    get isEmpty(): boolean;
}

interface TextureResult {
    handle: TextureHandle;
    width: number;
    height: number;
}
interface SpineResult {
    skeletonHandle: number;
}
interface SpineLoadResult {
    success: boolean;
    error?: string;
}
interface MaterialResult {
    handle: number;
    shaderHandle: number;
}
interface FontResult {
    handle: FontHandle;
}
interface AudioResult {
    bufferId: string;
}
interface AnimClipResult {
    clipId: string;
}
interface TilemapResult {
    sourceId: string;
}
interface TimelineResult {
    timelineId: string;
}
interface PrefabResult {
    data: unknown;
}
interface LoadContext {
    backend: Backend;
    catalog: Catalog;
    resourceManager: CppResourceManager;
    loadTexture(path: string, flipY?: boolean): Promise<TextureResult>;
    loadText(path: string): Promise<string>;
    loadBinary(path: string): Promise<ArrayBuffer>;
}
interface AssetLoader<T> {
    readonly type: string;
    readonly extensions: string[];
    load(path: string, ctx: LoadContext): Promise<T>;
    unload(asset: T): void;
}

declare class TextureLoader implements AssetLoader<TextureResult> {
    readonly type = "texture";
    readonly extensions: string[];
    private module_;
    private canvas_;
    private ctx_;
    constructor(module: ESEngineModule);
    private ensureCanvas_;
    load(path: string, ctx: LoadContext): Promise<TextureResult>;
    loadRaw(path: string, ctx: LoadContext): Promise<TextureResult>;
    loadFromPixels(width: number, height: number, pixels: Uint8Array, flipY: boolean): Promise<TextureResult>;
    unload(asset: TextureResult): void;
    private loadWithFlip;
    private loadImage;
    private createTextureFromImage;
    private getWebGL2Context;
    private createTextureWebGL2;
    private createTextureFallback;
}

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
    _spine_setDefaultMix(skeletonHandle: number, duration: number): void;
    _spine_setMixDuration(skeletonHandle: number, fromAnim: number, toAnim: number, duration: number): void;
    _spine_setTrackAlpha(instanceId: number, track: number, alpha: number): void;
    _spine_enableEvents(instanceId: number): void;
    _spine_getEventCount(instanceId: number): number;
    _spine_getEventBuffer(): number;
    _spine_clearEvents(): void;
    _spine_getEventAnimationName(index: number): number;
    _spine_getEventName(index: number): number;
    _spine_getEventStringValue(index: number): number;
    _spine_setAttachment(instanceId: number, slotName: number, attachmentName: number): number;
    _spine_setIKTarget(instanceId: number, constraintName: number, targetX: number, targetY: number, mix: number): number;
    _spine_setSlotColor(instanceId: number, slotName: number, r: number, g: number, b: number, a: number): number;
    _spine_listConstraints(instanceId: number): number;
    _spine_getTransformConstraintMix(instanceId: number, name: number): number;
    _spine_setTransformConstraintMix(instanceId: number, name: number, rotate: number, x: number, y: number, scaleX: number, scaleY: number, shearY: number): number;
    _spine_getPathConstraintMix(instanceId: number, name: number): number;
    _spine_setPathConstraintMix(instanceId: number, name: number, position: number, spacing: number, rotate: number, x: number, y: number): number;
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
    setDefaultMix(skeletonHandle: number, duration: number): void;
    setMixDuration(skeletonHandle: number, fromAnim: string, toAnim: string, duration: number): void;
    setTrackAlpha(instanceId: number, track: number, alpha: number): void;
    enableEvents(instanceId: number): void;
    getEventCount(instanceId: number): number;
    getEventBuffer(): number;
    clearEvents(): void;
    getEventAnimationName(index: number): string;
    getEventName(index: number): string;
    getEventStringValue(index: number): string;
    setAttachment(instanceId: number, slotName: string, attachmentName: string): boolean;
    setIKTarget(instanceId: number, constraintName: string, targetX: number, targetY: number, mix: number): boolean;
    setSlotColor(instanceId: number, slotName: string, r: number, g: number, b: number, a: number): boolean;
    listConstraints(instanceId: number): string;
    getTransformConstraintMix(instanceId: number, name: string): string;
    setTransformConstraintMix(instanceId: number, name: string, rotate: number, x: number, y: number, scaleX: number, scaleY: number, shearY: number): boolean;
    getPathConstraintMix(instanceId: number, name: string): string;
    setPathConstraintMix(instanceId: number, name: string, position: number, spacing: number, rotate: number, x: number, y: number): boolean;
}
declare function wrapSpineModule(raw: SpineWasmModule): SpineWrappedAPI;
type SpineModuleFactory = (config?: Record<string, unknown>) => Promise<SpineWasmModule>;
interface SpineWasmProvider {
    loadJs(version: string): Promise<string>;
    loadWasm(version: string): Promise<ArrayBuffer>;
}
type SpineVersion = '3.8' | '4.1' | '4.2';
declare function createSpineFactories(provider: SpineWasmProvider): Map<SpineVersion, SpineModuleFactory>;
declare function loadSpineModule(wasmUrl: string, factory?: SpineModuleFactory): Promise<{
    raw: SpineWasmModule;
    api: SpineWrappedAPI;
}>;

/**
 * @file    SpineController.ts
 * @brief   Spine animation control for the modular Spine WASM module
 */

type SpineEventType = 'start' | 'interrupt' | 'end' | 'complete' | 'dispose' | 'event';
interface RawSpineEvent {
    type: number;
    track: number;
    floatValue: number;
    intValue: number;
    animationName: string;
    eventName: string;
    stringValue: string;
}
interface ConstraintList {
    ik: string[];
    transform: string[];
    path: string[];
}
interface TransformMixData {
    mixRotate: number;
    mixX: number;
    mixY: number;
    mixScaleX: number;
    mixScaleY: number;
    mixShearY: number;
}
interface PathMixData {
    position: number;
    spacing: number;
    mixRotate: number;
    mixX: number;
    mixY: number;
}
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
    setDefaultMix(skeletonHandle: number, duration: number): void;
    setMixDuration(skeletonHandle: number, fromAnim: string, toAnim: string, duration: number): void;
    setTrackAlpha(instanceId: number, track: number, alpha: number): void;
    setAttachment(instanceId: number, slotName: string, attachmentName: string): boolean;
    setIKTarget(instanceId: number, constraintName: string, targetX: number, targetY: number, mix: number): boolean;
    setSlotColor(instanceId: number, slotName: string, r: number, g: number, b: number, a: number): boolean;
    enableEvents(instanceId: number): void;
    collectEvents(instanceId: number): RawSpineEvent[];
    listConstraints(instanceId: number): ConstraintList;
    getTransformConstraintMix(instanceId: number, name: string): TransformMixData | null;
    setTransformConstraintMix(instanceId: number, name: string, mix: TransformMixData): boolean;
    getPathConstraintMix(instanceId: number, name: string): PathMixData | null;
    setPathConstraintMix(instanceId: number, name: string, mix: PathMixData): boolean;
    on(entity: Entity, type: SpineEventType, callback: SpineEventCallback): void;
    off(entity: Entity, type: SpineEventType, callback: SpineEventCallback): void;
    removeAllListeners(entity: Entity): void;
}

declare class SpineAssetLoader implements AssetLoader<SpineResult> {
    readonly type = "spine";
    readonly extensions: string[];
    private module_;
    private spineController_;
    private loaded_;
    private virtualFSPaths_;
    private skeletonHandles_;
    constructor(module: ESEngineModule);
    setSpineController(controller: SpineModuleController): void;
    getSkeletonHandle(cacheKey: string): number | undefined;
    isLoaded(cacheKey: string): boolean;
    load(skeletonPath: string, ctx: LoadContext): Promise<SpineResult>;
    loadWithAtlas(skeletonPath: string, atlasPath: string, ctx: LoadContext): Promise<SpineResult>;
    unload(_asset: SpineResult): void;
    releaseAll(): void;
    private writeToVirtualFS;
    private cleanupVirtualFS;
}

type ReleaseCallback = () => void;

interface AssetsOptions {
    backend: Backend;
    catalog?: Catalog;
    module: ESEngineModule;
}
interface AssetBundle {
    textures: Map<string, TextureResult>;
    materials: Map<string, MaterialResult>;
    spine: Map<string, SpineResult>;
    fonts: Map<string, FontResult>;
}
interface SceneAssetResult {
    textureHandles: Map<string, number>;
    materialHandles: Map<string, number>;
    fontHandles: Map<string, number>;
    releaseCallbacks: ReleaseCallback[];
}
type AssetRefResolver = (ref: string) => string | null;
declare class Assets {
    readonly backend: Backend;
    readonly catalog: Catalog;
    get baseUrl(): string | undefined;
    set baseUrl(url: string | undefined);
    private baseUrl_?;
    private module_;
    private loaders_;
    private textureLoader_;
    private spineLoader_;
    private textureCache_;
    private textureRefCounts_;
    private genericCache_;
    private loadContext_;
    private assetRefResolver_;
    private constructor();
    static create(options: AssetsOptions): Assets;
    register<T>(loader: AssetLoader<T>): void;
    getLoader<T>(type: string): AssetLoader<T> | undefined;
    loadTexture(ref: string): Promise<TextureResult>;
    loadTextureRaw(ref: string): Promise<TextureResult>;
    getTexture(ref: string): TextureResult | undefined;
    loadSpine(skeletonRef: string, atlasRef?: string): Promise<SpineResult>;
    loadMaterial(ref: string): Promise<MaterialResult>;
    loadFont(ref: string): Promise<FontResult>;
    loadAudio(ref: string): Promise<AudioResult>;
    loadAnimClip(ref: string): Promise<AnimClipResult>;
    loadTilemap(ref: string): Promise<TilemapResult>;
    loadTimeline(ref: string): Promise<TimelineResult>;
    loadPrefab(ref: string): Promise<PrefabResult>;
    load<T>(type: string, ref: string): Promise<T>;
    getAtlasFrame(ref: string): AtlasFrameInfo | null;
    loadByLabel(label: string, onProgress?: (loaded: number, total: number) => void): Promise<AssetBundle>;
    fetchJson<T = unknown>(ref: string): Promise<T>;
    fetchBinary(ref: string): Promise<ArrayBuffer>;
    fetchText(ref: string): Promise<string>;
    preloadSceneAssets(sceneData: SceneData, onProgress?: (loaded: number, total: number) => void): Promise<SceneAssetResult>;
    resolveSceneAssetPaths(sceneData: SceneData, result: SceneAssetResult): void;
    releaseTexture(ref: string): void;
    releaseFont(ref: string): void;
    private releaseTyped;
    releaseAll(): void;
    setSpineController(controller: SpineModuleController): void;
    getSpineLoader(): SpineAssetLoader;
    getTextureLoader(): TextureLoader;
    setAssetRefResolver(resolver: AssetRefResolver): void;
    getAssetRefResolver(): AssetRefResolver | null;
    private materialLoader_;
    private registerBuiltinLoaders;
    private textureCacheKey_;
    private loadTyped;
    private getLoadContext_;
}

/**
 * @file    BuiltinBridge.ts
 * @brief   C++ Registry integration layer for builtin components
 */

type PtrFieldType = 'f32' | 'i32' | 'u32' | 'bool' | 'u8' | 'vec2' | 'vec3' | 'vec4' | 'quat' | 'color';
interface PtrFieldDesc {
    readonly name: string;
    readonly type: PtrFieldType;
    readonly offset: number;
}
declare function readPtrField(f32: Float32Array, u32: Uint32Array, u8: Uint8Array, ptr: number, field: PtrFieldDesc): unknown;
interface XY {
    x: number;
    y: number;
}
interface XYZ {
    x: number;
    y: number;
    z: number;
}
interface XYZW {
    x: number;
    y: number;
    z: number;
    w: number;
}
interface RGBA {
    r: number;
    g: number;
    b: number;
    a: number;
}
type PtrFieldValue = number | boolean | XY | XYZ | XYZW | RGBA;
declare function writePtrField(f32: Float32Array, u32: Uint32Array, u8: Uint8Array, ptr: number, field: PtrFieldDesc, value: PtrFieldValue | unknown): void;
interface BuiltinMethods {
    add: (e: Entity, d: unknown) => void;
    get: (e: Entity) => unknown;
    has: (e: Entity) => boolean;
    remove: (e: Entity) => void;
}
declare class BuiltinBridge {
    private cppRegistry_;
    private module_;
    private builtinMethodCache_;
    private builtinEntitySets_;
    connect(cppRegistry: CppRegistry, module?: ESEngineModule): void;
    disconnect(): void;
    get hasCpp(): boolean;
    getCppRegistry(): CppRegistry | null;
    getWasmModule(): ESEngineModule | null;
    getBuiltinMethods(cppName: string): BuiltinMethods;
    getMethodCache(): Map<string, BuiltinMethods>;
    getEntitySet(cppName: string): Set<Entity> | undefined;
    getOrCreateEntitySet(cppName: string): Set<Entity>;
    deleteFromEntitySets(entity: Entity): void;
    insert<T>(entity: Entity, component: BuiltinComponentDef<T>, data?: Partial<T>): {
        merged: T;
        isNew: boolean;
    };
    get<T>(entity: Entity, component: BuiltinComponentDef<T>): T;
    has(entity: Entity, component: BuiltinComponentDef<any>): boolean;
    remove(entity: Entity, component: BuiltinComponentDef<any>): void;
    resolvePtrFn(cppName: string): ((entity: Entity) => number) | null;
    resolvePtrSetter(cppName: string): ((entity: Entity, data: unknown) => void) | null;
    resolvePtrGetter(cppName: string): ((entity: Entity) => unknown) | null;
}

/**
 * @file    ChangeTracker.ts
 * @brief   Tracks per-component add/change/remove ticks for change detection queries
 */

declare class ChangeTracker {
    private worldTick_;
    private componentAddedTicks_;
    private componentChangedTicks_;
    private componentRemovedBuffer_;
    private trackedComponents_;
    advanceTick(): void;
    getWorldTick(): number;
    enableChangeTracking(component: AnyComponentDef): void;
    isAddedSince(entity: Entity, component: AnyComponentDef, sinceTick: number): boolean;
    isChangedSince(entity: Entity, component: AnyComponentDef, sinceTick: number): boolean;
    getRemovedEntitiesSince(component: AnyComponentDef, sinceTick: number): Entity[];
    cleanRemovedBuffer(beforeTick: number): void;
    recordAdded(component: AnyComponentDef, entity: Entity): void;
    recordChanged(component: AnyComponentDef, entity: Entity): void;
    recordRemoved(component: AnyComponentDef, entity: Entity): void;
    recordRemovedById(componentId: symbol, entity: Entity): void;
}

/**
 * @file    QueryCache.ts
 * @brief   Component-aware query result cache with fine-grained invalidation
 */

declare class QueryCache {
    private structuralVersion_;
    private componentVersions_;
    private cache_;
    get structuralVersion(): number;
    markStructuralChange(): void;
    markComponentDirty(componentId: symbol): void;
    invalidateAll(): void;
    getOrCompute(cacheKey: string, dependentComponentIds: symbol[], computeFn: () => Entity[]): Entity[];
    private isValid_;
}

/**
 * @file    world.ts
 * @brief   ECS World with C++ Registry integration
 */

declare class World {
    private readonly builtin_;
    private readonly scripts_;
    private readonly names_;
    readonly changes_: ChangeTracker;
    readonly queries_: QueryCache;
    private entities_;
    private iterationDepth_;
    private nextEntityId_;
    private nextGeneration_;
    private spawnCallbacks_;
    private despawnCallbacks_;
    get builtin(): BuiltinBridge;
    connectCpp(cppRegistry: CppRegistry, module?: ESEngineModule): void;
    disconnectCpp(): void;
    get hasCpp(): boolean;
    getCppRegistry(): CppRegistry | null;
    /** @internal */
    getWasmModule(): ESEngineModule | null;
    spawn(name?: string): Entity;
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
    private insertBuiltin_;
    private insertScript_;
    private removeScript_;
    findEntityByName(name: string): Entity | null;
    /** @internal Pre-resolve a component to its direct storage/getter for fast iteration. */
    resolveGetter(component: AnyComponentDef): ((entity: Entity) => unknown) | null;
    /** @internal Pre-resolve a component to a direct has-check for fast query matching. */
    resolveHas(component: AnyComponentDef): ((entity: Entity) => boolean) | null;
    /** @internal Pre-resolve a component to a direct setter for fast Mut write-back. */
    resolveSetter(component: AnyComponentDef): ((entity: Entity, data: unknown) => void) | null;
    resetQueryPool(): void;
    getComponentTypes(entity: Entity): string[];
    private resolveStorages_;
    private collectComponentIds_;
    getEntitiesWithComponents(components: AnyComponentDef[], withFilters?: AnyComponentDef[], withoutFilters?: AnyComponentDef[], precomputedKey?: string): Entity[];
    advanceTick(): void;
    getWorldTick(): number;
    enableChangeTracking(component: AnyComponentDef): void;
    isAddedSince(entity: Entity, component: AnyComponentDef, sinceTick: number): boolean;
    isChangedSince(entity: Entity, component: AnyComponentDef, sinceTick: number): boolean;
    getRemovedEntitiesSince(component: AnyComponentDef, sinceTick: number): Entity[];
    cleanRemovedBuffer(beforeTick: number): void;
    /** @internal Mark component as changed without writing data (for in-place Mut query) */
    markChanged(entity: Entity, component: AnyComponentDef): void;
}

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
    texturePaths: Set<string>;
    materialHandles: Set<number>;
    fontPaths: Set<string>;
    spineKeys: Set<string>;
}
type SceneLoadProgressCallback = (loaded: number, total: number) => void;
interface SceneLoadOptions {
    assets?: Assets;
    assetBaseUrl?: string;
    collectAssets?: LoadedSceneAssets;
    onProgress?: SceneLoadProgressCallback;
}
type AssetFieldType = 'texture' | 'material' | 'font' | 'anim-clip' | 'audio' | 'tilemap' | 'timeline';
declare function getComponentAssetFields(componentType: string): string[];
declare function getComponentAssetFieldDescriptors(componentType: string): readonly {
    field: string;
    type: AssetFieldType;
}[];
declare function getComponentSpineFieldDescriptor(componentType: string): {
    skeletonField: string;
    atlasField: string;
} | null;
declare function remapEntityFields(compData: SceneComponentData, entityMap: Map<number, Entity>): void;
declare function loadSceneData(world: World, sceneData: SceneData): Map<number, Entity>;
declare function loadSceneWithAssets(world: World, sceneData: SceneData, options?: SceneLoadOptions): Promise<Map<number, Entity>>;
declare function loadComponent(world: World, entity: Entity, compData: SceneComponentData, entityName?: string): void;
declare function updateCameraAspectRatio(world: World, aspectRatio: number): void;
declare function findEntityByName(world: World, name: string): Entity | null;

/**
 * @file    component.generated.ts
 * @brief   Auto-generated component metadata
 * @details Generated by EHT - DO NOT EDIT
 */

interface AssetFieldMeta {
    field: string;
    type: AssetFieldType;
}
interface SpineFieldMeta {
    skeletonField: string;
    atlasField: string;
}

/**
 * @file    component.ts
 * @brief   Component definition and builtin components
 */

interface AssetRef {
    type: string;
    path: string;
}
interface ComponentMetadata {
    assetFields?: AssetFieldMeta[];
    spineFields?: SpineFieldMeta;
    entityFields?: string[];
    discoverAssets?: (data: Record<string, unknown>) => AssetRef[];
}
interface ComponentDef<T> {
    readonly _id: symbol;
    readonly _name: string;
    readonly _default: T;
    readonly _builtin: false;
    readonly assetFields: readonly AssetFieldMeta[];
    readonly spineFields?: SpineFieldMeta;
    readonly entityFields: readonly string[];
    readonly colorKeys: readonly string[];
    readonly animatableFields: readonly string[];
    readonly discoverAssets?: (data: Record<string, unknown>) => AssetRef[];
    create(data?: Partial<T>): T;
}
declare function defineComponent<T extends object>(name: string, defaults: T, metadata?: ComponentMetadata): ComponentDef<T>;
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
    readonly assetFields: readonly AssetFieldMeta[];
    readonly spineFields?: SpineFieldMeta;
    readonly entityFields: readonly string[];
    readonly colorKeys: readonly string[];
    readonly animatableFields: readonly string[];
    readonly discoverAssets?: (data: Record<string, unknown>) => AssetRef[];
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
    readonly ShowAll: 2;
    readonly NoBorder: 3;
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
    pivot: Vec2;
    uvOffset: Vec2;
    uvScale: Vec2;
    layer: number;
    flipX: boolean;
    flipY: boolean;
    tileSize: Vec2;
    tileSpacing: Vec2;
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
declare const Disabled: ComponentDef<{}>;
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
    private ticks_;
    private globalTick_;
    private nameRegistry_;
    insert<T>(resource: ResourceDef<T>, value: T): void;
    get<T>(resource: ResourceDef<T>): T;
    set<T>(resource: ResourceDef<T>, value: T): void;
    has<T>(resource: ResourceDef<T>): boolean;
    remove<T>(resource: ResourceDef<T>): void;
    getChangeTick(resource: ResourceDef<unknown>): number;
    getByName(name: string): ResourceDef<unknown> | undefined;
    getRegisteredNames(): string[];
    getResMut<T>(resource: ResourceDef<T>): ResMutInstance<T>;
}
interface TimeData {
    delta: number;
    elapsed: number;
    frameCount: number;
}
declare const Time: ResourceDef<TimeData>;

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
    private readonly spawnName_?;
    private isNew_;
    constructor(commands: CommandsInstance, entity: Entity | null, name?: string);
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
    spawn(name?: string): EntityCommands;
    entity(entity: Entity): EntityCommands;
    despawn(entity: Entity): this;
    insertResource<T>(resource: ResourceDef<T>, value: T): this;
    queueInsert(entity: Entity, component: AnyComponentDef, data: unknown): void;
    queueRemove(entity: Entity, component: AnyComponentDef): void;
    spawnImmediate(components: SpawnComponentEntry[], entityRef: {
        entity: Entity;
    }, name?: string): void;
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
    readonly _fn: (...args: never[]) => void | Promise<void>;
    readonly _name: string;
}
interface SystemOptions {
    name?: string;
    runBefore?: string[];
    runAfter?: string[];
}
declare function defineSystem<P extends readonly SystemParam[]>(params: [...P], fn: (...args: InferParams<P>) => void | Promise<void>, options?: SystemOptions): SystemDef;
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
    /** @brief Clear timing data for the current frame */
    clearTimings(): void;
    /** @brief Remove cached state for a single system */
    evict(systemId: symbol): void;
    /** @brief Clear all cached state */
    reset(): void;
    run(system: SystemDef): void | Promise<void>;
    private flushSystem_;
    private resolveParam;
}

/**
 * @file    renderPipeline.ts
 * @brief   Unified render pipeline for runtime and editor
 */

interface Viewport {
    x: number;
    y: number;
    w: number;
    h: number;
}
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
    viewportPixels: Viewport;
    clearFlags: number;
    elapsed: number;
    cameraEntity?: Entity;
}
declare class RenderPipeline {
    private lastWidth_;
    private lastHeight_;
    private activeScenes_;
    private preFlushCallbacks_;
    setActiveScenes(scenes: Set<string> | null): void;
    addPreFlushCallback(cb: (registry: {
        _cpp: CppRegistry;
    }) => void): void;
    beginFrame(): void;
    beginScreenCapture(): void;
    endScreenCapture(): void;
    submitScene(registry: {
        _cpp: CppRegistry;
    }, viewProjection: Float32Array, viewport: Viewport, _elapsed: number): void;
    render(params: RenderParams): void;
    renderCamera(params: CameraRenderParams): void;
    private executeDrawCallbacks;
}

/**
 * @file    customDraw.ts
 * @brief   Custom draw callback registration for the render pipeline
 */
type DrawCallback = (elapsed: number) => void;
declare function registerDrawCallback(id: string, fn: DrawCallback, scene?: string): void;
declare function unregisterDrawCallback(id: string): void;
declare function clearDrawCallbacks(): void;

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
    private dirty_;
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
    get isDirty(): boolean;
    clearDirty(): void;
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
    before?: string[];
    after?: string[];
    build(app: App): void;
    finish?(app: App): void;
    cleanup?(app?: App): void;
}
type RunCondition = () => boolean;
declare class App {
    private readonly world_;
    private readonly resources_;
    private readonly systems_;
    private runner_;
    private systemCounter_;
    private readonly templateToRuntime_;
    private running_;
    private lastTime_;
    private fixedTimestep_;
    private fixedAccumulator_;
    private maxDeltaTime_;
    private maxFixedSteps_;
    private targetFrameInterval_;
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
    getPlugin<T extends Plugin>(ctor: new (...args: any[]) => T): T | undefined;
    addPlugins(plugins: Plugin[]): this;
    addPlugin(plugin: Plugin): this;
    addEvent<T>(event: EventDef<T>): this;
    addSystemToSchedule(schedule: Schedule, system: SystemDef, options?: {
        runBefore?: string[];
        runAfter?: string[];
        runIf?: RunCondition;
    }): this;
    addSystem(system: SystemDef): this;
    addStartupSystem(system: SystemDef): this;
    removeSystem(systemId: symbol): boolean;
    connectCpp(cppRegistry: CppRegistry, module?: ESEngineModule): this;
    get wasmModule(): ESEngineModule | null;
    get pipeline(): RenderPipeline | null;
    setPipeline(pipeline: RenderPipeline): void;
    get spineInitPromise(): Promise<unknown> | undefined;
    set spineInitPromise(p: Promise<unknown> | undefined);
    get physicsInitPromise(): Promise<unknown> | undefined;
    set physicsInitPromise(p: Promise<unknown> | undefined);
    get physicsModule(): unknown;
    set physicsModule(m: unknown);
    waitForPhysics(): Promise<void>;
    get isPhysicsReady(): boolean;
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
    setTargetFrameRate(fps: number): void;
    getTargetFrameRate(): number;
    getPlaySpeed(): number;
    enableStats(): this;
    getSystemTimings(): ReadonlyMap<string, number> | null;
    getPhaseTimings(): ReadonlyMap<string, number> | null;
    getEntityCount(): number;
    insertResource<T>(resource: ResourceDef<T>, value: T): this;
    getResource<T>(resource: ResourceDef<T>): T;
    hasResource<T>(resource: ResourceDef<T>): boolean;
    getResourceByName(name: string): unknown | undefined;
    getResourceChangeTick(name: string): number;
    getRegisteredResourceNames(): string[];
    registerScene(config: SceneConfig): this;
    setInitialScene(name: string): this;
    tick(delta: number): Promise<void>;
    run(): Promise<void>;
    private mainLoop;
    quit(): void;
    private runFrame_;
    private finishPlugins_;
    private sortPlugins;
    private sortSystems;
    private flushing_startup_;
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

export { EventReader as $, App as A, Canvas as F, Changed as H, Children as J, ClearFlags as L, Commands as N, CommandsInstance as Q, Disabled as V, World as W, EmitterShape as Y, EntityCommands as Z, EventReaderInstance as a1, EventRegistry as a2, EventWriter as a3, EventWriterInstance as a5, GetWorld as a6, RenderPipeline as aB, Res as aC, ResMut as aE, ResMutInstance as aG, ScaleMode as aI, SceneManager as aO, SceneManagerState as aP, SceneOwner as aQ, Schedule as aT, ShaderSources as aU, ShapeRenderer as aV, ShapeType as aX, SimulationSpace as aY, SpineAnimation as a_, LocalTransform as aa, Material as ac, Mut as af, Name as ah, Parent as aj, ParticleEasing as al, ParticleEmitter as am, PostProcessVolume as ap, ProjectionType as ar, Query as as, QueryInstance as av, Removed as ax, RemovedQueryInstance as az, Sprite as b1, SystemRunner as b6, Time as b9, getUserComponent as bA, initMaterialAPI as bB, isBuiltinComponent as bC, isTextureRef as bD, loadComponent as bE, loadSceneData as bF, loadSceneWithAssets as bG, readPtrField as bH, registerComponent as bI, registerDrawCallback as bJ, registerMaterialCallback as bK, remapEntityFields as bL, shutdownMaterialAPI as bM, unregisterComponent as bN, unregisterDrawCallback as bO, updateCameraAspectRatio as bP, wrapSceneSystem as bQ, writePtrField as bR, Transform as bb, Velocity as be, WorldTransform as bh, addStartupSystem as bj, addSystem as bk, addSystemToSchedule as bl, clearDrawCallbacks as bm, clearUserComponents as bn, defineComponent as bo, defineEvent as bp, defineResource as bq, defineSystem as br, defineTag as bs, findEntityByName as bt, flushPendingSystems as bu, getComponent as bv, getComponentAssetFieldDescriptors as bw, getComponentAssetFields as bx, getComponentDefaults as by, getComponentSpineFieldDescriptor as bz, SpineModuleController as c, createSpineFactories as e, PostProcessStack as g, loadSpineModule as l, Assets as m, BlendMode as q, Added as s, BitmapText as v, wrapSpineModule as w, BuiltinBridge as y, Camera as z };
export type { BuiltinComponentDef as B, ConstraintList as C, CameraData as D, CameraRenderParams as E, CanvasData as G, ChangedWrapper as I, ChildrenData as K, MaterialHandle as M, CommandsDescriptor as O, Plugin as P, ResourceDef as R, SpineWasmProvider as S, TransformMixData as T, ComponentData as U, DrawCallback as X, EventDef as _, PathMixData as a, SpineAnimationData as a$, EventReaderDescriptor as a0, EventWriterDescriptor as a4, GetWorldDescriptor as a7, InferParam as a8, InferParams as a9, RenderParams as aA, ResDescriptor as aD, ResMutDescriptor as aF, RunCondition as aH, SceneComponentData as aJ, SceneContext as aK, SceneEntityData as aL, SceneLoadOptions as aM, SceneLoadProgressCallback as aN, SceneOwnerData as aR, SceneStatus as aS, ShapeRendererData as aW, SliceBorder as aZ, LocalTransformData as ab, MaterialAssetData as ad, MaterialOptions as ae, MutWrapper as ag, NameData as ai, ParentData as ak, ParticleEmitterData as an, PluginDependency as ao, PostProcessVolumeData as aq, QueryBuilder as at, QueryDescriptor as au, QueryResult as aw, RemovedQueryDescriptor as ay, SpineEventCallback as b, SpineLoadResult as b0, SpriteData as b2, SystemDef as b3, SystemOptions as b4, SystemParam as b5, TextureResult as b7, TextureRef as b8, TimeData as ba, TransitionOptions as bc, UniformValue as bd, VelocityData as bf, Viewport as bg, WorldTransformData as bi, SpineModuleFactory as d, RawSpineEvent as f, ShaderHandle as h, ComponentDef as i, TransformData as j, AnyComponentDef as k, SceneData as n, SpineWasmModule as o, SceneConfig as p, WebAppOptions as r, AddedWrapper as t, AssetFieldType as u, BitmapTextData as x };
