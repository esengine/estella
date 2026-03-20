import { E as Entity, a as ESEngineModule, c as Color, V as Vec2, e as Vec4, P as Padding, C as CppRegistry, T as TextureHandle, b as CppResourceManager } from './shared/wasm.js';
export { F as FontHandle, I as INVALID_ENTITY, f as INVALID_FONT, g as INVALID_MATERIAL, h as INVALID_TEXTURE, Q as Quat, d as Vec3, i as color, q as quat, v as vec2, j as vec3, k as vec4 } from './shared/wasm.js';
import { g as PostProcessStack, h as ShaderHandle, P as Plugin, A as App, R as ResourceDef, B as BuiltinComponentDef, W as World, i as ComponentDef, j as TransformData, k as AnyComponentDef, m as Assets$1, M as MaterialHandle, n as SceneData, o as SpineWasmModule, p as SceneConfig, q as BlendMode, r as WebAppOptions, S as SpineWasmProvider } from './shared/app.js';
export { s as Added, t as AddedWrapper, u as AssetFieldType, v as BitmapText, x as BitmapTextData, y as BuiltinBridge, z as Camera, D as CameraData, E as CameraRenderParams, F as Canvas, G as CanvasData, H as Changed, I as ChangedWrapper, J as Children, K as ChildrenData, L as ClearFlags, N as Commands, O as CommandsDescriptor, Q as CommandsInstance, U as ComponentData, V as Disabled, X as DrawCallback, Y as EmitterShape, Z as EntityCommands, _ as EventDef, $ as EventReader, a0 as EventReaderDescriptor, a1 as EventReaderInstance, a2 as EventRegistry, a3 as EventWriter, a4 as EventWriterDescriptor, a5 as EventWriterInstance, a6 as GetWorld, a7 as GetWorldDescriptor, a8 as InferParam, a9 as InferParams, aa as LocalTransform, ab as LocalTransformData, ac as Material, ad as MaterialAssetData, ae as MaterialOptions, af as Mut, ag as MutWrapper, ah as Name, ai as NameData, aj as Parent, ak as ParentData, al as ParticleEasing, am as ParticleEmitter, an as ParticleEmitterData, ao as PluginDependency, ap as PostProcessVolume, aq as PostProcessVolumeData, ar as ProjectionType, as as Query, at as QueryBuilder, au as QueryDescriptor, av as QueryInstance, aw as QueryResult, ax as Removed, ay as RemovedQueryDescriptor, az as RemovedQueryInstance, aA as RenderParams, aB as RenderPipeline, aC as Res, aD as ResDescriptor, aE as ResMut, aF as ResMutDescriptor, aG as ResMutInstance, aH as RunCondition, aI as ScaleMode, aJ as SceneComponentData, aK as SceneContext, aL as SceneEntityData, aM as SceneLoadOptions, aN as SceneManager, aO as SceneManagerState, aP as SceneOwner, aQ as SceneOwnerData, aR as SceneStatus, aS as Schedule, aT as ShaderSources, aU as ShapeRenderer, aV as ShapeRendererData, aW as ShapeType, aX as SimulationSpace, aY as SliceBorder, aZ as SpineAnimation, a_ as SpineAnimationData, a$ as SpineLoadResult, b0 as Sprite, b1 as SpriteData, b2 as SystemDef, b3 as SystemOptions, b4 as SystemParam, b5 as SystemRunner, b6 as TextureInfo, b7 as TextureRef, b8 as Time, b9 as TimeData, ba as Transform, bb as TransitionOptions, bc as UniformValue, bd as Velocity, be as VelocityData, bf as Viewport, bg as WorldTransform, bh as WorldTransformData, bi as addStartupSystem, bj as addSystem, bk as addSystemToSchedule, bl as clearDrawCallbacks, bm as clearUserComponents, bn as defineComponent, bo as defineEvent, bp as defineResource, bq as defineSystem, br as defineTag, bs as findEntityByName, bt as flushPendingSystems, bu as getComponent, bv as getComponentAssetFieldDescriptors, bw as getComponentAssetFields, bx as getComponentDefaults, by as getComponentSpineFieldDescriptor, bz as getUserComponent, bA as initMaterialAPI, bB as isBuiltinComponent, bC as isTextureRef, bD as loadComponent, bE as loadSceneData, bF as loadSceneWithAssets, bG as readPtrField, bH as registerComponent, bI as registerDrawCallback, bJ as registerMaterialCallback, bK as remapEntityFields, bL as shutdownMaterialAPI, bM as unregisterComponent, bN as unregisterDrawCallback, bO as updateCameraAspectRatio, bP as wrapSceneSystem, bQ as writePtrField } from './shared/app.js';
import { PhysicsWasmModule } from './physics/index.js';
export { BodyType, BoxCollider, BoxColliderData, CapsuleCollider, CapsuleColliderData, ChainCollider, CircleCollider, CircleColliderData, CollisionEnterEvent, Physics, PhysicsEvents, PhysicsEventsData, PhysicsModuleFactory, PhysicsPlugin, PhysicsPluginConfig, PolygonCollider, RevoluteJoint, RigidBody, RigidBodyData, SegmentCollider, SensorEvent, loadPhysicsModule } from './physics/index.js';
import { S as SpineManager } from './shared/SpineManager.js';

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

/**
 * @file    ptrLayouts.generated.ts
 * @brief   Auto-generated component pointer layouts
 * @details Generated by EHT - DO NOT EDIT
 */
type PtrFieldType = 'f32' | 'i32' | 'u32' | 'bool' | 'u8' | 'vec2' | 'vec3' | 'vec4' | 'quat' | 'color';
interface PtrFieldDesc {
    readonly name: string;
    readonly type: PtrFieldType;
    readonly offset: number;
}
interface PtrLayout {
    readonly ptrFn: string;
    readonly fields: readonly PtrFieldDesc[];
}
declare const PTR_LAYOUTS: Record<string, PtrLayout>;

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

interface TouchPoint {
    id: number;
    x: number;
    y: number;
}
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
    touches: Map<number, TouchPoint>;
    touchesStarted: Map<number, TouchPoint>;
    touchesEnded: Set<number>;
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
    getTouches(): TouchPoint[];
    getTouchCount(): number;
    getTouch(id: number): TouchPoint | null;
    isTouchActive(id: number): boolean;
    clearFrameState(): void;
}
declare const Input: ResourceDef<InputState>;
declare class InputPlugin implements Plugin {
    name: string;
    private target_;
    private unbind_;
    constructor(target?: unknown);
    build(app: App): void;
    cleanup(): void;
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
interface LayoutResult$1 {
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
}): LayoutResult$1;
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
    strokeColor: Color;
    strokeWidth: number;
    shadowColor: Color;
    shadowBlur: number;
    shadowOffsetX: number;
    shadowOffsetY: number;
    richText: boolean;
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

type ResolvedImage = ImageBitmap | HTMLImageElement;
interface ImageResolver {
    resolve(src: string): ResolvedImage | null;
    readonly pendingEntities: Set<Entity>;
}
declare function setImageResolver(resolver: ImageResolver | null): void;
declare function getImageResolver(): ImageResolver | null;
type UrlMapper = (src: string) => string;
declare class DefaultImageResolver implements ImageResolver {
    readonly pendingEntities: Set<number>;
    private cache_;
    private loading_;
    private failed_;
    private entitySrcMap_;
    private srcEntityMap_;
    private urlMapper_;
    constructor(urlMapper: UrlMapper);
    resolve(src: string): ResolvedImage | null;
    preload(src: string): void;
    trackEntity(entity: Entity, srcs: string[]): void;
    invalidate(src: string): void;
    invalidateAll(): void;
    retryFailed(): void;
    untrackEntity(entity: Entity): void;
}

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
    private imageResolver_;
    constructor(module: ESEngineModule);
    beginFrame(): void;
    setImageResolver(resolver: ImageResolver | null): void;
    private renderText;
    private renderTextInner;
    private truncateWithEllipsis;
    private truncateRichLine;
    private lineBaseX;
    renderForEntity(entity: Entity, text: TextData, uiRect?: SizedRect | null): TextRenderResult;
    getCached(entity: Entity): TextRenderResult | undefined;
    release(entity: Entity): void;
    cleanupOrphaned(isAlive: (entity: Entity) => boolean): void;
    releaseAll(): void;
    private measureWidth;
    private mapAlign;
}

declare class TextPlugin implements Plugin {
    name: "text";
    dependencies: "uiLayout"[];
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
    name: "uiMask";
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
declare function quaternionToAngle2D(rz: number, rw: number): number;
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

type UIEventType = 'click' | 'press' | 'release' | 'hover_enter' | 'hover_exit' | 'focus' | 'blur' | 'submit' | 'change' | 'drag_start' | 'drag_move' | 'drag_end' | 'scroll' | 'select' | 'deselect';
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
    name: string;
    build(app: App): void;
}
declare const uiLayoutPlugin: UILayoutPlugin;

declare class UIInteractionPlugin implements Plugin {
    name: "uiInteraction";
    dependencies: "uiLayout"[];
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
    name: "textInput";
    dependencies: "focus"[];
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
    name: "image";
    dependencies: "uiLayout"[];
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
    name: "toggle";
    dependencies: "uiInteraction"[];
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
    name: "progressBar";
    dependencies: "uiLayout"[];
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
    name: "drag";
    dependencies: "uiInteraction"[];
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
    name: "scrollView";
    dependencies: "uiLayout"[];
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
    name: "slider";
    dependencies: "uiInteraction"[];
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
    name: "focus";
    dependencies: "uiInteraction"[];
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
    name: "safeArea";
    dependencies: "uiLayout"[];
    build(app: App): void;
}
declare const safeAreaPlugin: SafeAreaPlugin;

interface DropdownData {
    options: string[];
    selectedIndex: number;
    isOpen: boolean;
    listEntity: Entity;
    labelEntity: Entity;
}
declare const Dropdown: ComponentDef<DropdownData>;

declare class DropdownPlugin implements Plugin {
    name: "dropdown";
    dependencies: "uiInteraction"[];
    private cleanup_;
    cleanup(): void;
    build(app: App): void;
}
declare const dropdownPlugin: DropdownPlugin;

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
declare const AlignContent: {
    readonly Start: 0;
    readonly Center: 1;
    readonly End: 2;
    readonly Stretch: 3;
    readonly SpaceBetween: 4;
    readonly SpaceAround: 5;
};
type AlignContent = (typeof AlignContent)[keyof typeof AlignContent];
interface FlexContainerData {
    direction: FlexDirection;
    wrap: FlexWrap;
    justifyContent: JustifyContent;
    alignItems: AlignItems;
    alignContent: AlignContent;
    gap: Vec2;
    padding: Padding;
}

declare const AlignSelf: {
    readonly Auto: 0;
    readonly Start: 1;
    readonly Center: 2;
    readonly End: 3;
    readonly Stretch: 4;
};
type AlignSelf = (typeof AlignSelf)[keyof typeof AlignSelf];
interface FlexItemData {
    flexGrow: number;
    flexShrink: number;
    flexBasis: number;
    order: number;
    alignSelf: AlignSelf;
    margin: Padding;
    minWidth: number;
    minHeight: number;
    maxWidth: number;
    maxHeight: number;
    widthPercent: number;
    heightPercent: number;
}

declare class UIRenderOrderPlugin implements Plugin {
    name: "uiRenderOrder";
    dependencies: "uiLayout"[];
    after: ("uiInteraction" | "uiMask" | "collectionView" | "text" | "image" | "scrollView" | "layoutGroup")[];
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

declare class StateMachinePlugin implements Plugin {
    name: "stateMachine";
    dependencies: "uiInteraction"[];
    build(app: App): void;
}
declare const stateMachinePlugin: StateMachinePlugin;

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

interface TextSegment {
    type: 'text';
    text: string;
    bold: boolean;
    italic: boolean;
    color: Color | null;
}
type ImageValign = 'baseline' | 'middle' | 'top' | 'bottom';
interface ImageSegment {
    type: 'image';
    src: string;
    width: number;
    height: number;
    valign: ImageValign;
    offsetX: number;
    offsetY: number;
    scale: number;
    tint: Color | null;
}
type RichTextRun = TextSegment | ImageSegment;
declare function parseRichText(input: string): RichTextRun[];

declare const SelectionMode: {
    readonly None: 0;
    readonly Single: 1;
    readonly Multiple: 2;
};
type SelectionMode = (typeof SelectionMode)[keyof typeof SelectionMode];
interface CollectionViewData {
    itemCount: number;
    layout: string;
    virtualized: boolean;
    overscan: number;
    selectionMode: SelectionMode;
    selectedIndices: number[];
    itemPrefab: string;
}
declare const CollectionView: ComponentDef<CollectionViewData>;
interface CollectionItemData {
    collectionEntity: Entity;
    dataIndex: number;
    selected: boolean;
}
declare const CollectionItem: ComponentDef<CollectionItemData>;

interface CollectionAdapter {
    makeItem(entity: Entity, world: World): void;
    bindItem(entity: Entity, index: number, world: World): void;
    unbindItem?(entity: Entity, index: number, world: World): void;
    getItemType?(index: number): string;
}
declare function setCollectionAdapter(entity: Entity, adapter: CollectionAdapter): void;
declare function getCollectionAdapter(entity: Entity): CollectionAdapter | null;
declare function removeCollectionAdapter(entity: Entity): void;

interface LayoutResult {
    index: number;
    position: {
        x: number;
        y: number;
    };
    size: {
        x: number;
        y: number;
    };
    rotation?: number;
}
declare const ScrollAlign: {
    readonly Start: 0;
    readonly Center: 1;
    readonly End: 2;
    readonly Auto: 3;
};
type ScrollAlign = (typeof ScrollAlign)[keyof typeof ScrollAlign];
interface LayoutProvider {
    getContentSize(itemCount: number, viewportSize: {
        x: number;
        y: number;
    }, config: unknown): {
        width: number;
        height: number;
    };
    getVisibleRange(scrollOffset: {
        x: number;
        y: number;
    }, viewportSize: {
        x: number;
        y: number;
    }, itemCount: number, overscan: number, config: unknown): LayoutResult[];
    getScrollOffsetForIndex(index: number, viewportSize: {
        x: number;
        y: number;
    }, itemCount: number, config: unknown, align: ScrollAlign): {
        x: number;
        y: number;
    };
}
declare function registerLayoutProvider(name: string, provider: LayoutProvider): void;
declare function getLayoutProvider(name: string): LayoutProvider | null;

declare class ItemPool {
    private pools_;
    acquire(type?: string): Entity | undefined;
    release(entity: Entity, type?: string): void;
    clear(world: World): void;
    get size(): number;
}

interface CollectionState {
    pool: ItemPool;
    activeItems: Map<number, Entity>;
    prevItemCount: number;
    dirty: boolean;
}
declare class CollectionViewPlugin implements Plugin {
    name: "collectionView";
    dependencies: "uiLayout"[];
    private states_;
    private cleanup_;
    getState(entity: Entity): CollectionState | null;
    build(app: App): void;
    private getLayoutConfig_;
    private createItem_;
    private positionItem_;
    private hideItem_;
    private showItem_;
}
declare const collectionViewPlugin: CollectionViewPlugin;

declare function collectionGetItemEntity(world: World, collectionEntity: Entity, index: number): Entity | null;
declare function collectionRefreshItems(world: World, collectionEntity: Entity): void;
declare function collectionRefreshItem(world: World, collectionEntity: Entity, index: number): void;
declare function collectionInsertItems(world: World, collectionEntity: Entity, startIndex: number, count: number): void;
declare function collectionRemoveItems(world: World, collectionEntity: Entity, startIndex: number, count: number): void;

interface LinearLayoutData {
    direction: number;
    itemSize: number;
    spacing: number;
    reverseOrder: boolean;
}
declare const LinearLayout: ComponentDef<LinearLayoutData>;

interface GridLayoutData {
    direction: number;
    crossAxisCount: number;
    itemSize: {
        x: number;
        y: number;
    };
    spacing: {
        x: number;
        y: number;
    };
}
declare const GridLayout: BuiltinComponentDef<GridLayoutData>;

interface FanLayoutData {
    radius: number;
    maxSpreadAngle: number;
    maxCardAngle: number;
    tiltFactor: number;
    cardSpacing: number;
    direction: number;
}
declare const FanLayout: BuiltinComponentDef<FanLayoutData>;

declare class LinearLayoutProvider implements LayoutProvider {
    getContentSize(itemCount: number, viewportSize: {
        x: number;
        y: number;
    }, config: unknown): {
        width: number;
        height: number;
    };
    getVisibleRange(scrollOffset: {
        x: number;
        y: number;
    }, viewportSize: {
        x: number;
        y: number;
    }, itemCount: number, overscan: number, config: unknown): LayoutResult[];
    getScrollOffsetForIndex(index: number, viewportSize: {
        x: number;
        y: number;
    }, itemCount: number, config: unknown, align: ScrollAlign): {
        x: number;
        y: number;
    };
}

declare class GridLayoutProvider implements LayoutProvider {
    getContentSize(itemCount: number, viewportSize: {
        x: number;
        y: number;
    }, config: unknown): {
        width: number;
        height: number;
    };
    getVisibleRange(scrollOffset: {
        x: number;
        y: number;
    }, viewportSize: {
        x: number;
        y: number;
    }, itemCount: number, overscan: number, config: unknown): LayoutResult[];
    getScrollOffsetForIndex(index: number, viewportSize: {
        x: number;
        y: number;
    }, itemCount: number, config: unknown, align: ScrollAlign): {
        x: number;
        y: number;
    };
}

declare function computeFanPositions(itemCount: number, config: FanLayoutData, excludeIndices?: Set<number>): LayoutResult[];
declare class FanLayoutProvider implements LayoutProvider {
    getContentSize(itemCount: number, _viewportSize: {
        x: number;
        y: number;
    }, config: unknown): {
        width: number;
        height: number;
    };
    getVisibleRange(_scrollOffset: {
        x: number;
        y: number;
    }, _viewportSize: {
        x: number;
        y: number;
    }, itemCount: number, _overscan: number, config: unknown): LayoutResult[];
    getScrollOffsetForIndex(_index: number, _viewportSize: {
        x: number;
        y: number;
    }, _itemCount: number, _config: unknown, _align: ScrollAlign): {
        x: number;
        y: number;
    };
}

interface SelectableData {
    selected: boolean;
    group: number;
}
declare const Selectable: BuiltinComponentDef<SelectableData>;

/**
 * @file    ui/index.ts
 * @brief   UI module exports
 */

declare const AnimOverride: {
    readonly POS_X: 1;
    readonly POS_Y: 2;
    readonly ROT_Z: 4;
    readonly SCALE_X: 8;
    readonly SCALE_Y: 16;
};

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

type AssetsData = Assets$1;
declare const Assets: ResourceDef<Assets$1>;
declare class AssetPlugin implements Plugin {
    name: string;
    build(app: App): void;
}
declare const assetPlugin: AssetPlugin;

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
    private textures_;
    private fonts_;
    private materials_;
    addTextureRef(path: string, entity: number): void;
    removeTextureRef(path: string, entity: number): void;
    getTextureRefCount(path: string): number;
    getTextureRefs(path: string): number[];
    getAllTextureRefs(): AssetRefInfo[];
    addFontRef(path: string, entity: number): void;
    removeFontRef(path: string, entity: number): void;
    getFontRefCount(path: string): number;
    getFontRefs(path: string): number[];
    getAllFontRefs(): AssetRefInfo[];
    addMaterialRef(path: string, entity: number): void;
    removeMaterialRef(path: string, entity: number): void;
    getMaterialRefCount(path: string): number;
    getMaterialRefs(path: string): number[];
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

interface ComponentData {
    type: string;
    data: Record<string, unknown>;
}
interface PrefabData {
    version: string;
    name: string;
    rootEntityId: number;
    entities: PrefabEntityData[];
    basePrefab?: string;
    overrides?: PrefabOverride[];
}
interface PrefabEntityData {
    prefabEntityId: number;
    name: string;
    parent: number | null;
    children: number[];
    components: ComponentData[];
    visible: boolean;
    nestedPrefab?: NestedPrefabRef;
}
interface NestedPrefabRef {
    prefabPath: string;
    overrides: PrefabOverride[];
}
interface PrefabOverride {
    prefabEntityId: number;
    type: 'property' | 'component_added' | 'component_removed' | 'name' | 'visibility';
    componentType?: string;
    propertyName?: string;
    value?: unknown;
    componentData?: ComponentData;
}
interface ProcessedEntity {
    id: number;
    prefabEntityId: number;
    name: string;
    parent: number | null;
    children: number[];
    components: ComponentData[];
    visible: boolean;
}
interface FlattenContext {
    allocateId: () => number;
    loadPrefab: (path: string) => PrefabData | null;
    visited?: Set<string>;
    depth?: number;
}
interface FlattenResult {
    entities: ProcessedEntity[];
    rootId: number;
}

declare function flattenPrefab(prefab: PrefabData, overrides: PrefabOverride[], ctx: FlattenContext): FlattenResult;

declare function applyOverrides(entity: ProcessedEntity, overrides: PrefabOverride[]): void;

declare function remapComponentEntityRefs(components: ComponentData[], idMapping: Map<number, number>): void;

declare function cloneComponents(components: ComponentData[]): ComponentData[];
declare function cloneComponentData(data: Record<string, unknown>): Record<string, unknown>;

declare function collectNestedPrefabPaths(prefab: PrefabData, loadPrefab: (path: string) => PrefabData | null, visited?: Set<string>): string[];
declare function preloadNestedPrefabs(prefab: PrefabData, loadPrefab: (path: string) => Promise<PrefabData>, cache: Map<string, PrefabData>, visited?: Set<string>, depth?: number): Promise<void>;

interface InstantiatePrefabOptions {
    assets?: Assets$1;
    assetBaseUrl?: string;
    parent?: Entity;
    overrides?: PrefabOverride[];
}
interface InstantiatePrefabResult {
    root: Entity;
    entities: Map<number, Entity>;
}
declare function instantiatePrefab(world: World, prefab: PrefabData, options?: InstantiatePrefabOptions): Promise<InstantiatePrefabResult>;

declare class PrefabServer {
    private readonly world_;
    private readonly assets_;
    constructor(world: World, assets: Assets$1);
    instantiate(pathOrAddress: string, options?: {
        baseUrl?: string;
        parent?: Entity;
        overrides?: PrefabOverride[];
    }): Promise<InstantiatePrefabResult>;
}
declare const Prefabs: ResourceDef<PrefabServer>;
declare class PrefabsPlugin implements Plugin {
    name: string;
    dependencies: ResourceDef<Assets$1>[];
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
    spineManager?: SpineManager | null;
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
    spineManager?: SpineManager | null;
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
    name: string;
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
    onTouchStart?(id: number, x: number, y: number): void;
    onTouchMove?(id: number, x: number, y: number): void;
    onTouchEnd?(id: number): void;
    onTouchCancel?(id: number): void;
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
    devicePixelRatio(): number;
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
    beginFrame(): void;
    updateTransforms(registry: {
        _cpp: CppRegistry;
    }): void;
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
declare function playModeOnly(): boolean;

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
    duration?: number;
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
    infinite: boolean;
    chunks: Record<string, number[]>;
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
    setRenderProps(entity: number, textureHandle: number, tilesetColumns: number, uvTileW: number, uvTileH: number, sortLayer: number, depth: number, parallaxX: number, parallaxY: number): void;
    setTint(entity: number, r: number, g: number, b: number, a: number, opacity: number): void;
    setVisible(entity: number, visible: boolean): void;
    setOriginEntity(layerKey: number, originEntity: number): void;
    submitLayer(entity: number, textureId: number, sortLayer: number, depth: number, tilesetColumns: number, uvTileWidth: number, uvTileHeight: number, originX: number, originY: number, camLeft: number, camBottom: number, camRight: number, camTop: number, tintR: number, tintG: number, tintB: number, tintA: number, opacity: number, parallaxX: number, parallaxY: number): void;
    setTileAnimation(entity: number, tileId: number, frames: {
        tileId: number;
        duration: number;
    }[]): void;
    advanceAnimations(entity: number, dtMs: number): void;
    setTileProperty(entity: number, tileId: number, key: string, value: string): void;
    getTileProperty(entity: number, x: number, y: number, key: string): string;
    flipTile(entity: number, x: number, y: number, flipH: boolean, flipV: boolean, flipD: boolean): void;
    rotateTile(entity: number, x: number, y: number, degrees: number): void;
    initInfiniteLayer(entity: number, tileWidth: number, tileHeight: number): void;
    setChunkTiles(entity: number, chunkX: number, chunkY: number, tiles: Uint16Array, width: number, height: number): void;
    setGridType(entity: number, type: number): void;
    tileToWorld(entity: number, tx: number, ty: number, originX: number, originY: number): {
        x: number;
        y: number;
    };
    worldToTile(entity: number, wx: number, wy: number, originX: number, originY: number): {
        x: number;
        y: number;
    };
};

declare class TilemapPlugin implements Plugin {
    name: string;
    private initializedLayers_;
    private animatedLayers_;
    private sourceEntityKeys_;
    private layerState_;
    build(app: App): void;
    resetLayers(): void;
    cleanup(): void;
}
declare const tilemapPlugin: TilemapPlugin;

interface TiledChunkData {
    x: number;
    y: number;
    width: number;
    height: number;
    tiles: Uint16Array;
}
interface TiledLayerData {
    name: string;
    width: number;
    height: number;
    visible: boolean;
    tiles: Uint16Array;
    chunks: TiledChunkData[];
    infinite: boolean;
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
interface TiledAnimFrame {
    tileId: number;
    duration: number;
}
interface TiledMapData {
    width: number;
    height: number;
    tileWidth: number;
    tileHeight: number;
    orientation: string;
    layers: TiledLayerData[];
    tilesets: TiledTilesetData[];
    objectGroups: TiledObjectGroupData[];
    collisionTileIds: number[];
    tileAnimations: Map<number, TiledAnimFrame[]>;
    tileProperties: Map<number, Map<string, string>>;
}
declare function parseTmjJson(json: Record<string, unknown>): TiledMapData | null;
declare function resolveRelativePath(basePath: string, relativePath: string): string;
declare function parseTiledMap(jsonString: string, resolveExternal?: (source: string) => Promise<string>): Promise<TiledMapData | null>;
interface TilemapLoadOptions {
    generateObjectCollision?: boolean;
    collisionTileIds?: number[];
}
declare function loadTiledMap(world: World, mapData: TiledMapData, textureHandles: Map<string, number>, options?: TilemapLoadOptions): Entity[];

interface LoadedTilemapChunk {
    x: number;
    y: number;
    width: number;
    height: number;
    tiles: Uint16Array;
}
interface LoadedTilemapLayer {
    name: string;
    width: number;
    height: number;
    tiles: Uint16Array;
    chunks: LoadedTilemapChunk[];
    infinite: boolean;
}
interface LoadedTilemapTileset {
    textureHandle: number;
    columns: number;
}
interface LoadedTilemapSource {
    tileWidth: number;
    tileHeight: number;
    orientation?: string;
    layers: LoadedTilemapLayer[];
    tilesets: LoadedTilemapTileset[];
    tileAnimations?: Map<number, {
        tileId: number;
        duration: number;
    }[]>;
    tileProperties?: Map<number, Map<string, string>>;
}
declare function registerTilemapSource(path: string, data: LoadedTilemapSource): void;
declare function getTilemapSource(path: string): LoadedTilemapSource | undefined;
declare function clearTilemapSourceCache(): void;

interface TextureDimensions {
    width: number;
    height: number;
}
declare function initResourceManager(rm: CppResourceManager): void;
declare function shutdownResourceManager(): void;
declare function getResourceManager(): CppResourceManager | null;
declare function requireResourceManager(): CppResourceManager;
declare function evictTextureDimensions(handle: number): void;
declare function getTextureDimensions(handle: number): TextureDimensions | null;

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
    readonly name = "stats";
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

interface SpineModuleEntry {
    factory: (opts: unknown) => Promise<SpineWasmModule>;
    wasmBase64: string;
}
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
    spineModules?: Record<string, SpineModuleEntry>;
    physicsWasmBase64?: string;
    physicsConfig?: {
        gravity?: Vec2;
        fixedTimestep?: number;
        subStepCount?: number;
    };
    manifest?: AddressableManifest | null;
}
declare function initPlayableRuntime(config: PlayableRuntimeConfig): Promise<void>;

declare const corePlugin: Plugin;
declare const DEFAULT_UI_CAMERA_INFO: {
    readonly viewProjection: Float32Array<ArrayBuffer>;
    readonly vpX: 0;
    readonly vpY: 0;
    readonly vpW: 0;
    readonly vpH: 0;
    readonly screenW: 0;
    readonly screenH: 0;
    readonly worldLeft: 0;
    readonly worldBottom: 0;
    readonly worldRight: 0;
    readonly worldTop: 0;
    readonly worldMouseX: 0;
    readonly worldMouseY: 0;
    readonly valid: false;
};

/**
 * @file    context.ts
 * @brief   Explicit application context replacing globalThis implicit coupling
 */
interface EditorBridge {
    registerComponent(name: string, defaults: Record<string, unknown>, isTag: boolean): void;
}
interface PendingSystemEntry {
    schedule: number;
    system: unknown;
}
declare class AppContext {
    readonly componentRegistry: Map<string, any>;
    readonly pendingSystems: PendingSystemEntry[];
    editorBridge: EditorBridge | null;
    /** @brief Drain all pending systems and clear the queue */
    drainPendingSystems(): PendingSystemEntry[];
    /** @brief Reset all mutable state for a new session */
    reset(): void;
}
declare function getDefaultContext(): AppContext;
declare function setDefaultContext(ctx: AppContext): void;

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
    readonly Marker: "marker";
    readonly CustomEvent: "customEvent";
    readonly AnimFrames: "animFrames";
};
type TrackType = (typeof TrackType)[keyof typeof TrackType];
declare const InterpType: {
    readonly Hermite: "hermite";
    readonly Linear: "linear";
    readonly Step: "step";
    readonly EaseIn: "easeIn";
    readonly EaseOut: "easeOut";
    readonly EaseInOut: "easeInOut";
};
type InterpType = (typeof InterpType)[keyof typeof InterpType];
interface Keyframe {
    time: number;
    value: number;
    inTangent: number;
    outTangent: number;
    interpolation?: InterpType;
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
interface Marker {
    time: number;
    name: string;
}
interface MarkerTrack extends TrackBase {
    type: typeof TrackType.Marker;
    markers: Marker[];
}
interface CustomEvent {
    time: number;
    name: string;
    payload: Record<string, unknown>;
}
interface CustomEventTrack extends TrackBase {
    type: typeof TrackType.CustomEvent;
    events: CustomEvent[];
}
interface AnimFrame {
    texture: string;
    duration?: number;
}
interface AnimFramesTrack extends TrackBase {
    type: typeof TrackType.AnimFrames;
    frames: AnimFrame[];
}
type Track = PropertyTrack | SpineTrack | SpriteAnimTrack | AudioTrack | ActivationTrack | MarkerTrack | CustomEventTrack | AnimFramesTrack;
interface TimelineAsset {
    version: string;
    type: 'timeline';
    duration: number;
    wrapMode: WrapMode;
    tracks: Track[];
}

declare function parseTimelineAsset(raw: any): TimelineAsset;

declare function getTimelineHandle(entity: Entity): number | undefined;
declare function clearTimelineHandles(): void;
declare const TimelineControl: {
    play(entity: Entity): void;
    pause(entity: Entity): void;
    stop(entity: Entity): void;
    setTime(entity: Entity, time: number): void;
    isPlaying(entity: Entity): boolean;
    getCurrentTime(entity: Entity): number;
};

interface TimelinePlayerData {
    timeline: string;
    playing: boolean;
    speed: number;
    wrapMode: string;
}
declare const TimelinePlayer: ComponentDef<TimelinePlayerData>;
declare function registerTimelineAsset(path: string, asset: TimelineAsset): void;
declare class TimelinePlugin implements Plugin {
    name: string;
    private loadedAssets_;
    private textureHandles_;
    private handles_;
    private animFramesStates_;
    registerAsset(path: string, asset: TimelineAsset): void;
    getAsset(path: string): TimelineAsset | undefined;
    registerTextureHandles(path: string, handles: Map<string, number>): void;
    getTextureHandle(timelinePath: string, textureUuid: string): number;
    build(app: App): void;
    clearHandles(): void;
    cleanup(): void;
    private processAnimFrames;
}
declare const timelinePlugin: TimelinePlugin;

interface CreateWebAppOptions extends WebAppOptions {
    spineProvider?: SpineWasmProvider;
}
declare function createWebApp(module: ESEngineModule, options?: CreateWebAppOptions): App;

export { AnimOverride, AnimationPlugin, AnyComponentDef, App, AppContext, AssetPlugin, AssetRefCounter, Assets, AsyncCache, AttenuationModel, Audio, AudioBus, AudioListener, AudioMixer, AudioPlugin, AudioPool, AudioSource, BlendMode, BuiltinComponentDef, Button, ButtonState, CollectionItem, CollectionView, CollectionViewPlugin, Color, ComponentDef, CppRegistry, CppResourceManager, DARK_THEME, DEFAULT_DESIGN_HEIGHT, DEFAULT_DESIGN_WIDTH, DEFAULT_FALLBACK_DT, DEFAULT_FIXED_TIMESTEP, DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE, DEFAULT_GRAVITY, DEFAULT_LINE_HEIGHT, DEFAULT_MAX_DELTA_TIME, DEFAULT_PIXELS_PER_UNIT, DEFAULT_SPINE_SKIN, DEFAULT_SPRITE_SIZE, DEFAULT_TEXT_CANVAS_SIZE, DEFAULT_UI_CAMERA_INFO, DataType, DefaultImageResolver, DragPlugin, DragState, Draggable, Draw, Dropdown, DropdownPlugin, ESEngineModule, EasingType, Entity, EntityStateMap, FanLayout, FanLayoutProvider, FillDirection, FillMethod, FillOrigin, FlushReason, FocusManager, FocusManagerState, FocusPlugin, Focusable, FrameHistory, GLDebug, Geometry, GridLayout, GridLayoutProvider, Image, ImagePlugin, ImageType, Input, InputPlugin, InputState, Interactable, ItemPool, LinearLayout, LinearLayoutProvider, LogLevel, Logger, LoopMode, MaskMode, MaterialHandle, MaterialLoader, PTR_LAYOUTS, Particle, ParticlePlugin, PhysicsWasmModule, Plugin, PostProcess, PostProcessPlugin, PostProcessStack, PrefabServer, Prefabs, PrefabsPlugin, PreviewPlugin, ProgressBar, ProgressBarDirection, ProgressBarPlugin, RenderStage, RenderTexture, RenderType, Renderer, ResourceDef, RuntimeConfig, SafeArea, SafeAreaPlugin, SceneConfig, SceneData, ScrollAlign, ScrollView, ScrollViewPlugin, Selectable, SelectionMode, ShaderHandle, Slider, SliderDirection, SliderPlugin, SpriteAnimator, StateMachinePlugin, Stats, StatsCollector, StatsOverlay, StatsPlugin, Storage, SubmitSkipFlags, Text, TextAlign, TextInput, TextInputPlugin, TextOverflow, TextPlugin, TextRenderer, TextVerticalAlign, TextureHandle, Tilemap, TilemapAPI, TilemapLayer, TilemapPlugin, TimelineControl, TimelinePlayer, TimelinePlugin, Toggle, TogglePlugin, TransformData, Tween, TweenHandle, TweenState, TweenTarget, UI, UICameraInfo, UIEventQueue, UIEvents, UIInteraction, UIInteractionPlugin, UILayoutGeneration, UILayoutPlugin, UIMask, UIMaskPlugin, UIRect, UIRenderOrderPlugin, UIRenderer, UIThemeRes, UIVisualType, Vec2, Vec4, WebAppOptions, WebAssetProvider, World, animationPlugin, applyBuildRuntimeConfig, applyDirectionalFill, applyOverrides, applyRuntimeConfig, assetPlugin, audioPlugin, calculateAttenuation, calculatePanning, cleanupAllPostProcessVolumes, cleanupPostProcessVolume, clearAnimClips, clearTilemapSourceCache, clearTimelineHandles, cloneComponentData, cloneComponents, collectNestedPrefabPaths, collectionGetItemEntity, collectionInsertItems, collectionRefreshItem, collectionRefreshItems, collectionRemoveItems, collectionViewPlugin, colorScale, colorWithAlpha, computeFanPositions, computeFillAnchors, computeFillSize, computeHandleAnchors, computeUIRectLayout, corePlugin, createRuntimeSceneConfig, createWebApp, debug, defaultFrameStats, dragPlugin, dropdownPlugin, error, evictTextureDimensions, extractAnimClipTexturePaths, flattenPrefab, focusPlugin, getAddressableType, getAddressableTypeByEditorType, getAllAssetExtensions, getAllEffectDefs, getAnimClip, getAssetBuildTransform, getAssetMimeType, getAssetTypeEntry, getCollectionAdapter, getCustomExtensions, getDefaultContext, getEditorType, getEffectDef, getEffectTypes, getImageResolver, getLayoutProvider, getLogger, getPlatform, getPlatformType, getResourceManager, getTextureDimensions, getTilemapSource, getTimelineHandle, getWeChatPackOptions, imagePlugin, info, initDrawAPI, initGLDebugAPI, initGeometryAPI, initParticleAPI, initPlayableRuntime, initPostProcessAPI, initRendererAPI, initResourceManager, initRuntime, initTilemapAPI, initTweenAPI, initUIBuilder, inputPlugin, instantiatePrefab, intersectRects, invertMatrix4, isCustomExtension, isEditor, isKnownAssetExtension, isPlatformInitialized, isPlayMode, isRuntime, isWeChat, isWeb, loadRuntimeScene, loadTiledMap, looksLikeAssetPath, makeInteractable, parseAnimClipData, parseRichText, parseTiledMap, parseTimelineAsset, parseTmjJson, particlePlugin, platformFetch, platformFileExists, platformInstantiateWasm, platformReadFile, platformReadTextFile, playModeOnly, pointInOBB, pointInWorldRect, postProcessPlugin, prefabsPlugin, preloadNestedPrefabs, progressBarPlugin, quaternionToAngle2D, registerAnimClip, registerAssetBuildTransform, registerLayoutProvider, registerTilemapSource, registerTimelineAsset, remapComponentEntityRefs, removeCollectionAdapter, requireResourceManager, resolveRelativePath, safeAreaPlugin, sceneManagerPlugin, screenToWorld, scrollViewPlugin, setCollectionAdapter, setDefaultContext, setEditorMode, setEntityColor, setEntityEnabled, setImageResolver, setLogLevel, setPlayMode, setWasmErrorHandler, shutdownDrawAPI, shutdownGLDebugAPI, shutdownGeometryAPI, shutdownParticleAPI, shutdownPostProcessAPI, shutdownRendererAPI, shutdownResourceManager, shutdownTilemapAPI, shutdownTweenAPI, sliderPlugin, spriteAnimatorSystemUpdate, stateMachinePlugin, statsPlugin, syncFillSpriteSize, syncPostProcessVolume, textInputPlugin, textPlugin, tilemapPlugin, timelinePlugin, toBuildPath, togglePlugin, transitionTo, uiInteractionPlugin, uiLayoutPlugin, uiMaskPlugin, uiPlugins, uiRenderOrderPlugin, unregisterAnimClip, warn, withChildEntity };
export type { AddressableAssetType, AddressableManifest, AddressableManifestAsset, AddressableManifestGroup, AnimClipAssetData, AssetBuildTransform, AssetContentType, AssetRefInfo, AssetTypeEntry, AssetsData, AudioBackendInitOptions, AudioBufferHandle, AudioBusConfig, AudioHandle, AudioListenerData, AudioMixerConfig, AudioPluginConfig, AudioSourceData, BezierPoints, ButtonData, ButtonOptions, ButtonTransition, CollectionAdapter, CollectionItemData, LayoutResult as CollectionLayoutResult, CollectionViewData, CreateWebAppOptions, DragStateData, DraggableData, DrawAPI, DrawCallInfo, DropdownData, DropdownOptions, EditorAssetType, EditorBridge, EffectDef, EffectUniformDef, FanLayoutData, FlattenContext, FlattenResult, FlexOptions, FocusableData, FrameCaptureData, FrameSnapshot, FrameStats, GeometryHandle, GeometryOptions, GridLayoutData, ImageData$1 as ImageData, ImageResolver, ImageSegment, InstantiatePrefabOptions, InstantiatePrefabResult, InteractableData, LabelOptions, LayoutProvider, LayoutRect, LayoutResult$1 as LayoutResult, LinearLayoutData, LoadRuntimeSceneOptions, LoadedMaterial, LoadedTilemapLayer, LoadedTilemapSource, LoadedTilemapTileset, LogEntry, LogHandler, NestedPrefabRef, PanelOptions, PlatformAdapter, PlatformAudioBackend, PlatformRequestOptions, PlatformResponse, PlatformType, PlayConfig, PlayableRuntimeConfig, PooledAudioNode, PostProcessEffectData, ComponentData as PrefabComponentData, PrefabData, PrefabEntityData, PrefabOverride, ProcessedEntity, ProgressBarData, ProgressBarOptions, PtrLayout, RenderStats, RenderTargetHandle, RenderTextureHandle, RenderTextureOptions, ResolvedImage, RichTextRun, RuntimeAssetProvider, RuntimeBuildConfig, RuntimeInitConfig, SafeAreaData, ScreenRect, ScrollViewData, ScrollViewOptions, SelectableData, ShaderLoader, SliderData, SliderOptions, SpatialAudioConfig, SpriteAnimClip, SpriteAnimFrame, SpriteAnimatorData, StatsPluginOptions, StatsPosition, TextData, TextInputData, TextInputOptions, TextRenderResult, TextSegment, TextureDimensions, TiledLayerData, TiledMapData, TiledTilesetData, TilemapData, TilemapLayerData, TimelinePlayerData, ToggleData, ToggleOptions, ToggleTransition, TouchPoint, TransitionConfig, TweenOptions, UICameraData, UIEntityDef, UIEvent, UIEventHandler, UIEventType, UIInteractionData, UILayoutGenerationData, UIMaskData, UINode, UIRectData, UIRendererData, UITheme, Unsubscribe, VertexAttributeDescriptor };
