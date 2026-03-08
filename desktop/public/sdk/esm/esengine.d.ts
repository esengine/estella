import { a as Entity, E as ESEngineModule, C as Color, V as Vec2, d as Vec4, P as Padding, c as CppRegistry, T as TextureHandle } from './shared/wasm.js';
export { e as CppResourceManager, F as FontHandle, I as INVALID_ENTITY, f as INVALID_FONT, g as INVALID_MATERIAL, h as INVALID_TEXTURE, Q as Quat, b as Vec3, i as color, q as quat, v as vec2, j as vec3, k as vec4 } from './shared/wasm.js';
import { g as PrefabData, h as PrefabOverride, F as FlattenContext, i as FlattenResult, j as ProcessedEntity, C as ComponentData, k as AssetServer, W as World, m as PostProcessStack, n as ShaderHandle, P as Plugin, A as App, R as ResourceDef, B as BuiltinComponentDef, o as ComponentDef, T as TransformData, p as AnyComponentDef, q as SceneData, e as SpineWasmModule, r as AddressableManifest, s as SceneConfig, t as BlendMode, M as MaterialHandle, u as WebAppOptions } from './shared/app.js';
export { v as Added, x as AddedWrapper, y as AddressableAssetType, z as AddressableManifestAsset, D as AddressableManifestGroup, E as AddressableResultMap, G as AssetBuildTransform, H as AssetBundle, I as AssetContentType, J as AssetFieldType, K as AssetTypeEntry, L as BitmapText, N as BitmapTextData, O as Camera, Q as CameraData, U as CameraRenderParams, V as Canvas, X as CanvasData, Y as Changed, Z as ChangedWrapper, _ as Children, $ as ChildrenData, a0 as ClearFlags, a1 as Commands, a2 as CommandsDescriptor, a3 as CommandsInstance, a4 as ComponentData, a5 as DrawCallback, a6 as EditorAssetType, a7 as EmitterShape, a8 as EntityCommands, a9 as EventDef, aa as EventReader, ab as EventReaderDescriptor, ac as EventReaderInstance, ad as EventRegistry, ae as EventWriter, af as EventWriterDescriptor, ag as EventWriterInstance, ah as FileLoadOptions, ai as GetWorld, aj as GetWorldDescriptor, ak as InferParam, al as InferParams, am as LoadedMaterial, an as LocalTransform, ao as LocalTransformData, ap as Material, aq as MaterialAssetData, ar as MaterialLoader, as as MaterialOptions, at as Mut, au as MutWrapper, av as Name, aw as NameData, ax as NestedPrefabRef, ay as Parent, az as ParentData, aA as ParticleEasing, aB as ParticleEmitter, aC as ParticleEmitterData, aD as PluginDependency, aE as PostProcessVolume, aF as PostProcessVolumeData, aG as PrefabEntityData, aH as ProjectionType, aI as Query, aJ as QueryBuilder, aK as QueryDescriptor, aL as QueryInstance, aM as QueryResult, aN as Removed, aO as RemovedQueryDescriptor, aP as RemovedQueryInstance, aQ as RenderParams, aR as RenderPipeline, aS as Res, aT as ResDescriptor, aU as ResMut, aV as ResMutDescriptor, aW as ResMutInstance, aX as ScaleMode, aY as SceneComponentData, aZ as SceneContext, a_ as SceneEntityData, a$ as SceneLoadOptions, b0 as SceneManager, b1 as SceneManagerState, b2 as SceneOwner, b3 as SceneOwnerData, b4 as SceneStatus, b5 as Schedule, b6 as ShaderLoader, b7 as ShaderSources, b8 as ShapeRenderer, b9 as ShapeRendererData, ba as ShapeType, bb as SimulationSpace, bc as SliceBorder, bd as SpineAnimation, be as SpineAnimationData, bf as SpineDescriptor, bg as SpineLoadResult, bh as SpineRendererFn, bi as Sprite, bj as SpriteData, bk as SystemDef, bl as SystemOptions, bm as SystemParam, bn as SystemRunner, bo as TextureInfo, bp as TextureRef, bq as Time, br as TimeData, bs as Transform, bt as TransitionOptions, bu as UniformValue, bv as Velocity, bw as VelocityData, bx as Viewport, by as WorldTransform, bz as WorldTransformData, bA as addStartupSystem, bB as addSystem, bC as addSystemToSchedule, bD as clearDrawCallbacks, bE as clearUserComponents, bF as defineComponent, bG as defineEvent, bH as defineResource, bI as defineSystem, bJ as defineTag, bK as findEntityByName, bL as flushPendingSystems, bM as getAddressableType, bN as getAddressableTypeByEditorType, bO as getAllAssetExtensions, bP as getAssetBuildTransform, bQ as getAssetMimeType, bR as getAssetTypeEntry, bS as getComponent, bT as getComponentAssetFieldDescriptors, bU as getComponentAssetFields, bV as getComponentDefaults, bW as getComponentSpineFieldDescriptor, bX as getCustomExtensions, bY as getEditorType, bZ as getUserComponent, b_ as getWeChatPackOptions, b$ as initMaterialAPI, c0 as isBuiltinComponent, c1 as isCustomExtension, c2 as isKnownAssetExtension, c3 as isTextureRef, c4 as loadComponent, c5 as loadSceneData, c6 as loadSceneWithAssets, c7 as looksLikeAssetPath, c8 as registerAssetBuildTransform, c9 as registerComponent, ca as registerComponentAssetFields, cb as registerDrawCallback, cc as registerMaterialCallback, cd as remapEntityFields, ce as shutdownMaterialAPI, cf as toBuildPath, cg as unregisterComponent, ch as unregisterDrawCallback, ci as updateCameraAspectRatio, cj as wrapSceneSystem } from './shared/app.js';
import { PhysicsWasmModule } from './physics/index.js';
export { BodyType, BoxCollider, BoxColliderData, CapsuleCollider, CapsuleColliderData, ChainCollider, CircleCollider, CircleColliderData, CollisionEnterEvent, Physics, PhysicsEvents, PhysicsEventsData, PhysicsModuleFactory, PhysicsPlugin, PhysicsPluginConfig, PolygonCollider, RevoluteJoint, RigidBody, RigidBodyData, SegmentCollider, SensorEvent, loadPhysicsModule } from './physics/index.js';

declare const DEFAULT_DESIGN_WIDTH = 1920;
declare const DEFAULT_DESIGN_HEIGHT = 1080;
declare const DEFAULT_PIXELS_PER_UNIT = 100;
declare const DEFAULT_TEXT_CANVAS_SIZE = 512;
declare const DEFAULT_SPRITE_SIZE: {
    x: number;
    y: number;
};
declare const DEFAULT_FONT_FAMILY = "Arial";
declare const DEFAULT_FONT_SIZE = 24;
declare const DEFAULT_LINE_HEIGHT = 1.2;
declare const DEFAULT_MAX_DELTA_TIME = 0.5;
declare const DEFAULT_FALLBACK_DT: number;
declare const DEFAULT_GRAVITY: {
    x: number;
    y: number;
};
declare const DEFAULT_FIXED_TIMESTEP: number;
declare const DEFAULT_SPINE_SKIN = "default";
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
    assetLoadTimeout: number;
    assetFailureCooldown: number;
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
interface RuntimeBuildConfig {
    sceneTransitionDuration?: number;
    sceneTransitionColor?: string;
    defaultFontFamily?: string;
    canvasScaleMode?: string;
    canvasMatchWidthOrHeight?: number;
    maxDeltaTime?: number;
    maxFixedSteps?: number;
    textCanvasSize?: number;
    assetLoadTimeout?: number;
    assetFailureCooldown?: number;
}
declare function applyBuildRuntimeConfig(app: {
    setMaxDeltaTime(v: number): void;
    setMaxFixedSteps(v: number): void;
}, config: RuntimeBuildConfig): void;

declare const Storage: {
    getString(key: string, defaultValue?: string): string | undefined;
    setString(key: string, value: string): void;
    getNumber(key: string, defaultValue?: number): number | undefined;
    setNumber(key: string, value: number): void;
    getBoolean(key: string, defaultValue?: boolean): boolean | undefined;
    setBoolean(key: string, value: boolean): void;
    getJSON<T>(key: string, defaultValue?: T): T | undefined;
    setJSON<T>(key: string, value: T): void;
    remove(key: string): void;
    has(key: string): boolean;
    clear(): void;
};

declare function flattenPrefab(prefab: PrefabData, overrides: PrefabOverride[], ctx: FlattenContext): FlattenResult;

declare function applyOverrides(entity: ProcessedEntity, overrides: PrefabOverride[]): void;

declare function remapComponentEntityRefs(components: ComponentData[], idMapping: Map<number, number>): void;

declare function cloneComponents(components: ComponentData[]): ComponentData[];
declare function cloneComponentData(data: Record<string, unknown>): Record<string, unknown>;

declare function collectNestedPrefabPaths(prefab: PrefabData, loadPrefab: (path: string) => PrefabData | null, visited?: Set<string>): string[];
declare function preloadNestedPrefabs(prefab: PrefabData, loadPrefab: (path: string) => Promise<PrefabData>, cache: Map<string, PrefabData>, visited?: Set<string>, depth?: number): Promise<void>;

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

declare function registerComponentEntityFields(componentType: string, fields: string[]): void;
declare function getComponentEntityFields(componentType: string): string[] | undefined;

declare function initPostProcessAPI(wasmModule: ESEngineModule): void;
declare function shutdownPostProcessAPI(): void;
declare const PostProcess: {
    createStack(): PostProcessStack;
    bind(camera: Entity, stack: PostProcessStack): void;
    unbind(camera: Entity): void;
    getStack(camera: Entity): PostProcessStack | null;
    init(width: number, height: number): boolean;
    shutdown(): void;
    resize(width: number, height: number): void;
    isInitialized(): boolean;
    setBypass(bypass: boolean): void;
    begin(): void;
    end(): void;
    setOutputViewport(x: number, y: number, w: number, h: number): void;
    _applyForCamera(camera: Entity): void;
    _resetAfterCamera(): void;
    _cleanupDestroyedCameras(isValid: (e: Entity) => boolean): void;
    screenStack: PostProcessStack | null;
    setScreenStack(stack: PostProcessStack | null): void;
    _beginScreenCapture(): void;
    _endScreenCapture(): void;
    _applyScreenStack(): void;
    _executeScreenPasses(): void;
    createBlur(): ShaderHandle;
    createVignette(): ShaderHandle;
    createGrayscale(): ShaderHandle;
    createBloomExtract(): ShaderHandle;
    createBloomKawase(iteration: number): ShaderHandle;
    createBloomComposite(): ShaderHandle;
    createChromaticAberration(): ShaderHandle;
};

interface EffectUniformDef {
    name: string;
    label: string;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
}
interface EffectSubPass {
    name: string;
    factory: () => ShaderHandle;
}
interface EffectDef {
    type: string;
    label: string;
    factory: () => ShaderHandle;
    uniforms: EffectUniformDef[];
    multiPass?: EffectSubPass[];
}
declare function getEffectDef(type: string): EffectDef | undefined;
declare function getEffectTypes(): string[];
declare function getAllEffectDefs(): EffectDef[];

interface PostProcessEffectData {
    type: string;
    enabled: boolean;
    uniforms: Record<string, number>;
}
interface PostProcessVolumeData {
    effects: PostProcessEffectData[];
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
declare function syncPostProcessVolume(camera: Entity, data: PostProcessVolumeData): void;
declare function cleanupPostProcessVolume(camera: Entity): void;
declare function cleanupAllPostProcessVolumes(): void;

declare class PostProcessPlugin implements Plugin {
    name: string;
    build(app: App): void;
    cleanup(): void;
}
declare const postProcessPlugin: PostProcessPlugin;

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

interface UIRectData {
    anchorMin: Vec2;
    anchorMax: Vec2;
    offsetMin: Vec2;
    offsetMax: Vec2;
    size: Vec2;
    pivot: Vec2;
}
declare const UIRect: BuiltinComponentDef<UIRectData>;

interface LayoutRect {
    left: number;
    bottom: number;
    right: number;
    top: number;
}
interface LayoutResult {
    originX: number;
    originY: number;
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
}, parentRect: LayoutRect, pivot?: {
    x: number;
    y: number;
}): LayoutResult;
interface FillAnchors {
    anchorMin: {
        x: number;
        y: number;
    };
    anchorMax: {
        x: number;
        y: number;
    };
    offsetMin: {
        x: number;
        y: number;
    };
    offsetMax: {
        x: number;
        y: number;
    };
}
declare function computeFillAnchors(direction: number, value: number): FillAnchors;
declare function computeHandleAnchors(direction: number, value: number): {
    anchorMin: {
        x: number;
        y: number;
    };
    anchorMax: {
        x: number;
        y: number;
    };
};
declare function computeFillSize(direction: number, value: number, parentW: number, parentH: number): {
    x: number;
    y: number;
};
declare function applyDirectionalFill(world: World, fillEntity: Entity, direction: number, value: number): void;
declare function syncFillSpriteSize(world: World, fillEntity: Entity, direction: number, normalizedValue: number, sliderW: number, sliderH: number): void;
declare function makeInteractable(world: World, entity: Entity): void;
declare function withChildEntity(world: World, childId: Entity, callback: (entity: Entity) => void): void;
declare function setEntityColor(world: World, entity: Entity, color: Color): void;
declare function setEntityEnabled(world: World, entity: Entity, enabled: boolean): void;
declare function colorScale(c: Color, factor: number): Color;
declare function colorWithAlpha(c: Color, alpha: number): Color;
declare class EntityStateMap<T> {
    private map_;
    get(entity: Entity): T | undefined;
    set(entity: Entity, state: T): void;
    delete(entity: Entity): void;
    has(entity: Entity): boolean;
    cleanup(world: World): void;
    ensureInit(entity: Entity, init: () => T): T;
    clear(): void;
    [Symbol.iterator](): MapIterator<[number, T]>;
}

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

declare const UIVisualType: {
    readonly None: 0;
    readonly SolidColor: 1;
    readonly Image: 2;
    readonly NineSlice: 3;
};
type UIVisualType = (typeof UIVisualType)[keyof typeof UIVisualType];
interface UIRendererData {
    visualType: UIVisualType;
    texture: number;
    color: Color;
    uvOffset: Vec2;
    uvScale: Vec2;
    sliceBorder: Vec4;
    material: number;
    enabled: boolean;
}
declare const UIRenderer: BuiltinComponentDef<UIRendererData>;

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
    private shrinkCounter_;
    private frameMaxW_;
    private frameMaxH_;
    constructor(module: ESEngineModule);
    beginFrame(): void;
    private renderText;
    private renderTextInner;
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

declare class TextPlugin implements Plugin {
    build(app: App): void;
}
declare const textPlugin: TextPlugin;

declare const MaskMode: {
    readonly Scissor: 0;
    readonly Stencil: 1;
};
type MaskMode = (typeof MaskMode)[keyof typeof MaskMode];
interface UIMaskData {
    enabled: boolean;
    mode: MaskMode;
}
declare const UIMask: BuiltinComponentDef<UIMaskData>;

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
declare const Interactable: BuiltinComponentDef<InteractableData>;

interface UIInteractionData {
    hovered: boolean;
    pressed: boolean;
    justPressed: boolean;
    justReleased: boolean;
}
declare const UIInteraction: BuiltinComponentDef<UIInteractionData>;

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
type UIEventHandler = (event: UIEvent) => void;
type Unsubscribe = () => void;
interface UIEvent {
    entity: Entity;
    type: UIEventType;
    target: Entity;
    currentTarget: Entity;
    propagationStopped: boolean;
    stopPropagation(): void;
}
declare class UIEventQueue {
    private events_;
    private entityTypeHandlers_;
    private globalHandlers_;
    private activeDispatches_;
    private entityValidator_;
    on(entity: Entity, type: UIEventType, handler: UIEventHandler): Unsubscribe;
    on(type: UIEventType, handler: UIEventHandler): Unsubscribe;
    removeAll(entity: Entity): void;
    setEntityValidator(validator: (entity: Entity) => boolean): void;
    emit(entity: Entity, type: UIEventType, target?: Entity): UIEvent;
    emitBubbled(entity: Entity, type: UIEventType, target: Entity, shared: UIEvent): void;
    drain(): UIEvent[];
    query(type: UIEventType): UIEvent[];
    hasEvent(entity: Entity, type: UIEventType): boolean;
    private dispatchToHandlers_;
    private invokeHandlers_;
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

interface UILayoutGenerationData {
    generation: number;
}
declare const UILayoutGeneration: ResourceDef<UILayoutGenerationData>;

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
interface ImageData$1 {
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
declare const Image: ComponentDef<ImageData$1>;

declare class ImagePlugin implements Plugin {
    build(app: App): void;
}
declare const imagePlugin: ImagePlugin;

type ToggleTransition = ColorTransition;
interface ToggleData {
    isOn: boolean;
    graphicEntity: Entity;
    group: Entity;
    transition: ColorTransition | null;
    onColor: Color;
    offColor: Color;
}
declare const Toggle: ComponentDef<ToggleData>;

declare class TogglePlugin implements Plugin {
    build(app: App): void;
}
declare const togglePlugin: TogglePlugin;

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

declare class ProgressBarPlugin implements Plugin {
    build(app: App): void;
}
declare const progressBarPlugin: ProgressBarPlugin;

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

declare class DragPlugin implements Plugin {
    build(app: App): void;
}
declare const dragPlugin: DragPlugin;

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
    elastic: boolean;
    wheelSensitivity: number;
}
declare const ScrollView: ComponentDef<ScrollViewData>;

declare class ScrollViewPlugin implements Plugin {
    private cleanup_;
    cleanup(): void;
    build(app: App): void;
}
declare const scrollViewPlugin: ScrollViewPlugin;

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

declare class SliderPlugin implements Plugin {
    build(app: App): void;
}
declare const sliderPlugin: SliderPlugin;

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

declare class FocusPlugin implements Plugin {
    build(app: App): void;
}
declare const focusPlugin: FocusPlugin;

interface SafeAreaData {
    applyTop: boolean;
    applyBottom: boolean;
    applyLeft: boolean;
    applyRight: boolean;
}
declare const SafeArea: ComponentDef<SafeAreaData>;

declare class SafeAreaPlugin implements Plugin {
    build(app: App): void;
}
declare const safeAreaPlugin: SafeAreaPlugin;

type ListViewItemRenderer = (index: number, entity: Entity) => void;
interface ListViewData {
    itemHeight: number;
    itemCount: number;
    scrollY: number;
    overscan: number;
}
declare const ListView: ComponentDef<ListViewData>;

declare function setListViewRenderer(entity: Entity, renderer: ListViewItemRenderer): void;
declare class ListViewPlugin implements Plugin {
    private cleanup_;
    cleanup(): void;
    build(app: App): void;
}
declare const listViewPlugin: ListViewPlugin;

interface DropdownData {
    options: string[];
    selectedIndex: number;
    isOpen: boolean;
    listEntity: Entity;
    labelEntity: Entity;
}
declare const Dropdown: ComponentDef<DropdownData>;

declare class DropdownPlugin implements Plugin {
    private cleanup_;
    cleanup(): void;
    build(app: App): void;
}
declare const dropdownPlugin: DropdownPlugin;

declare class LayoutGroupPlugin implements Plugin {
    build(app: App): void;
}
declare const layoutGroupPlugin: LayoutGroupPlugin;

declare const FlexDirection: {
    readonly Row: 0;
    readonly Column: 1;
    readonly RowReverse: 2;
    readonly ColumnReverse: 3;
};
type FlexDirection = (typeof FlexDirection)[keyof typeof FlexDirection];
declare const FlexWrap: {
    readonly NoWrap: 0;
    readonly Wrap: 1;
};
type FlexWrap = (typeof FlexWrap)[keyof typeof FlexWrap];
declare const JustifyContent: {
    readonly Start: 0;
    readonly Center: 1;
    readonly End: 2;
    readonly SpaceBetween: 3;
    readonly SpaceAround: 4;
    readonly SpaceEvenly: 5;
};
type JustifyContent = (typeof JustifyContent)[keyof typeof JustifyContent];
declare const AlignItems: {
    readonly Start: 0;
    readonly Center: 1;
    readonly End: 2;
    readonly Stretch: 3;
};
type AlignItems = (typeof AlignItems)[keyof typeof AlignItems];
interface FlexContainerData {
    direction: FlexDirection;
    wrap: FlexWrap;
    justifyContent: JustifyContent;
    alignItems: AlignItems;
    gap: Vec2;
    padding: Padding;
}

interface FlexItemData {
    flexGrow: number;
    flexShrink: number;
    flexBasis: number;
    order: number;
}

declare class UIRenderOrderPlugin implements Plugin {
    build(app: App): void;
}
declare const uiRenderOrderPlugin: UIRenderOrderPlugin;

interface UITheme {
    primary: Color;
    secondary: Color;
    background: Color;
    surface: Color;
    error: Color;
    text: Color;
    textSecondary: Color;
    border: Color;
    fontFamily: string;
    fontSize: {
        xs: number;
        sm: number;
        md: number;
        lg: number;
        xl: number;
    };
    spacing: {
        xs: number;
        sm: number;
        md: number;
        lg: number;
        xl: number;
    };
    button: {
        height: number;
        color: Color;
        textColor: Color;
        transition: ColorTransition;
    };
    slider: {
        trackHeight: number;
        trackColor: Color;
        fillColor: Color;
        handleSize: number;
        handleColor: Color;
    };
    toggle: {
        size: Vec2;
        onColor: Color;
        offColor: Color;
        checkColor: Color;
    };
    input: {
        height: number;
        backgroundColor: Color;
        textColor: Color;
        placeholderColor: Color;
        fontSize: number;
        padding: number;
    };
    dropdown: {
        height: number;
        backgroundColor: Color;
        itemHeight: number;
    };
    panel: {
        backgroundColor: Color;
        padding: number;
    };
    scrollView: {
        backgroundColor: Color;
    };
}
declare const DARK_THEME: UITheme;
declare const UIThemeRes: ResourceDef<UITheme | null>;

declare function initUIBuilder(app: App): void;
interface UIEntityDef {
    name?: string;
    parent?: Entity;
    rect?: Partial<UIRectData>;
    transform?: Partial<TransformData>;
    renderer?: Partial<UIRendererData>;
    interactable?: Partial<InteractableData>;
    text?: Partial<TextData>;
    image?: Partial<ImageData$1>;
    flex?: Partial<FlexContainerData>;
    flexItem?: Partial<FlexItemData>;
    mask?: Partial<UIMaskData>;
    components?: Array<[AnyComponentDef, Record<string, unknown>?]>;
}
declare function spawnUI(world: World, def: UIEntityDef): Entity;
declare function destroyUI(world: World, entity: Entity): void;
interface ButtonOptions {
    text?: string;
    fontSize?: number;
    size?: Vec2;
    color?: Color;
    textColor?: Color;
    transition?: ColorTransition | null;
    parent?: Entity;
    events?: UIEventQueue;
    onClick?: (entity: Entity) => void;
    onHover?: (entity: Entity) => void;
}
declare function createButton(world: World, options?: ButtonOptions): Entity;
interface SliderOptions {
    value?: number;
    minValue?: number;
    maxValue?: number;
    direction?: FillDirection;
    size?: Vec2;
    trackColor?: Color;
    fillColor?: Color;
    handleSize?: Vec2;
    handleColor?: Color;
    wholeNumbers?: boolean;
    parent?: Entity;
    events?: UIEventQueue;
    onChange?: (value: number, entity: Entity) => void;
}
declare function createSlider(world: World, options?: SliderOptions): Entity;
interface ToggleOptions {
    isOn?: boolean;
    size?: Vec2;
    onColor?: Color;
    offColor?: Color;
    checkSize?: Vec2;
    checkColor?: Color;
    group?: Entity;
    transition?: ColorTransition | null;
    label?: string;
    parent?: Entity;
    events?: UIEventQueue;
    onChange?: (isOn: boolean, entity: Entity) => void;
}
declare function createToggle(world: World, options?: ToggleOptions): Entity;
interface ProgressBarOptions {
    value?: number;
    size?: Vec2;
    direction?: FillDirection;
    trackColor?: Color;
    fillColor?: Color;
    parent?: Entity;
}
declare function createProgressBar(world: World, options?: ProgressBarOptions): Entity;
interface ScrollViewOptions {
    size?: Vec2;
    contentSize?: Vec2;
    horizontal?: boolean;
    vertical?: boolean;
    elastic?: boolean;
    mask?: boolean;
    parent?: Entity;
}
declare function createScrollView(world: World, options?: ScrollViewOptions): Entity;
interface TextInputOptions {
    placeholder?: string;
    value?: string;
    size?: Vec2;
    fontSize?: number;
    backgroundColor?: Color;
    textColor?: Color;
    maxLength?: number;
    multiline?: boolean;
    password?: boolean;
    parent?: Entity;
    events?: UIEventQueue;
    onChange?: (value: string, entity: Entity) => void;
    onSubmit?: (value: string, entity: Entity) => void;
}
declare function createTextInput(world: World, options?: TextInputOptions): Entity;
interface DropdownOptions {
    options: string[];
    selectedIndex?: number;
    size?: Vec2;
    fontSize?: number;
    parent?: Entity;
    events?: UIEventQueue;
    onChange?: (selectedIndex: number, entity: Entity) => void;
}
declare function createDropdown(world: World, options: DropdownOptions): Entity;
interface LabelOptions {
    text: string;
    fontSize?: number;
    color?: Color;
    align?: TextAlign;
    verticalAlign?: TextVerticalAlign;
    size?: Vec2;
    parent?: Entity;
}
declare function createLabel(world: World, options: LabelOptions): Entity;
interface PanelOptions {
    size?: Vec2;
    color?: Color;
    parent?: Entity;
}
declare function createPanel(world: World, options?: PanelOptions): Entity;
interface FlexOptions {
    gap?: number;
    padding?: {
        left: number;
        top: number;
        right: number;
        bottom: number;
    };
    wrap?: boolean;
    justifyContent?: JustifyContent;
    alignItems?: AlignItems;
    parent?: Entity;
}
declare function createFlexRow(world: World, options?: FlexOptions): Entity;
declare function createFlexColumn(world: World, options?: FlexOptions): Entity;
interface UINodeBase {
    ref?: (entity: Entity) => void;
}
interface UIElementNode extends UINodeBase {
    type: 'element';
    name?: string;
    rect?: Partial<UIRectData>;
    renderer?: Partial<UIRendererData>;
    text?: Partial<TextData>;
    image?: Partial<ImageData$1>;
    interactable?: Partial<InteractableData>;
    flex?: Partial<FlexContainerData>;
    flexItem?: Partial<FlexItemData>;
    mask?: Partial<UIMaskData>;
    components?: Array<[AnyComponentDef, Record<string, unknown>?]>;
    children?: UINode[];
}
interface UIButtonNode extends UINodeBase {
    type: 'button';
    options?: ButtonOptions;
}
interface UISliderNode extends UINodeBase {
    type: 'slider';
    options?: SliderOptions;
}
interface UIToggleNode extends UINodeBase {
    type: 'toggle';
    options?: ToggleOptions;
}
interface UITextInputNode extends UINodeBase {
    type: 'textInput';
    options?: TextInputOptions;
}
interface UIDropdownNode extends UINodeBase {
    type: 'dropdown';
    options: DropdownOptions;
}
interface UIProgressBarNode extends UINodeBase {
    type: 'progressBar';
    options?: ProgressBarOptions;
}
interface UILabelNode extends UINodeBase {
    type: 'label';
    options: LabelOptions;
}
interface UIPanelNode extends UINodeBase {
    type: 'panel';
    options?: PanelOptions;
    children?: UINode[];
}
interface UIFlexRowNode extends UINodeBase {
    type: 'flexRow';
    options?: FlexOptions;
    children?: UINode[];
}
interface UIFlexColumnNode extends UINodeBase {
    type: 'flexColumn';
    options?: FlexOptions;
    children?: UINode[];
}
interface UIScrollViewNode extends UINodeBase {
    type: 'scrollView';
    options?: ScrollViewOptions;
    children?: UINode[];
}
type UINode = UIElementNode | UIButtonNode | UISliderNode | UIToggleNode | UIScrollViewNode | UITextInputNode | UIDropdownNode | UIProgressBarNode | UILabelNode | UIPanelNode | UIFlexRowNode | UIFlexColumnNode;
declare function buildUI(world: World, node: UINode, parent?: Entity): Entity;
declare const UI: {
    spawn: typeof spawnUI;
    destroy: typeof destroyUI;
    build: typeof buildUI;
    label: typeof createLabel;
    panel: typeof createPanel;
    button: typeof createButton;
    slider: typeof createSlider;
    toggle: typeof createToggle;
    scrollView: typeof createScrollView;
    textInput: typeof createTextInput;
    dropdown: typeof createDropdown;
    progressBar: typeof createProgressBar;
    flexRow: typeof createFlexRow;
    flexColumn: typeof createFlexColumn;
};

declare class AsyncCache<T> {
    private cache_;
    private pending_;
    private failed_;
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
interface LoadRuntimeSceneOptions {
    app: App;
    module: ESEngineModule;
    sceneData: SceneData;
    provider: RuntimeAssetProvider;
    spineModule?: SpineWasmModule | null;
    physicsModule?: PhysicsWasmModule | null;
    physicsConfig?: {
        gravity?: Vec2;
        fixedTimestep?: number;
        subStepCount?: number;
        contactHertz?: number;
        contactDampingRatio?: number;
        contactSpeed?: number;
    };
    manifest?: AddressableManifest | null;
    sceneName?: string;
}
declare function loadRuntimeScene(options: LoadRuntimeSceneOptions): Promise<void>;
declare function createRuntimeSceneConfig(name: string, sceneData: SceneData, options: Omit<LoadRuntimeSceneOptions, 'sceneData' | 'sceneName'>): SceneConfig;
interface RuntimeInitConfig {
    app: App;
    module: ESEngineModule;
    provider: RuntimeAssetProvider;
    scenes: Array<{
        name: string;
        data: SceneData;
    }>;
    firstScene: string;
    spineModule?: SpineWasmModule | null;
    physicsModule?: PhysicsWasmModule | null;
    physicsConfig?: {
        gravity?: Vec2;
        fixedTimestep?: number;
        subStepCount?: number;
        contactHertz?: number;
        contactDampingRatio?: number;
        contactSpeed?: number;
    };
    manifest?: AddressableManifest | null;
    aspectRatio?: number;
}
declare function initRuntime(config: RuntimeInitConfig): Promise<void>;

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

interface AudioBusConfig {
    name: string;
    volume?: number;
    muted?: boolean;
    parent?: string;
}
declare class AudioBus {
    private readonly name_;
    private readonly gainNode_;
    private muted_;
    private volume_;
    private children_;
    constructor(context: AudioContext, config: AudioBusConfig);
    get name(): string;
    get node(): GainNode;
    get volume(): number;
    set volume(v: number);
    get muted(): boolean;
    set muted(m: boolean);
    connect(destination: AudioBus | AudioNode): void;
    addChild(child: AudioBus): void;
}

interface AudioMixerConfig {
    masterVolume?: number;
    musicVolume?: number;
    sfxVolume?: number;
    uiVolume?: number;
    voiceVolume?: number;
}
declare class AudioMixer {
    readonly master: AudioBus;
    readonly music: AudioBus;
    readonly sfx: AudioBus;
    readonly ui: AudioBus;
    readonly voice: AudioBus;
    private readonly context_;
    private readonly buses_;
    constructor(context: AudioContext, config?: AudioMixerConfig);
    getBus(name: string): AudioBus | undefined;
    createBus(config: AudioBusConfig): AudioBus;
}

interface AudioHandle {
    readonly id: number;
    stop(): void;
    pause(): void;
    resume(): void;
    setVolume(volume: number): void;
    setPan(pan: number): void;
    setLoop(loop: boolean): void;
    setPlaybackRate(rate: number): void;
    readonly isPlaying: boolean;
    readonly currentTime: number;
    readonly duration: number;
    onEnd?: () => void;
}
interface AudioBufferHandle {
    readonly id: number;
    readonly duration: number;
}
interface PlayConfig {
    volume?: number;
    pan?: number;
    loop?: boolean;
    playbackRate?: number;
    bus?: string;
    priority?: number;
    startOffset?: number;
}
interface AudioBackendInitOptions {
    initialPoolSize?: number;
    mixerConfig?: AudioMixerConfig;
}
interface PlatformAudioBackend {
    readonly name: string;
    readonly mixer: AudioMixer | null;
    readonly isReady: boolean;
    initialize(options?: AudioBackendInitOptions): Promise<void>;
    ensureResumed(): Promise<void>;
    loadBuffer(url: string): Promise<AudioBufferHandle>;
    loadBufferFromData(url: string, data: ArrayBuffer): Promise<AudioBufferHandle>;
    unloadBuffer(handle: AudioBufferHandle): void;
    play(buffer: AudioBufferHandle, config: PlayConfig): AudioHandle;
    suspend(): void;
    resume(): void;
    dispose(): void;
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
interface ImageLoadResult {
    width: number;
    height: number;
    pixels: Uint8Array;
}
interface PlatformAdapter {
    readonly name: 'web' | 'wechat';
    fetch(url: string, options?: PlatformRequestOptions): Promise<PlatformResponse>;
    readFile(path: string): Promise<ArrayBuffer>;
    readTextFile(path: string): Promise<string>;
    fileExists(path: string): Promise<boolean>;
    loadImagePixels(path: string): Promise<ImageLoadResult>;
    instantiateWasm(pathOrBuffer: string | ArrayBuffer, imports: WebAssembly.Imports): Promise<WasmInstantiateResult>;
    createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas;
    now(): number;
    createImage(): HTMLImageElement;
    bindInputEvents(callbacks: InputEventCallbacks, target?: unknown): void;
    createAudioBackend(): PlatformAudioBackend;
    getStorageItem(key: string): string | null;
    setStorageItem(key: string, value: string): void;
    removeStorageItem(key: string): void;
    clearStorage(prefix: string): void;
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

declare enum FlushReason {
    BatchFull = 0,
    TextureSlotsFull = 1,
    ScissorChange = 2,
    StencilChange = 3,
    MaterialChange = 4,
    BlendModeChange = 5,
    StageEnd = 6,
    TypeChange = 7,
    FrameEnd = 8
}
declare enum RenderType {
    Sprite = 0,
    Spine = 1,
    Mesh = 2,
    ExternalMesh = 3,
    Text = 4,
    Particle = 5,
    Shape = 6,
    UIElement = 7
}
interface DrawCallInfo {
    index: number;
    cameraIndex: number;
    stage: number;
    type: RenderType;
    blendMode: number;
    textureId: number;
    materialId: number;
    shaderId: number;
    vertexCount: number;
    triangleCount: number;
    entityCount: number;
    entityOffset: number;
    layer: number;
    flushReason: FlushReason;
    scissorX: number;
    scissorY: number;
    scissorW: number;
    scissorH: number;
    scissorEnabled: boolean;
    stencilWrite: boolean;
    stencilTest: boolean;
    stencilRef: number;
    textureSlotUsage: number;
    entities: number[];
}
interface FrameCaptureData {
    drawCalls: DrawCallInfo[];
    cameraCount: number;
}

declare enum RenderStage {
    Background = 0,
    Opaque = 1,
    Transparent = 2,
    Overlay = 3
}
declare const SubmitSkipFlags: {
    readonly None: 0;
    readonly Spine: 1;
    readonly Particles: 2;
};
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
    submitAll(registry: {
        _cpp: CppRegistry;
    }, skipFlags: number, vpX: number, vpY: number, vpW: number, vpH: number): void;
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
    captureNextFrame(): void;
    getCapturedData(): FrameCaptureData | null;
    hasCapturedData(): boolean;
    replayToDrawCall(drawCallIndex: number): void;
    getSnapshotImageData(): ImageData | null;
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
    _depth: boolean;
    _filter: 'nearest' | 'linear';
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
declare function setPlayMode(active: boolean): void;
declare function isPlayMode(): boolean;

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

/**
 * @file    ValueTween.ts
 * @brief   JS-side value tweening with easing functions ported from C++
 */

declare const EasingType: {
    readonly Linear: 0;
    readonly EaseInQuad: 1;
    readonly EaseOutQuad: 2;
    readonly EaseInOutQuad: 3;
    readonly EaseInCubic: 4;
    readonly EaseOutCubic: 5;
    readonly EaseInOutCubic: 6;
    readonly EaseInBack: 7;
    readonly EaseOutBack: 8;
    readonly EaseInOutBack: 9;
    readonly EaseInElastic: 10;
    readonly EaseOutElastic: 11;
    readonly EaseInOutElastic: 12;
    readonly EaseOutBounce: 13;
    readonly CubicBezier: 14;
    readonly Step: 15;
};
type EasingType = (typeof EasingType)[keyof typeof EasingType];
declare const TweenState: {
    readonly Running: 0;
    readonly Paused: 1;
    readonly Completed: 2;
    readonly Cancelled: 3;
};
type TweenState = (typeof TweenState)[keyof typeof TweenState];
declare const LoopMode: {
    readonly None: 0;
    readonly Restart: 1;
    readonly PingPong: 2;
};
type LoopMode = (typeof LoopMode)[keyof typeof LoopMode];
interface TweenOptions {
    easing?: EasingType;
    delay?: number;
    loop?: LoopMode;
    loopCount?: number;
}
interface BezierPoints {
    p1x: number;
    p1y: number;
    p2x: number;
    p2y: number;
}
declare class ValueTweenHandle {
    readonly id: number;
    constructor(id: number);
    get state(): TweenState;
    bezier(p1x: number, p1y: number, p2x: number, p2y: number): this;
    then(next: ValueTweenHandle): this;
    then(next: {
        pause(): void;
        resume(): void;
    }): this;
    pause(): void;
    resume(): void;
    cancel(): void;
}

/**
 * @file    Tween.ts
 * @brief   Property tween API wrapping C++ TweenSystem
 */

declare const TweenTarget: {
    readonly PositionX: 0;
    readonly PositionY: 1;
    readonly PositionZ: 2;
    readonly ScaleX: 3;
    readonly ScaleY: 4;
    readonly RotationZ: 5;
    readonly ColorR: 6;
    readonly ColorG: 7;
    readonly ColorB: 8;
    readonly ColorA: 9;
    readonly SizeX: 10;
    readonly SizeY: 11;
    readonly CameraOrthoSize: 12;
};
type TweenTarget = (typeof TweenTarget)[keyof typeof TweenTarget];
declare class TweenHandle {
    private readonly module_;
    private readonly registry_;
    readonly entity: Entity;
    constructor(module: ESEngineModule, registry: CppRegistry, entity: Entity);
    get state(): TweenState;
    bezier(p1x: number, p1y: number, p2x: number, p2y: number): this;
    then(next: TweenHandle | ValueTweenHandle): this;
    pause(): void;
    resume(): void;
    cancel(): void;
}
declare function initTweenAPI(module: ESEngineModule, registry: CppRegistry): void;
declare function shutdownTweenAPI(): void;
declare const Tween: {
    to(entity: Entity, target: TweenTarget, from: number, to: number, duration: number, options?: TweenOptions): TweenHandle;
    value(from: number, to: number, duration: number, callback: (value: number) => void, options?: TweenOptions): ValueTweenHandle;
    cancel(tweenHandle: TweenHandle): void;
    cancelAll(entity: Entity): void;
    update(deltaTime: number): void;
};

/**
 * @file    SpriteAnimator.ts
 * @brief   Sprite frame animation component and system (pure TypeScript)
 */

interface SpriteAnimFrame {
    texture: TextureHandle;
    duration?: number;
    uvOffset?: {
        x: number;
        y: number;
    };
    uvScale?: {
        x: number;
        y: number;
    };
}
interface SpriteAnimClip {
    name: string;
    frames: SpriteAnimFrame[];
    fps: number;
    loop: boolean;
}
declare function registerAnimClip(clip: SpriteAnimClip): void;
declare function unregisterAnimClip(name: string): void;
declare function getAnimClip(name: string): SpriteAnimClip | undefined;
declare function clearAnimClips(): void;
interface SpriteAnimatorData {
    clip: string;
    speed: number;
    playing: boolean;
    loop: boolean;
    enabled: boolean;
    currentFrame: number;
    frameTimer: number;
}
declare const SpriteAnimator: ComponentDef<SpriteAnimatorData>;
declare function spriteAnimatorSystemUpdate(world: World, deltaTime: number): void;

/**
 * @file    AnimationPlugin.ts
 * @brief   Animation plugin registering Tween and SpriteAnimator systems
 */

declare class AnimationPlugin implements Plugin {
    name: string;
    build(app: App): void;
    cleanup(): void;
}
declare const animationPlugin: AnimationPlugin;

/**
 * @file    AnimClipLoader.ts
 * @brief   .esanim asset loading and parsing
 */

interface AnimClipFrameData {
    texture: string;
    atlasFrame?: {
        x: number;
        y: number;
        width: number;
        height: number;
        pageWidth: number;
        pageHeight: number;
    };
}
interface AnimClipAssetData {
    version: string;
    type: 'animation-clip';
    fps?: number;
    loop?: boolean;
    frames: AnimClipFrameData[];
}
declare function extractAnimClipTexturePaths(data: AnimClipAssetData): string[];
declare function parseAnimClipData(clipPath: string, data: AnimClipAssetData, textureHandles: Map<string, number>): SpriteAnimClip;

declare class Audio {
    private static backend_;
    private static mixer_;
    private static bufferCache_;
    private static bgmHandle_;
    private static bgmVolume_;
    private static fadeAnimId_;
    private static disposed_;
    private static assetResolver_;
    static baseUrl: string;
    static init(backend: PlatformAudioBackend, mixer?: AudioMixer | null): void;
    static setAssetResolver(resolver: (url: string) => ArrayBuffer | null): void;
    private static resolveUrl_;
    static preload(url: string): Promise<void>;
    static preloadAll(urls: string[]): Promise<void>;
    static preloadFromData(url: string, data: ArrayBuffer): Promise<void>;
    static playSFX(url: string, config?: {
        volume?: number;
        pitch?: number;
        pan?: number;
        priority?: number;
    }): AudioHandle;
    static playBGM(url: string, config?: {
        volume?: number;
        fadeIn?: number;
        crossFade?: number;
    }): void;
    static stopAll(): void;
    static stopBGM(fadeOut?: number): void;
    static setMasterVolume(volume: number): void;
    static setMusicVolume(volume: number): void;
    static setSFXVolume(volume: number): void;
    static setUIVolume(volume: number): void;
    static muteBus(busName: string, muted: boolean): void;
    static getBufferHandle(url: string): AudioBufferHandle | undefined;
    static dispose(): void;
    private static fadeIn;
    private static fadeOut;
    private static createDeferredHandle;
}

interface PooledAudioNode {
    gain: GainNode;
    panner: StereoPannerNode;
    source: AudioBufferSourceNode | null;
    inUse: boolean;
    startTime: number;
}
declare class AudioPool {
    private readonly context_;
    private readonly pool_;
    private activeCount_;
    constructor(context: AudioContext, initialSize?: number);
    private createNode;
    acquire(): PooledAudioNode;
    release(node: PooledAudioNode): void;
    get activeCount(): number;
    get capacity(): number;
}

interface AudioPluginConfig {
    initialPoolSize?: number;
    masterVolume?: number;
    musicVolume?: number;
    sfxVolume?: number;
}
declare class AudioPlugin implements Plugin {
    name: string;
    private config_;
    private activeSourceHandles_;
    private playedEntities_;
    constructor(config?: AudioPluginConfig);
    build(app: App): void;
    stopAllSources(): void;
    cleanup(): void;
}
declare const audioPlugin: AudioPlugin;

interface AudioSourceData {
    clip: string;
    bus: string;
    volume: number;
    pitch: number;
    loop: boolean;
    playOnAwake: boolean;
    spatial: boolean;
    minDistance: number;
    maxDistance: number;
    attenuationModel: number;
    rolloff: number;
    priority: number;
    enabled: boolean;
}
declare const AudioSource: ComponentDef<AudioSourceData>;
interface AudioListenerData {
    enabled: boolean;
}
declare const AudioListener: ComponentDef<AudioListenerData>;

declare enum AttenuationModel {
    Linear = 0,
    Inverse = 1,
    Exponential = 2
}
interface SpatialAudioConfig {
    model: AttenuationModel;
    refDistance: number;
    maxDistance: number;
    rolloff: number;
}
declare function calculateAttenuation(distance: number, config?: SpatialAudioConfig): number;
declare function calculatePanning(sourceX: number, sourceY: number, listenerX: number, listenerY: number, maxDistance: number): number;

declare function initParticleAPI(m: ESEngineModule, r: CppRegistry): void;
declare function shutdownParticleAPI(): void;
declare const Particle: {
    update(dt: number): void;
    play(entity: Entity): void;
    stop(entity: Entity): void;
    reset(entity: Entity): void;
    getAliveCount(entity: Entity): number;
};

declare class ParticlePlugin implements Plugin {
    name: string;
    build(app: App): void;
    cleanup(): void;
}
declare const particlePlugin: ParticlePlugin;

interface TilemapData {
    source: string;
}
interface TilemapLayerData {
    width: number;
    height: number;
    tileWidth: number;
    tileHeight: number;
    texture: number;
    tilesetColumns: number;
    layer: number;
    tiles: number[];
    tint: {
        r: number;
        g: number;
        b: number;
        a: number;
    };
    opacity: number;
    visible: boolean;
    parallaxFactor: {
        x: number;
        y: number;
    };
}
declare const Tilemap: ComponentDef<TilemapData>;
declare const TilemapLayer: ComponentDef<TilemapLayerData>;

declare function initTilemapAPI(m: ESEngineModule): void;
declare function shutdownTilemapAPI(): void;
declare const TilemapAPI: {
    initLayer(entity: number, width: number, height: number, tileWidth: number, tileHeight: number): void;
    destroyLayer(entity: number): void;
    setTile(entity: number, x: number, y: number, tileId: number): void;
    getTile(entity: number, x: number, y: number): number;
    fillRect(entity: number, x: number, y: number, w: number, h: number, tileId: number): void;
    setTiles(entity: number, tiles: Uint16Array): void;
    hasLayer(entity: number): boolean;
    submitLayer(entity: number, textureId: number, sortLayer: number, depth: number, tilesetColumns: number, uvTileWidth: number, uvTileHeight: number, originX: number, originY: number, camLeft: number, camBottom: number, camRight: number, camTop: number, tintR: number, tintG: number, tintB: number, tintA: number, opacity: number, parallaxX: number, parallaxY: number): void;
};

declare class TilemapPlugin implements Plugin {
    name: string;
    private initializedLayers_;
    private sourceEntityKeys_;
    build(app: App): void;
    cleanup(): void;
}
declare const tilemapPlugin: TilemapPlugin;

interface TiledLayerData {
    name: string;
    width: number;
    height: number;
    visible: boolean;
    tiles: Uint16Array;
    opacity: number;
    tintColor: {
        r: number;
        g: number;
        b: number;
        a: number;
    };
    parallaxX: number;
    parallaxY: number;
}
interface TiledTilesetData {
    name: string;
    image: string;
    tileWidth: number;
    tileHeight: number;
    columns: number;
    tileCount: number;
}
type TiledObjectShape = 'rect' | 'ellipse' | 'polygon' | 'point';
interface TiledObjectData {
    shape: TiledObjectShape;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    vertices: number[] | null;
    properties: Map<string, unknown>;
}
interface TiledObjectGroupData {
    name: string;
    objects: TiledObjectData[];
}
interface TiledMapData {
    width: number;
    height: number;
    tileWidth: number;
    tileHeight: number;
    layers: TiledLayerData[];
    tilesets: TiledTilesetData[];
    objectGroups: TiledObjectGroupData[];
    collisionTileIds: number[];
}
declare function parseTmjJson(json: Record<string, unknown>): TiledMapData | null;
declare function resolveRelativePath(basePath: string, relativePath: string): string;
declare function parseTiledMap(jsonString: string, resolveExternal?: (source: string) => Promise<string>): Promise<TiledMapData | null>;
interface TilemapLoadOptions {
    generateObjectCollision?: boolean;
    collisionTileIds?: number[];
}
declare function loadTiledMap(world: World, mapData: TiledMapData, textureHandles: Map<string, number>, options?: TilemapLoadOptions): Entity[];

interface TextureDimensions {
    width: number;
    height: number;
}
interface LoadedTilemapLayer {
    name: string;
    width: number;
    height: number;
    tiles: Uint16Array;
}
interface LoadedTilemapTileset {
    textureHandle: number;
    columns: number;
}
interface LoadedTilemapSource {
    tileWidth: number;
    tileHeight: number;
    layers: LoadedTilemapLayer[];
    tilesets: LoadedTilemapTileset[];
}
declare function registerTextureDimensions(handle: number, width: number, height: number): void;
declare function getTextureDimensions(handle: number): TextureDimensions | undefined;
declare function clearTextureDimensionsCache(): void;
declare function registerTilemapSource(path: string, data: LoadedTilemapSource): void;
declare function getTilemapSource(path: string): LoadedTilemapSource | undefined;
declare function clearTilemapSourceCache(): void;

type StatsPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
declare class StatsOverlay {
    private el_;
    private visible_;
    private disposed_;
    private lastUpdateTime_;
    private lastStats_;
    private accumulatedTimings_;
    constructor(container: HTMLElement, position?: StatsPosition);
    update(stats: FrameStats): void;
    show(): void;
    hide(): void;
    dispose(): void;
    private accumulateTimings_;
    private render_;
}

interface FrameStats {
    fps: number;
    frameTimeMs: number;
    entityCount: number;
    systemTimings: Map<string, number>;
    phaseTimings: Map<string, number>;
    drawCalls: number;
    triangles: number;
    sprites: number;
    text: number;
    spine: number;
    meshes: number;
    culled: number;
}
declare function defaultFrameStats(): FrameStats;
declare const Stats: ResourceDef<FrameStats>;
interface FrameSnapshot {
    frameTimeMs: number;
    phaseTimings: Map<string, number>;
    systemTimings: Map<string, number>;
}
declare class FrameHistory {
    private readonly capacity_;
    private buffer_;
    private cursor_;
    private count_;
    constructor(capacity?: number);
    get count(): number;
    push(frameTimeMs: number, phaseTimings: Map<string, number>, systemTimings?: Map<string, number>): void;
    getLatest(): FrameSnapshot | null;
    getAll(): FrameSnapshot[];
    reset(): void;
}
declare class StatsCollector {
    private deltas_;
    private cursor_;
    private count_;
    private sum_;
    pushFrame(deltaSeconds: number): void;
    getFps(): number;
    getFrameTimeMs(): number;
    reset(): void;
}
interface StatsPluginOptions {
    overlay?: boolean;
    position?: StatsPosition;
    container?: HTMLElement;
}
declare class StatsPlugin implements Plugin {
    readonly name = "Stats";
    private collector_;
    private overlay_;
    private options_;
    constructor(options?: StatsPluginOptions);
    build(app: App): void;
    cleanup(): void;
}
declare const statsPlugin: StatsPlugin;

/**
 * @file    playableRuntime.ts
 * @brief   Playable ad runtime initialization (single-HTML builds)
 */

interface PlayableRuntimeConfig {
    app: App;
    module: ESEngineModule;
    canvas: HTMLCanvasElement;
    assets: Record<string, string>;
    scenes: Array<{
        name: string;
        data: SceneData;
    }>;
    firstScene: string;
    spineWasmBase64?: string;
    physicsWasmBase64?: string;
    physicsConfig?: {
        gravity?: Vec2;
        fixedTimestep?: number;
        subStepCount?: number;
    };
    manifest?: AddressableManifest | null;
}
declare function initPlayableRuntime(config: PlayableRuntimeConfig): Promise<void>;

declare const uiPlugins: Plugin[];

declare const WrapMode: {
    readonly Once: 0;
    readonly Loop: 1;
    readonly PingPong: 2;
};
type WrapMode = (typeof WrapMode)[keyof typeof WrapMode];
declare const TrackType: {
    readonly Property: "property";
    readonly Spine: "spine";
    readonly SpriteAnim: "spriteAnim";
    readonly Audio: "audio";
    readonly Activation: "activation";
};
type TrackType = (typeof TrackType)[keyof typeof TrackType];
interface Keyframe {
    time: number;
    value: number;
    inTangent: number;
    outTangent: number;
}
interface PropertyChannel {
    property: string;
    keyframes: Keyframe[];
}
interface TrackBase {
    type: TrackType;
    name: string;
    childPath: string;
}
interface PropertyTrack extends TrackBase {
    type: typeof TrackType.Property;
    component: string;
    channels: PropertyChannel[];
}
interface SpineClip {
    start: number;
    duration: number;
    animation: string;
    loop: boolean;
    speed: number;
}
interface SpineTrack extends TrackBase {
    type: typeof TrackType.Spine;
    clips: SpineClip[];
    blendIn: number;
}
interface SpriteAnimTrack extends TrackBase {
    type: typeof TrackType.SpriteAnim;
    clip: string;
    startTime: number;
}
interface AudioEvent {
    time: number;
    clip: string;
    volume: number;
}
interface AudioTrack extends TrackBase {
    type: typeof TrackType.Audio;
    events: AudioEvent[];
}
interface ActivationRange {
    start: number;
    end: number;
}
interface ActivationTrack extends TrackBase {
    type: typeof TrackType.Activation;
    ranges: ActivationRange[];
}
type Track = PropertyTrack | SpineTrack | SpriteAnimTrack | AudioTrack | ActivationTrack;
interface TimelineAsset {
    version: string;
    type: 'timeline';
    duration: number;
    wrapMode: WrapMode;
    tracks: Track[];
}

declare function parseTimelineAsset(raw: any): TimelineAsset;

declare function clearTimelineHandles(): void;

declare function registerTimelineAsset(path: string, asset: TimelineAsset): void;
declare class TimelinePlugin implements Plugin {
    name: string;
    private handles_;
    build(app: App): void;
    clearHandles(): void;
    cleanup(): void;
    private resolveTrackTargets;
    private decodeEventString;
    private processEvents;
    private processCustomProperties;
}
declare const timelinePlugin: TimelinePlugin;

declare function createWebApp(module: ESEngineModule, options?: WebAppOptions): App;

export { AddressableManifest, AnimationPlugin, AnyComponentDef, App, AssetPlugin, AssetRefCounter, AssetServer, Assets, AsyncCache, AttenuationModel, Audio, AudioBus, AudioListener, AudioMixer, AudioPlugin, AudioPool, AudioSource, BlendMode, BuiltinComponentDef, Button, ButtonState, Color, ComponentDef, CppRegistry, DARK_THEME, DEFAULT_DESIGN_HEIGHT, DEFAULT_DESIGN_WIDTH, DEFAULT_FALLBACK_DT, DEFAULT_FIXED_TIMESTEP, DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE, DEFAULT_GRAVITY, DEFAULT_LINE_HEIGHT, DEFAULT_MAX_DELTA_TIME, DEFAULT_PIXELS_PER_UNIT, DEFAULT_SPINE_SKIN, DEFAULT_SPRITE_SIZE, DEFAULT_TEXT_CANVAS_SIZE, DataType, DragPlugin, DragState, Draggable, Draw, Dropdown, DropdownPlugin, ESEngineModule, EasingType, Entity, EntityStateMap, FillDirection, FillMethod, FillOrigin, FlattenContext, FlattenResult, FlushReason, FocusManager, FocusManagerState, FocusPlugin, Focusable, FrameHistory, GLDebug, Geometry, Image, ImagePlugin, ImageType, Input, InputPlugin, InputState, Interactable, LayoutGroupPlugin, ListView, ListViewPlugin, LogLevel, Logger, LoopMode, MaskMode, MaterialHandle, Particle, ParticlePlugin, PhysicsWasmModule, Plugin, PostProcess, PostProcessPlugin, PostProcessStack, ComponentData as PrefabComponentData, PrefabData, PrefabOverride, PrefabServer, Prefabs, PrefabsPlugin, PreviewPlugin, ProcessedEntity, ProgressBar, ProgressBarDirection, ProgressBarPlugin, RenderStage, RenderTexture, RenderType, Renderer, ResourceDef, RuntimeConfig, SafeArea, SafeAreaPlugin, SceneConfig, SceneData, ScrollView, ScrollViewPlugin, ShaderHandle, Slider, SliderDirection, SliderPlugin, SpriteAnimator, Stats, StatsCollector, StatsOverlay, StatsPlugin, Storage, SubmitSkipFlags, Text, TextAlign, TextInput, TextInputPlugin, TextOverflow, TextPlugin, TextRenderer, TextVerticalAlign, TextureHandle, Tilemap, TilemapAPI, TilemapLayer, TilemapPlugin, TimelinePlugin, Toggle, TogglePlugin, TransformData, Tween, TweenHandle, TweenState, TweenTarget, UI, UICameraInfo, UIEventQueue, UIEvents, UIInteraction, UIInteractionPlugin, UILayoutGeneration, UILayoutPlugin, UIMask, UIMaskPlugin, UIRect, UIRenderOrderPlugin, UIRenderer, UIThemeRes, UIVisualType, Vec2, Vec4, WebAppOptions, WebAssetProvider, World, animationPlugin, applyBuildRuntimeConfig, applyDirectionalFill, applyOverrides, applyRuntimeConfig, assetPlugin, audioPlugin, calculateAttenuation, calculatePanning, cleanupAllPostProcessVolumes, cleanupPostProcessVolume, clearAnimClips, clearTextureDimensionsCache, clearTilemapSourceCache, clearTimelineHandles, cloneComponentData, cloneComponents, collectNestedPrefabPaths, colorScale, colorWithAlpha, computeFillAnchors, computeFillSize, computeHandleAnchors, computeUIRectLayout, createRuntimeSceneConfig, createWebApp, debug, defaultFrameStats, dragPlugin, dropdownPlugin, error, extractAnimClipTexturePaths, flattenPrefab, focusPlugin, getAllEffectDefs, getAnimClip, getComponentEntityFields, getEffectDef, getEffectTypes, getLogger, getPlatform, getPlatformType, getTextureDimensions, getTilemapSource, imagePlugin, info, initDrawAPI, initGLDebugAPI, initGeometryAPI, initParticleAPI, initPlayableRuntime, initPostProcessAPI, initRendererAPI, initRuntime, initTilemapAPI, initTweenAPI, initUIBuilder, inputPlugin, instantiatePrefab, intersectRects, invertMatrix4, isEditor, isPlatformInitialized, isPlayMode, isRuntime, isWeChat, isWeb, layoutGroupPlugin, listViewPlugin, loadRuntimeScene, loadTiledMap, makeInteractable, parseAnimClipData, parseTiledMap, parseTimelineAsset, parseTmjJson, particlePlugin, platformFetch, platformFileExists, platformInstantiateWasm, platformReadFile, platformReadTextFile, pointInOBB, pointInWorldRect, postProcessPlugin, prefabsPlugin, preloadNestedPrefabs, progressBarPlugin, registerAnimClip, registerComponentEntityFields, registerEmbeddedAssets, registerTextureDimensions, registerTilemapSource, registerTimelineAsset, remapComponentEntityRefs, resolveRelativePath, safeAreaPlugin, sceneManagerPlugin, screenToWorld, scrollViewPlugin, setEditorMode, setEntityColor, setEntityEnabled, setListViewRenderer, setLogLevel, setPlayMode, setWasmErrorHandler, shutdownDrawAPI, shutdownGLDebugAPI, shutdownGeometryAPI, shutdownParticleAPI, shutdownPostProcessAPI, shutdownRendererAPI, shutdownTilemapAPI, shutdownTweenAPI, sliderPlugin, spriteAnimatorSystemUpdate, statsPlugin, syncFillSpriteSize, syncPostProcessVolume, textInputPlugin, textPlugin, tilemapPlugin, timelinePlugin, togglePlugin, transitionTo, uiInteractionPlugin, uiLayoutPlugin, uiMaskPlugin, uiPlugins, uiRenderOrderPlugin, unregisterAnimClip, warn, withChildEntity };
export type { AnimClipAssetData, AssetRefInfo, AssetsData, AudioBackendInitOptions, AudioBufferHandle, AudioBusConfig, AudioHandle, AudioListenerData, AudioMixerConfig, AudioPluginConfig, AudioSourceData, BezierPoints, ButtonData, ButtonOptions, ButtonTransition, DragStateData, DraggableData, DrawAPI, DrawCallInfo, DropdownData, DropdownOptions, EffectDef, EffectUniformDef, FlexOptions, FocusableData, FrameCaptureData, FrameSnapshot, FrameStats, GeometryHandle, GeometryOptions, ImageData$1 as ImageData, InstantiatePrefabOptions, InstantiatePrefabResult, InteractableData, LabelOptions, LayoutRect, LayoutResult, ListViewData, ListViewItemRenderer, LoadRuntimeSceneOptions, LoadedTilemapLayer, LoadedTilemapSource, LoadedTilemapTileset, LogEntry, LogHandler, PanelOptions, PlatformAdapter, PlatformAudioBackend, PlatformRequestOptions, PlatformResponse, PlatformType, PlayConfig, PlayableRuntimeConfig, PooledAudioNode, PostProcessEffectData, ProgressBarData, ProgressBarOptions, RenderStats, RenderTargetHandle, RenderTextureHandle, RenderTextureOptions, RuntimeAssetProvider, RuntimeBuildConfig, RuntimeInitConfig, SafeAreaData, ScreenRect, ScrollViewData, ScrollViewOptions, SliderData, SliderOptions, SpatialAudioConfig, SpriteAnimClip, SpriteAnimFrame, SpriteAnimatorData, StatsPluginOptions, StatsPosition, TextData, TextInputData, TextInputOptions, TextRenderResult, TextureDimensions, TiledLayerData, TiledMapData, TiledTilesetData, TilemapData, TilemapLayerData, ToggleData, ToggleOptions, ToggleTransition, TransitionConfig, TweenOptions, UICameraData, UIEntityDef, UIEvent, UIEventHandler, UIEventType, UIInteractionData, UILayoutGenerationData, UIMaskData, UINode, UIRectData, UIRendererData, UITheme, Unsubscribe, VertexAttributeDescriptor };
