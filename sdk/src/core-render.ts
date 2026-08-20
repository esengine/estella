// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    core-render.ts
 * @brief   Rendering + graphics surface.
 *
 * Draw / Material / Geometry / PostProcess / Renderer APIs, render-pipeline
 * composition, render textures, frame capture, filters, graphics primitives,
 * texture parameters, and camera utilities.
 *
 * Re-exported wholesale by `core.ts`.
 */

// =============================================================================
// Filters
// =============================================================================

export { Filters } from './render/filters';

export { LIGHT_FORWARD, lightAimRotation, lightAimOf } from './render/lightAim';

export {
    SpriteFilter,
    type OutlineFilterOptions,
    type DropShadowFilterOptions,
} from './render/spriteFilter';

// =============================================================================
// Graphics
// =============================================================================

export { Graphics } from './render/graphics';

// =============================================================================
// Texture
// =============================================================================

export { TextureFilter, TextureWrap, setTextureFilter, setTextureWrap, setTextureParams, setTextureSliceBorder } from './render/textureParams';

// =============================================================================
// Camera
// =============================================================================

export { CameraView, CameraViewAPI } from './camera/Camera';
export { EditorView, DEFAULT_EDITOR_VIEW, editorViewHalfHeight, editorViewHalfExtent, editorViewWorldPerPixel, setEditorViewHalfHeight, editorViewIsOrbited, editorViewAxes, editorViewAxisAngles, editorViewBasis, editorViewEye, editorViewStandoff, editorViewClipFar, editorViewClipNear, editorViewWorkPlane, screenWorkAxes, worldAxisVector, moveEditorViewFocus, editorViewBoxExtent } from './camera/EditorView';
export type { EditorViewData, ScreenAxis, EditorViewBasis, EditorWorkPlane, WorldAxis } from './camera/EditorView';
export { ScreenScaling, DEFAULT_SCREEN_SCALING, SCREEN_FIT_OFF } from './camera/ScreenScaling';
export type { ScreenScalingData } from './camera/ScreenScaling';
export { EditorGrid, DEFAULT_EDITOR_GRID } from './camera/EditorGrid';
export type { EditorGridData, GridColor } from './camera/EditorGrid';
export { installEditorGrid } from './camera/editorGridRenderer';
export { CameraDirector, setViewTarget, shakeCamera, BlendCurve } from './camera/CameraDirector';
export { FollowTarget } from './camera/FollowTarget';
export type { FollowTargetData } from './camera/FollowTarget';
export { CameraBounds } from './camera/CameraBounds';
export type { CameraBoundsData } from './camera/CameraBounds';
export type { CameraDirectorState } from './camera/CameraDirector';
export type { CameraPOV } from './camera/CameraPlugin';
export { cameraFrustumCorners } from './camera/CameraPlugin';
export type { CameraFields, CameraTransformFields } from './camera/CameraPlugin';
export { computeEffectiveOrthoSize, uiLayoutRect, EDITOR_VIEW_ENTITY, EDITOR_UI_ANCHOR } from './camera/uiLayoutRect';
export type { CameraExtents, CanvasScale, WorldRect } from './camera/uiLayoutRect';

// =============================================================================
// Draw API
// =============================================================================

export {
    Draw,
    BlendMode,
    shutdownDrawAPI,
    type DrawAPI,
} from './render/draw';

// =============================================================================
// Material API
// =============================================================================

export {
    Material,
    ShaderSources,
    shutdownMaterialAPI,
    isTextureRef,
    CullMode,
    MATERIAL_FORMAT_VERSION,
    type ShaderHandle,
    type MaterialHandle,
    type MaterialOptions,
    type MaterialData,
    type MaterialAssetData,
    type UniformValue,
    type TextureRef,
} from './render/material';

export { renderMeshPreview } from './render/assetPreview';

export {
    BUILTIN_SHADER_TEMPLATES,
    builtinShaderTemplate,
    type BuiltinShaderTemplate,
} from './render/builtinShaders';

// What a `.esshader` declares, read from its source: the editor's parameter panel, the
// built-in templates' defaults and setUniform's "no such param" all read the one parser.
export {
    reflectEsshader,
    paramDefaultValue,
    type ShaderParam,
    type ShaderParamType,
    type ShaderReflection,
} from './render/shaderReflect';

export {
    compileMaterialGraph,
    newMaterialGraph,
    addNode,
    moveNode,
    connect,
    disconnect,
    removeNode,
    NODE_SPECS,
    type MaterialGraph,
    type MaterialGraphNode,
    type GraphNodeType,
    type GraphType,
    type NodeSpec,
    type NodePort,
    type NodeParamSpec,
} from './render/materialGraph';

// =============================================================================
// Geometry API
// =============================================================================

export {
    Geometry,
    DataType,
    shutdownGeometryAPI,
    type GeometryHandle,
    type GeometryOptions,
    type VertexAttributeDescriptor,
} from './render/geometry';

// =============================================================================
// PostProcess API
// =============================================================================

export {
    PostProcess,
    PostProcessAPI,
    PostProcessStack,
    type EffectDef,
    type EffectUniformDef,
    getEffectDef,
    getEffectTypes,
    getAllEffectDefs,
} from './postprocess';

// =============================================================================
// Renderer API
// =============================================================================

export {
    Renderer,
    RenderStage,
    SubmitSkipFlags,
    shutdownRendererAPI,
    type RenderTargetHandle,
    type RenderStats,
} from './render/renderer';

// =============================================================================
// Device Loss
// =============================================================================

export {
    DeviceStatus,
    DeviceLostReason,
    getDeviceStatus,
    getDeviceIdentity,
    type DeviceIdentity,
    getDeviceLostReport,
    reportDeviceLost,
    recoverDevice,
    finishDeviceRecovery,
    getContextLossGuardInfo,
} from './render/renderer';

/**
 * What the engine drew, from the backend that drew it — so a capture is not the
 * display's opinion of the frame.
 *
 * @beta Pre-1.0: the frame-advance callback may become a schedule hook.
 */
/**
 * What a WebGPU device has to be created with for the engine to use everything
 * it ships — compressed textures above all.
 *
 * @beta
 */
export {
    ENGINE_WEBGPU_FEATURES,
    engineWebGPUFeatures,
    type WebGPUAdapterLike,
} from './render/webgpuFeatures';

/**
 * Acquiring the device a WebGPU boot needs, before the module that reads it
 * exists — one answer for every host rather than one each.
 *
 * @beta
 */
export {
    acquireWebGPUDevice,
    type RenderBackendRequest,
    type WebGPUBootResult,
} from './render/webgpuBoot';

export {
    captureFramePixels,
    canCaptureFramePixels,
    type FramePixels,
} from './render/framePixels';

export {
    LayerOrder,
    layerOrderOf,
    layerFrontness,
    compareDrawRank,
    rankPickCandidates,
    type DrawRank,
    type PickCandidate,
} from './render/layerOrder';

export {
    BatchBreak,
    RenderType,
    type DrawCallInfo,
    type FrameCaptureData,
} from './render/frameCapture';

// =============================================================================
// RenderTexture API
// =============================================================================

export {
    RenderTexture,
    type RenderTextureHandle,
    type RenderTextureOptions,
} from './render/renderTexture';

// =============================================================================
// Render Pipeline
// =============================================================================

export {
    RenderPipeline,
    type Viewport,
    type RenderParams,
    type CameraRenderParams,
} from './render/renderPipeline';

// =============================================================================
// Custom Draw Callbacks
// =============================================================================

export {
    registerDrawCallback,
    unregisterDrawCallback,
    clearDrawCallbacks,
    type DrawCallback,
    registerPreSceneDrawCallback,
    unregisterPreSceneDrawCallback,
    type PreSceneDrawCallback,
    type PreSceneDrawInfo,
} from './render/customDraw';
