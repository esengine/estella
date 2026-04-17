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

export { Filters } from './filters';

export {
    SpriteFilter,
    type OutlineFilterOptions,
    type DropShadowFilterOptions,
} from './spriteFilter';

// =============================================================================
// Graphics
// =============================================================================

export { Graphics } from './graphics';

// =============================================================================
// Texture
// =============================================================================

export { TextureFilter, TextureWrap, setTextureFilter, setTextureWrap, setTextureParams } from './textureParams';

// =============================================================================
// Camera
// =============================================================================

export { CameraUtils } from './camera/Camera';

// =============================================================================
// Draw API
// =============================================================================

export {
    Draw,
    BlendMode,
    initDrawAPI,
    shutdownDrawAPI,
    type DrawAPI,
} from './draw';

// =============================================================================
// Material API
// =============================================================================

export {
    Material,
    ShaderSources,
    initMaterialAPI,
    shutdownMaterialAPI,
    registerMaterialCallback,
    isTextureRef,
    type ShaderHandle,
    type MaterialHandle,
    type MaterialOptions,
    type MaterialAssetData,
    type UniformValue,
    type TextureRef,
} from './material';

// =============================================================================
// Geometry API
// =============================================================================

export {
    Geometry,
    DataType,
    initGeometryAPI,
    shutdownGeometryAPI,
    type GeometryHandle,
    type GeometryOptions,
    type VertexAttributeDescriptor,
} from './geometry';

// =============================================================================
// PostProcess API
// =============================================================================

export {
    PostProcess,
    PostProcessStack,
    initPostProcessAPI,
    shutdownPostProcessAPI,
    type EffectDef,
    type EffectUniformDef,
    type PostProcessEffectData,
    getEffectDef,
    getEffectTypes,
    getAllEffectDefs,
    syncPostProcessVolume,
    cleanupPostProcessVolume,
    cleanupAllPostProcessVolumes,
} from './postprocess';

// =============================================================================
// Renderer API
// =============================================================================

export {
    Renderer,
    RenderStage,
    SubmitSkipFlags,
    initRendererAPI,
    shutdownRendererAPI,
    type RenderTargetHandle,
    type RenderStats,
} from './renderer';

export {
    FlushReason,
    RenderType,
    type DrawCallInfo,
    type FrameCaptureData,
} from './frameCapture';

// =============================================================================
// RenderTexture API
// =============================================================================

export {
    RenderTexture,
    type RenderTextureHandle,
    type RenderTextureOptions,
} from './renderTexture';

// =============================================================================
// Render Pipeline
// =============================================================================

export {
    RenderPipeline,
    type Viewport,
    type RenderParams,
    type CameraRenderParams,
} from './renderPipeline';

// =============================================================================
// Custom Draw Callbacks
// =============================================================================

export {
    registerDrawCallback,
    unregisterDrawCallback,
    clearDrawCallbacks,
    type DrawCallback,
} from './customDraw';
