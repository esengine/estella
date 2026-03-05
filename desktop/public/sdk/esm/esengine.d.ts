import { a as Entity, E as ESEngineModule, C as Color, V as Vec2, c as CppRegistry, T as TextureHandle } from './shared/wasm.js';
export { e as CppResourceManager, F as FontHandle, I as INVALID_ENTITY, f as INVALID_FONT, g as INVALID_MATERIAL, h as INVALID_TEXTURE, Q as Quat, b as Vec3, d as Vec4, i as color, q as quat, v as vec2, j as vec3, k as vec4 } from './shared/wasm.js';
import { g as PostProcessStack, h as ShaderHandle, P as Plugin, A as App, R as ResourceDef, B as BuiltinComponentDef, W as World, C as ComponentDef, M as MaskProcessorFn, i as AssetServer, j as PrefabOverride, I as InstantiatePrefabResult, k as SceneData, e as SpineWasmModule, m as AddressableManifest, n as SceneConfig, o as BlendMode, p as MaterialHandle, q as WebAppOptions } from './shared/app.js';
export { r as Added, s as AddedWrapper, t as AddressableAssetType, u as AddressableManifestAsset, v as AddressableManifestGroup, x as AddressableResultMap, y as AnyComponentDef, z as AssetBuildTransform, D as AssetBundle, E as AssetContentType, F as AssetFieldType, G as AssetTypeEntry, H as BitmapText, J as BitmapTextData, K as Camera, L as CameraData, N as CameraRenderParams, O as Canvas, Q as CanvasData, T as Changed, U as ChangedWrapper, V as Children, X as ChildrenData, Y as ClearFlags, Z as Commands, _ as CommandsDescriptor, $ as CommandsInstance, a0 as ComponentData, a1 as DrawCallback, a2 as EditorAssetType, a3 as EmitterShape, a4 as EntityCommands, a5 as EventDef, a6 as EventReader, a7 as EventReaderDescriptor, a8 as EventReaderInstance, a9 as EventRegistry, aa as EventWriter, ab as EventWriterDescriptor, ac as EventWriterInstance, ad as FileLoadOptions, ae as GetWorld, af as GetWorldDescriptor, ag as InferParam, ah as InferParams, ai as InstantiatePrefabOptions, aj as LoadedMaterial, ak as LocalTransform, al as LocalTransformData, am as Material, an as MaterialAssetData, ao as MaterialLoader, ap as MaterialOptions, aq as Mut, ar as MutWrapper, as as Name, at as NameData, au as Parent, av as ParentData, aw as ParticleEasing, ax as ParticleEmitter, ay as ParticleEmitterData, az as PluginDependency, aA as PostProcessVolume, aB as PostProcessVolumeData, aC as PrefabData, aD as PrefabEntityData, aE as ProjectionType, aF as Query, aG as QueryBuilder, aH as QueryDescriptor, aI as QueryInstance, aJ as QueryResult, aK as Removed, aL as RemovedQueryDescriptor, aM as RemovedQueryInstance, aN as RenderParams, aO as RenderPipeline, aP as Res, aQ as ResDescriptor, aR as ResMut, aS as ResMutDescriptor, aT as ResMutInstance, aU as ScaleMode, aV as SceneComponentData, aW as SceneContext, aX as SceneEntityData, aY as SceneLoadOptions, aZ as SceneManager, a_ as SceneManagerState, a$ as SceneOwner, b0 as SceneOwnerData, b1 as SceneStatus, b2 as Schedule, b3 as ShaderLoader, b4 as ShaderSources, b5 as ShapeRenderer, b6 as ShapeRendererData, b7 as ShapeType, b8 as SimulationSpace, b9 as SliceBorder, ba as SpineAnimation, bb as SpineAnimationData, bc as SpineDescriptor, bd as SpineLoadResult, be as SpineRendererFn, bf as Sprite, bg as SpriteData, bh as SystemDef, bi as SystemOptions, bj as SystemParam, bk as SystemRunner, bl as TextureInfo, bm as TextureRef, bn as Time, bo as TimeData, bp as Transform, bq as TransformData, br as TransitionOptions, bs as UniformValue, bt as Velocity, bu as VelocityData, bv as WorldTransform, bw as WorldTransformData, bx as addStartupSystem, by as addSystem, bz as addSystemToSchedule, bA as clearDrawCallbacks, bB as clearUserComponents, bC as defineComponent, bD as defineEvent, bE as defineResource, bF as defineSystem, bG as defineTag, bH as findEntityByName, bI as flushPendingSystems, bJ as getAddressableType, bK as getAddressableTypeByEditorType, bL as getAllAssetExtensions, bM as getAssetBuildTransform, bN as getAssetMimeType, bO as getAssetTypeEntry, bP as getComponent, bQ as getComponentAssetFieldDescriptors, bR as getComponentAssetFields, bS as getComponentDefaults, bT as getComponentEntityFields, bU as getComponentSpineFieldDescriptor, bV as getCustomExtensions, bW as getEditorType, bX as getUserComponent, bY as getWeChatPackOptions, bZ as initMaterialAPI, b_ as instantiatePrefab, b$ as isBuiltinComponent, c0 as isCustomExtension, c1 as isKnownAssetExtension, c2 as isTextureRef, c3 as loadComponent, c4 as loadSceneData, c5 as loadSceneWithAssets, c6 as looksLikeAssetPath, c7 as registerAssetBuildTransform, c8 as registerComponent, c9 as registerComponentAssetFields, ca as registerComponentEntityFields, cb as registerDrawCallback, cc as registerMaterialCallback, cd as remapEntityFields, ce as shutdownMaterialAPI, cf as toBuildPath, cg as unregisterComponent, ch as unregisterDrawCallback, ci as updateCameraAspectRatio, cj as wrapSceneSystem } from './shared/app.js';
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

interface UIRectData {
    anchorMin: Vec2;
    anchorMax: Vec2;
    offsetMin: Vec2;
    offsetMax: Vec2;
    size: Vec2;
    pivot: Vec2;
}
declare const UIRect: BuiltinComponentDef<UIRectData>;

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
    build(app: App): void;
}
declare const dropdownPlugin: DropdownPlugin;

declare class LayoutGroupPlugin implements Plugin {
    build(app: App): void;
}
declare const layoutGroupPlugin: LayoutGroupPlugin;

declare class UIRenderOrderPlugin implements Plugin {
    build(app: App): void;
}
declare const uiRenderOrderPlugin: UIRenderOrderPlugin;

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
    submitShapes(registry: {
        _cpp: CppRegistry;
    }): void;
    submitSpine(registry: {
        _cpp: CppRegistry;
    }): void;
    submitParticles(registry: {
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

declare function clearTimelineInstances(): void;

declare function registerTimelineAsset(path: string, asset: TimelineAsset): void;
declare class TimelinePlugin implements Plugin {
    name: string;
    build(app: App): void;
    cleanup(): void;
}
declare const timelinePlugin: TimelinePlugin;

declare function createWebApp(module: ESEngineModule, options?: WebAppOptions): App;

export { AddressableManifest, AnimationPlugin, App, AssetPlugin, AssetRefCounter, AssetServer, Assets, AsyncCache, AttenuationModel, Audio, AudioBus, AudioListener, AudioMixer, AudioPlugin, AudioPool, AudioSource, BlendMode, BuiltinComponentDef, Button, ButtonState, Color, ComponentDef, CppRegistry, DEFAULT_DESIGN_HEIGHT, DEFAULT_DESIGN_WIDTH, DEFAULT_FALLBACK_DT, DEFAULT_FIXED_TIMESTEP, DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE, DEFAULT_GRAVITY, DEFAULT_LINE_HEIGHT, DEFAULT_MAX_DELTA_TIME, DEFAULT_PIXELS_PER_UNIT, DEFAULT_SPINE_SKIN, DEFAULT_SPRITE_SIZE, DEFAULT_TEXT_CANVAS_SIZE, DataType, DragPlugin, DragState, Draggable, Draw, Dropdown, DropdownPlugin, ESEngineModule, EasingType, Entity, FillDirection, FillMethod, FillOrigin, FocusManager, FocusManagerState, FocusPlugin, Focusable, FrameHistory, GLDebug, Geometry, Image, ImagePlugin, ImageType, Input, InputPlugin, InputState, InstantiatePrefabResult, Interactable, LayoutGroupPlugin, ListView, ListViewPlugin, LogLevel, Logger, LoopMode, MaskMode, MaskProcessorFn, MaterialHandle, Particle, ParticlePlugin, PhysicsWasmModule, Plugin, PostProcess, PostProcessPlugin, PostProcessStack, PrefabOverride, PrefabServer, Prefabs, PrefabsPlugin, PreviewPlugin, ProgressBar, ProgressBarDirection, ProgressBarPlugin, RenderStage, RenderTexture, Renderer, ResourceDef, RuntimeConfig, SafeArea, SafeAreaPlugin, SceneConfig, SceneData, ScrollView, ScrollViewPlugin, ShaderHandle, Slider, SliderDirection, SliderPlugin, SpriteAnimator, Stats, StatsCollector, StatsOverlay, StatsPlugin, Storage, Text, TextAlign, TextInput, TextInputPlugin, TextOverflow, TextPlugin, TextRenderer, TextVerticalAlign, TextureHandle, Tilemap, TilemapAPI, TilemapLayer, TilemapPlugin, TimelinePlugin, Toggle, TogglePlugin, Tween, TweenHandle, TweenState, TweenTarget, UICameraInfo, UIEventQueue, UIEvents, UIInteraction, UIInteractionPlugin, UILayoutPlugin, UIMask, UIMaskPlugin, UIRect, UIRenderOrderPlugin, Vec2, WebAppOptions, WebAssetProvider, World, animationPlugin, applyBuildRuntimeConfig, applyDirectionalFill, applyRuntimeConfig, assetPlugin, audioPlugin, calculateAttenuation, calculatePanning, cleanupAllPostProcessVolumes, cleanupPostProcessVolume, clearAnimClips, clearTextureDimensionsCache, clearTilemapSourceCache, clearTimelineInstances, computeFillAnchors, computeFillSize, computeHandleAnchors, computeUIRectLayout, createMaskProcessor, createRuntimeSceneConfig, createWebApp, debug, defaultFrameStats, dragPlugin, dropdownPlugin, error, extractAnimClipTexturePaths, focusPlugin, getAllEffectDefs, getAnimClip, getEffectDef, getEffectTypes, getLogger, getPlatform, getPlatformType, getTextureDimensions, getTilemapSource, imagePlugin, info, initDrawAPI, initGLDebugAPI, initGeometryAPI, initParticleAPI, initPlayableRuntime, initPostProcessAPI, initRendererAPI, initRuntime, initTilemapAPI, initTweenAPI, inputPlugin, intersectRects, invertMatrix4, isEditor, isPlatformInitialized, isPlayMode, isRuntime, isWeChat, isWeb, layoutGroupPlugin, listViewPlugin, loadRuntimeScene, loadTiledMap, parseAnimClipData, parseTiledMap, parseTimelineAsset, parseTmjJson, particlePlugin, platformFetch, platformFileExists, platformInstantiateWasm, platformReadFile, platformReadTextFile, pointInOBB, pointInWorldRect, postProcessPlugin, prefabsPlugin, progressBarPlugin, registerAnimClip, registerEmbeddedAssets, registerTextureDimensions, registerTilemapSource, registerTimelineAsset, resolveRelativePath, safeAreaPlugin, sceneManagerPlugin, screenToWorld, scrollViewPlugin, setEditorMode, setListViewRenderer, setLogLevel, setPlayMode, setWasmErrorHandler, shutdownDrawAPI, shutdownGLDebugAPI, shutdownGeometryAPI, shutdownParticleAPI, shutdownPostProcessAPI, shutdownRendererAPI, shutdownTilemapAPI, shutdownTweenAPI, sliderPlugin, spriteAnimatorSystemUpdate, statsPlugin, syncFillSpriteSize, syncPostProcessVolume, textInputPlugin, textPlugin, tilemapPlugin, timelinePlugin, togglePlugin, transitionTo, uiInteractionPlugin, uiLayoutPlugin, uiMaskPlugin, uiPlugins, uiRenderOrderPlugin, unregisterAnimClip, warn };
export type { AnimClipAssetData, AssetRefInfo, AssetsData, AudioBackendInitOptions, AudioBufferHandle, AudioBusConfig, AudioHandle, AudioListenerData, AudioMixerConfig, AudioPluginConfig, AudioSourceData, BezierPoints, ButtonData, ButtonTransition, DragStateData, DraggableData, DrawAPI, DropdownData, EffectDef, EffectUniformDef, FocusableData, FrameSnapshot, FrameStats, GeometryHandle, GeometryOptions, ImageData, InteractableData, LayoutRect, LayoutResult, ListViewData, ListViewItemRenderer, LoadRuntimeSceneOptions, LoadedTilemapLayer, LoadedTilemapSource, LoadedTilemapTileset, LogEntry, LogHandler, PlatformAdapter, PlatformAudioBackend, PlatformRequestOptions, PlatformResponse, PlatformType, PlayConfig, PlayableRuntimeConfig, PooledAudioNode, PostProcessEffectData, ProgressBarData, RenderStats, RenderTargetHandle, RenderTextureHandle, RenderTextureOptions, RuntimeAssetProvider, RuntimeBuildConfig, RuntimeInitConfig, SafeAreaData, ScreenRect, ScrollViewData, SliderData, SpatialAudioConfig, SpriteAnimClip, SpriteAnimFrame, SpriteAnimatorData, StatsPluginOptions, StatsPosition, TextData, TextInputData, TextRenderResult, TextureDimensions, TiledLayerData, TiledMapData, TiledTilesetData, TilemapData, TilemapLayerData, ToggleData, ToggleTransition, TransitionConfig, TweenOptions, UICameraData, UIEvent, UIEventType, UIInteractionData, UIMaskData, UIRectData, VertexAttributeDescriptor };
