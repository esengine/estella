// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    wasm.ts
 * @brief   WASM module type definitions
 */

import { Entity } from './types';
import type { Registry as GeneratedRegistry } from './wasm/wasm.generated';

// =============================================================================
// C++ Registry Interface
// =============================================================================

/**
 * A JS-owned C++ EstellaContext instance. Created
 * via `new module.EstellaContext()`, destroyed via `.delete()` — like Registry.
 * Owns one engine's GPU + logic subsystems; `setActiveContext` selects which one
 * the bindings route through.
 */
export interface CppEngineContext {
    /** Initialize GPU subsystems against a WebGL context handle. Returns success. */
    init(webglContextHandle: number): boolean;
    /** Tear down all subsystems + the WebGL context. */
    shutdown(): void;
    isInitialized(): boolean;
    /** Free the underlying C++ instance (embind ownership). */
    delete(): void;
}

export interface CppRegistry extends GeneratedRegistry {
    delete(): void;
    removeParent(entity: Entity): void;

    [key: string]: Function | undefined;
}

// =============================================================================
// C++ Resource Manager
// =============================================================================

export interface CppResourceManager {
    createTexture(width: number, height: number, pixels: number, pixelsLen: number, format: number, flipY: boolean): number;
    createTextureEx(width: number, height: number, pixels: number, pixelsLen: number, format: number, flipY: boolean, filterMode: number, wrapMode: number): number;
    /**
     * Module-free texture upload: take the RGBA bytes directly instead of a wasm
     * heap pointer. Present ONLY on the native ResourceManager (embedded Dawn, no
     * wasm heap to marshal into); the wasm embind object does not implement it, so
     * the upload helpers fall through to the heap path and web stays byte-identical.
     * `filterMode`/`wrapMode` mirror {@link createTextureEx}'s codes (optional). */
    createTextureFromBytes?(width: number, height: number, pixels: Uint8Array, format: number, flipY: boolean, filterMode?: number, wrapMode?: number): number;
    /** Transcode + upload a KTX2/Basis container to a device-supported compressed
     *  format (or RGBA32). Native only (the basis transcoder lives in the host);
     *  the web KTX2 path is WebGL2 + the wasm transcoder instead. */
    createTextureFromKTX2?(bytes: Uint8Array, srgb: boolean): { handle: number; width: number; height: number } | null;
    /** Module-free {@link updateTextureSubregion} — native byte upload for the
     *  glyph atlas, symmetric with {@link createTextureFromBytes}. */
    updateTextureSubregionFromBytes?(handle: number, x: number, y: number, width: number, height: number, pixels: Uint8Array): void;
    createShader(vertSrc: string, fragSrc: string): number;
    registerExternalTexture(glTextureId: number, width: number, height: number): number;
    /** Like registerExternalTexture, but with the actual GPU byte size for the
     *  eviction budget (compressed textures are 4–8× smaller than the RGBA8
     *  estimate the plain variant books). */
    registerExternalTextureSized(glTextureId: number, width: number, height: number, bytes: number): number;
    /**
     * Point an EXISTING texture handle at a freshly uploaded GPU object, so a
     * re-upload after a device loss is invisible to everything holding it.
     * Optional: absent on an older wasm build.
     */
    retargetExternalTexture?(handle: number, glTextureId: number, width: number, height: number): boolean;
    getTextureGLId(handle: number): number;
    getTextureDimensions(handle: number): { width: number; height: number } | null;
    releaseTexture(handle: number): void;
    getTextureRefCount(handle: number): number;
    releaseShader(handle: number): void;
    getShaderRefCount(handle: number): number;
    setTextureMetadata(handle: number, left: number, right: number, top: number, bottom: number): void;
    updateTextureSubregion(handle: number, x: number, y: number, width: number, height: number, pixels: number, pixelsLen: number): void;
    registerTextureWithPath(handle: number, path: string): void;
    setTextureBudget(bytes: number): void;
    acquireTextureByPath(path: string): number;
    invalidateTexturePath(path: string): boolean;
    trimTextureCache(): number;
    getResourceStats(): {
        shaderCount: number;
        textureCount: number;
        vertexBufferCount: number;
        indexBufferCount: number;
        cacheHits: number;
        cacheMisses: number;
        textureBytes: number;
        textureBudget: number;
        textureEvictableCount: number;
    };
    loadBitmapFont(fntContent: string, textureHandle: number, texWidth: number, texHeight: number): number;
    createLabelAtlasFont(textureHandle: number, texWidth: number, texHeight: number, chars: string, charWidth: number, charHeight: number): number;
    releaseBitmapFont(handle: number): void;
    getBitmapFontRefCount(handle: number): number;
    measureBitmapText(fontHandle: number, text: string, fontSize: number, spacing: number): { width: number; height: number };
}

/**
 * GPU objects the graphics device is holding, as {@link ESEngineModule.renderer_getLiveObjects}
 * reports them. The C++ side documents which of these obey a conservation law
 * and which are caches (renderer/rhi/GfxDevice.hpp).
 */
export interface GfxLiveObjects {
    buffers: number;
    textures: number;
    programs: number;
    layouts: number;
    pipelines: number;
    renderTargets: number;
    readbacks: number;
}

// =============================================================================
// WASM Module Interface
// =============================================================================

export interface EmscriptenFS {
    writeFile(path: string, data: string | Uint8Array): void;
    readFile(path: string, opts?: { encoding?: string }): string | Uint8Array;
    mkdir(path: string): void;
    mkdirTree(path: string): void;
    unlink(path: string): void;
    stat(path: string): { mode: number; size: number };
    isFile(mode: number): boolean;
    isDir(mode: number): boolean;
    analyzePath(path: string): { exists: boolean; parentExists: boolean };
}

export interface ESEngineModule {
    Registry: new () => CppRegistry;
    /** JS-newable engine context. */
    EstellaContext: new () => CppEngineContext;
    HEAPU8: Uint8Array;
    HEAPU32: Uint32Array;
    HEAPF32: Float32Array;

    FS: EmscriptenFS;

    initRenderer(): void;
    initRendererWithCanvas(canvasSelector: string): boolean;
    initRendererWithContext(contextHandle: number): boolean;
    /**
     * Boot on the WebGPU backend. The host must acquire a GPUDevice and pass it
     * as `preinitializedWebGPUDevice` in the module factory arg BEFORE
     * instantiation; '#canvas' resolves to the module's canvas. Returns false
     * when the build carries no WebGPU backend or no device was provided.
     */
    initRendererWebGPU(canvasSelector: string, width: number, height: number): boolean;
    shutdownRenderer(): void;
    /**
     * Select which EstellaContext the bindings route through. Pass null to clear.
     * Existing initRenderer paths still set it implicitly; this lets the editor
     * own contexts explicitly.
     */
    setActiveContext(ctx: CppEngineContext | null): void;

    GL: {
        registerContext(ctx: WebGLRenderingContext | WebGL2RenderingContext, options: {
            majorVersion: number;
            minorVersion: number;
            enableExtensionsByDefault?: boolean;
        }): number;
        /** Emscripten-internal: active GL context record (populated after registerContext). */
        currentContext?: { GLctx: WebGLRenderingContext | WebGL2RenderingContext };
        /** Emscripten-internal: every registered context record, indexed by handle (holes possible). */
        contexts?: ({ GLctx: WebGLRenderingContext | WebGL2RenderingContext } | null)[];
        /** Emscripten-internal: allocate a new handle id into the given object pool. */
        getNewId(pool: Record<number, unknown>): number;
        /** Emscripten-internal: texture object pool keyed by handle id. */
        textures: Record<number, WebGLTexture>;
    };
    renderFrame(registry: CppRegistry, width: number, height: number): void;
    renderFrameWithMatrix(registry: CppRegistry, width: number, height: number, matrixPtr: number): void;
    getResourceManager(): CppResourceManager;
    /**
     * Convert a Canvas2D-rasterized alpha bitmap to a signed distance field for
     * the runtime glyph atlas. `alphaPtr`/`outPtr` are HEAPU8
     * pointers to width*height byte buffers; the SDF is written into `outPtr`.
     */
    sdfFromAlpha?(alphaPtr: number, outPtr: number, width: number, height: number, spread: number): void;
    /**
     * Whether the GPU device can still be drawn to: 0 live, 1 lost, 2 recovering,
     * 3 dead. Reports live before a renderer exists — there is nothing to lose yet.
     * Optional: an older wasm build does not carry it.
     */
    deviceStatus?(): number;
    /** One-line loss report naming backend, GPU, driver and reason; empty while live. */
    deviceLostReport?(): string;
    /** `backend|vendor|renderer|version`, or empty before a device exists. */
    deviceIdentity?(): string;
    /**
     * Report a loss the page observed (`webglcontextlost`, a rejected GPUDevice
     * `lost` promise) so the engine stops submitting on this frame rather than
     * on its own next poll. Reason codes match GfxDeviceLostReason.
     */
    notifyDeviceLost?(reason: number, message: string): void;
    /**
     * Rebuild the renderer after a loss. False means "not yet" — a browser
     * restores a context when it is ready, so this is expected to be retried.
     * On success the device is Recovering: drawing, with placeholder textures.
     */
    recoverDevice?(): boolean;
    /** End recovery once the textures are back. */
    markDeviceRestored?(): void;
    /**
     * UI draw order of an entity (its UIVisual.uiOrder, assigned by the UI
     * render-order pass), so SDF text quads interleave with UI quads. -1 if the
     * entity is not a UI render node.
     */
    ui_getRenderOrder?(registry: CppRegistry, entity: number): number;
    ui_getCullBit?(registry: CppRegistry, entity: number): number;

    renderer_submitSpineBatch?(
        verticesPtr: number, vertexCount: number,
        indicesPtr: number, indexCount: number,
        textureId: number, blendMode: number,
        transformPtr: number,
        entity: number, layer: number, depth: number
    ): void;
    renderer_submitSkeletalBatchByEntity?(
        registry: CppRegistry,
        verticesPtr: number, vertexCount: number,
        indicesPtr: number, indexCount: number,
        textureId: number, blendMode: number,
        entity: number, skelScale: number, flipX: boolean, flipY: boolean,
        layer: number, depth: number
    ): void;
    /**
     * Submit pre-laid-out glyph quads. Vertex format x,y,u,v,r,g,b,a; `sdf` (1/0)
     * selects the SDF variant vs the plain textured batch (device bitmap atlas).
     */
    renderer_submitTextBatch?(
        verticesPtr: number, vertexCount: number,
        indicesPtr: number, indexCount: number,
        textureId: number, transformPtr: number,
        entity: number, layer: number, depth: number, sdf: number, cullBit: number
    ): void;
    /**
     * Upload a Mesh2D component's geometry: interleaved f32 [x,y,u,v] per vertex,
     * optional RGBA8 colors (colorsPtr 0 = all white), u32 triangle-list indices.
     * Validated engine-side: out-of-range indices reject the whole upload.
     */
    mesh2d_setGeometry?(
        registry: CppRegistry, entity: number,
        posUvPtr: number, vertexCount: number,
        colorsPtr: number,
        indicesPtr: number, indexCount: number
    ): void;

    // Material API. Materials are engine-side data: the SDK compiles a shader
    // here, then pushes the resolved render state (flags pack depthTest bit 0,
    // depthWrite bit 1, CullMode bits 2-3) and the param values. Reached through
    // the generated engine surface rather than this interface (see material.ts),
    // which is what makes them work on a device too; declared here because embind
    // registers them by hand for the web.
    material_compileEsshader(source: string, featuresCsv: string): number;
    material_define(materialId: number, shaderHandle: number, blendMode: number, flags: number): void;
    material_setUniform(materialId: number, name: string, arity: number,
                        v0: number, v1: number, v2: number, v3: number): void;
    material_setTexture(materialId: number, name: string, textureHandle: number): void;
    material_undefine(materialId: number): void;

    // ImmediateDraw API
    draw_begin(matrixPtr: number): void;
    draw_end(): void;
    draw_line(fromX: number, fromY: number, toX: number, toY: number,
              r: number, g: number, b: number, a: number, thickness: number): void;
    draw_rect(x: number, y: number, width: number, height: number,
              r: number, g: number, b: number, a: number, filled: boolean): void;
    draw_rectOutline(x: number, y: number, width: number, height: number,
                     r: number, g: number, b: number, a: number, thickness: number): void;
    draw_circle(centerX: number, centerY: number, radius: number,
                r: number, g: number, b: number, a: number, filled: boolean, segments: number): void;
    draw_circleOutline(centerX: number, centerY: number, radius: number,
                       r: number, g: number, b: number, a: number, thickness: number, segments: number): void;
    draw_texture(x: number, y: number, width: number, height: number, textureId: number,
                 r: number, g: number, b: number, a: number): void;
    draw_textureRotated(x: number, y: number, width: number, height: number, rotation: number,
                        textureId: number, r: number, g: number, b: number, a: number): void;
    draw_setLayer(layer: number): void;
    draw_setDepth(depth: number): void;
    draw_getDrawCallCount(): number;
    draw_getPrimitiveCount(): number;
    draw_setBlendMode(mode: number): void;
    draw_setDepthTest(enabled: boolean): void;
    draw_mesh(geometryHandle: number, shaderHandle: number, transformPtr: number): void;
    draw_meshWithUniforms(geometryHandle: number, shaderHandle: number, transformPtr: number,
                          uniformsPtr: number, uniformCount: number): void;
    /** Reflected-material mesh draw (MaterialConstants UBO); false = shader has no
     *  #pragma-param layout, caller falls back to the loose uniform stream. */
    draw_meshWithMaterial(geometryHandle: number, materialId: number): boolean;
    /** Cook-time introspection (tools/gen-shader-twins.mjs): assembles both GLSL
     *  stages exactly as the runtime + the texture-unit reflection a GLSL→WGSL
     *  converter needs. Not called by the SDK itself. */
    esshader_cookInfo(source: string, featuresCsv: string): {
        valid: boolean; error?: string; name: string; domain: string;
        hasWgslVertex: boolean; hasWgslFragment: boolean; hasSwitches: boolean;
        vertGlsl: string; fragGlsl: string;
        textures: Array<{ name: string; unit: number }>;
    };

    // Geometry API
    geometry_create(): number;
    geometry_init(handle: number, verticesPtr: number, vertexCount: number,
                  layoutPtr: number, layoutCount: number, dynamic: boolean): void;
    geometry_setIndices16(handle: number, indicesPtr: number, indexCount: number): void;
    geometry_setIndices32(handle: number, indicesPtr: number, indexCount: number): void;
    geometry_updateVertices(handle: number, verticesPtr: number, vertexCount: number, offset: number): void;
    geometry_release(handle: number): void;
    geometry_isValid(handle: number): boolean;

    // PostProcess API
    postprocess_init(width: number, height: number): boolean;
    postprocess_shutdown(): void;
    postprocess_resize(width: number, height: number): void;
    postprocess_addPass(name: string, shaderHandle: number): number;
    postprocess_removePass(name: string): void;
    postprocess_setPassEnabled(name: string, enabled: boolean): void;
    postprocess_isPassEnabled(name: string): boolean;
    postprocess_setUniformFloat(passName: string, uniform: string, value: number): void;
    postprocess_setPassTexture(passName: string, uniform: string, textureHandle: number): void;
    postprocess_setUniformVec4(passName: string, uniform: string, x: number, y: number, z: number, w: number): void;
    postprocess_begin(): void;
    postprocess_end(): void;
    postprocess_getPassCount(): number;
    postprocess_isInitialized(): boolean;
    postprocess_setBypass(bypass: boolean): void;
    postprocess_isBypassed(): boolean;
    postprocess_clearPasses(): void;
    postprocess_setOutputTarget(fboId: number): void;
    postprocess_setOutputViewport(x: number, y: number, w: number, h: number): void;
    postprocess_beginScreenCapture(): void;
    postprocess_endScreenCapture(): void;
    postprocess_executeScreenPasses(): void;
    postprocess_addScreenPass(name: string, shaderHandle: number): number;
    postprocess_clearScreenPasses(): void;
    postprocess_setScreenUniformFloat(passName: string, uniform: string, value: number): void;
    postprocess_setScreenUniformVec4(passName: string, uniform: string, x: number, y: number, z: number, w: number): void;

    // Renderer API (RenderFrame)
    renderer_init(width: number, height: number): void;
    renderer_resize(width: number, height: number): void;
    renderer_beginFrame(elapsedSec: number): void;
    renderer_updateTransforms(registry: CppRegistry): void;
    /** Permute component storage to the given entity order — see World.applyEntityOrder.
     *  Optional: an older core still answers every other renderer entry point. */
    renderer_setEntityDrawOrder?(registry: CppRegistry, entitiesPtr: number, count: number): void;
    renderer_begin(matrixPtr: number, targetHandle: number, clearFlags: number,
                   r: number, g: number, b: number, a: number,
                   clearX: number, clearY: number, clearW: number, clearH: number): void;
    renderer_flush(): void;
    renderer_end(): void;
    renderer_submitSprites(registry: CppRegistry): void;
    renderer_submitUIElements(registry: CppRegistry): void;
    renderer_submitBitmapText(registry: CppRegistry): void;
    renderer_submitShapes?(registry: CppRegistry): void;
    renderer_submitSpine?(registry: CppRegistry): void;
    renderer_submitParticles?(registry: CppRegistry): void;
    renderer_submitAll(registry: CppRegistry, skipFlags: number, vpX: number, vpY: number, vpW: number, vpH: number): void;
    particle_update?(registry: CppRegistry, dt: number): void;
    particle_play?(registry: CppRegistry, entity: number): void;
    particle_stop?(registry: CppRegistry, entity: number): void;
    particle_reset?(registry: CppRegistry, entity: number): void;
    particle_getAliveCount?(entity: number): number;
    /** Upload (count = LUT size) or clear (count = 0) an entity's baked color-over-life LUT. */
    particle_set_color_lut?(entity: number, ptr: number, count: number): void;
    /** Upload/clear an entity's baked size-over-life multiplier LUT. */
    particle_set_size_lut?(entity: number, ptr: number, count: number): void;
    trail_update?(registry: CppRegistry, dt: number): void;
    trail_clear?(registry: CppRegistry, entity: number): void;

    // Tilemap API
    tilemap_initLayer?(entity: number, width: number, height: number,
                       tileWidth: number, tileHeight: number): void;
    tilemap_initInfinite?(entity: number, tileWidth: number, tileHeight: number): void;
    tilemap_destroyLayer?(entity: number): void;
    tilemap_setTile?(entity: number, x: number, y: number, tileId: number): void;
    tilemap_getTile?(entity: number, x: number, y: number): number;
    tilemap_fillRect?(entity: number, x: number, y: number,
                      w: number, h: number, tileId: number): void;
    tilemap_setTiles?(entity: number, tilesPtr: number, count: number): void;
    tilemap_hasLayer?(entity: number): boolean;
    tilemap_exportChunks?(entity: number): string;
    tilemap_importChunks?(entity: number, encoded: string): boolean;
    renderer_setStage(stage: number): void;
    renderer_createTarget(width: number, height: number, flags: number): number;
    renderer_releaseTarget(handle: number): void;
    renderer_getTargetTexture(handle: number): number;
    renderer_getTargetDepthTexture(handle: number): number;
    /**
     * Bytes malloc has handed out and not got back — the exact C++ leak signal
     * for the resource census. Optional: older engine builds do not carry it.
     */
    es_getMallocBytes?(): number;
    renderer_getDrawCalls(): number;
    /**
     * GPU objects the device has created and not destroyed, for the resource
     * census. Null when no device is initialized — a census must record those
     * counters as ABSENT, since zero would read as "everything was freed".
     * Optional: older engine builds do not carry it.
     */
    renderer_getLiveObjects?(): GfxLiveObjects | null;
    renderer_getTriangles(): number;
    renderer_getSprites(): number;
    renderer_getText(): number;
    renderer_getSpine?(): number;
    renderer_getMeshes(): number;
    renderer_getCulled(): number;
    /** Last frame's GPU time (ms) via EXT_disjoint_timer_query, or -1 if unavailable. */
    renderer_getGpuTimeMs?(): number;
    /** Enable/disable per-frame CPU scope profiling (FrameProfiler). */
    engine_setCpuProfiling?(on: boolean): void;
    /** Last frame's CPU scopes as a JSON object {"render.submit": ms, …}. */
    engine_getCpuScopes?(): string;
    /** Last frame's named counters as a JSON object {"render.culled": n, …}. */
    engine_getCounters?(): string;
    /** Last frame's per-pass GPU times as a JSON object {"submit": ms, …}. */
    engine_getGpuScopes?(): string;
    /** Resident texture VRAM (RGBA8 estimate, bytes) for the profiler's memory pillar. */
    renderer_getTextureBytes?(): number;
    renderer_setClearColor(r: number, g: number, b: number, a: number): void;
    renderer_setViewport(x: number, y: number, w: number, h: number): void;
    /** Bitmask of layers 0..31 that y-sort within the layer (top-down occlusion). */
    renderer_setYSortLayers?(mask: number): void;
    renderer_setDepthLayers?(mask: number): void;
    renderer_setCullingMask?(mask: number): void;
    renderer_setColorSpace?(linear: number): void;
    /** Reseed the engine's randomness so a run reproduces (core/RandomSource.hpp). */
    engine_setRandomSeed?(seed: number): void;
    renderer_setTextureParams(textureId: number, minFilter: number, magFilter: number, wrapS: number, wrapT: number): void;

    // Clip Rect API
    renderer_setEntityClipRect(entity: number, x: number, y: number, w: number, h: number): void;
    renderer_clearEntityClipRect(entity: number): void;
    renderer_clearAllClipRects(): void;

    // Stencil API
    renderer_setEntityStencilMask(entity: number, refValue: number): void;
    renderer_setEntityStencilTest(entity: number, refValue: number): void;
    renderer_clearEntityStencilMask(entity: number): void;
    renderer_clearAllStencilMasks(): void;

    // ECS Query API
    registry_getCanvasEntity(registry: CppRegistry): number;
    registry_getCanvasEntities?(registry: CppRegistry): number[];
    registry_getCameraEntities(registry: CppRegistry): number[];
    getChildEntities(registry: CppRegistry, entity: number): number[];
    registry_getGeneration(registry: CppRegistry, entity: number): number;
    registry_batchSyncPhysicsTransforms(registry: CppRegistry, bufferPtr: number, count: number, ppu: number): void;

    // GL Debug API
    gl_enableErrorCheck(enabled: boolean): void;
    gl_checkErrors(context: string): number;
    renderer_diagnose(): void;

    // Frame Capture API
    renderer_captureNextFrame(): void;
    renderer_getCapturedFrameSize(): number;
    renderer_getCapturedFrameData(): number;
    renderer_getCapturedEntities(): number;
    renderer_getCapturedEntityCount(): number;
    renderer_getCapturedCameraCount(): number;
    renderer_hasCapturedData(): boolean;

    renderer_replayToDrawCall(drawCallIndex: number): void;
    /** Lands the snapshot's async readback: 0 = pending (yield, poll again),
     *  1 = getSnapshot* serve the pixels, 2 = none/failed. GL reports 1 on the
     *  first poll; WebGPU resolves on a later event-loop turn. */
    renderer_pollSnapshotReadback(): number;
    renderer_getSnapshotPtr(): number;
    renderer_getSnapshotSize(): number;
    renderer_getSnapshotWidth(): number;
    renderer_getSnapshotHeight(): number;
    renderer_renderMaterialPreview(materialId: number, w: number, h: number): void;
    /** Same 0/1/2 readback contract as renderer_pollSnapshotReadback. */
    renderer_pollPreviewReadback(): number;
    renderer_getPreviewPtr(): number;
    renderer_getPreviewSize(): number;
    renderer_getPreviewWidth(): number;
    renderer_getPreviewHeight(): number;

    // UI Systems
    uiLayout_update(registry: CppRegistry, boxLeft: number, boxBottom: number, boxRight: number, boxTop: number, propertyDirty: boolean): void;
    uiHitTest_update(registry: CppRegistry, mouseWorldX: number, mouseWorldY: number, mouseDown: boolean, mousePressed: boolean, mouseReleased: boolean): void;
    uiHitTest_getHitEntity(): number;
    uiHitTest_getHitEntityPrev(): number;
    uiHitTest_pick?(registry: CppRegistry, worldX: number, worldY: number): number;
    uiHitTest_pickAll?(registry: CppRegistry, worldX: number, worldY: number): number;
    uiHitTest_pickResult?(index: number): number;
    uiNode_computedWidth(registry: CppRegistry, entity: number): number;
    uiNode_computedHeight(registry: CppRegistry, entity: number): number;
    uiRenderOrder_update(registry: CppRegistry): void;
    getUINodeComputedWidth?(registry: CppRegistry, entity: number): number;
    getUINodeComputedHeight?(registry: CppRegistry, entity: number): number;
    getUINodeHiddenInTree?(registry: CppRegistry, entity: number): boolean;
    /** Subtree opacity resolved by the layout pass (UINode.opacity multiplied down). */
    getUINodeAlphaInTree?(registry: CppRegistry, entity: number): number;
    /** True when this node or an ancestor set pointerEvents = None. */
    getUINodePointerBlockedInTree?(registry: CppRegistry, entity: number): boolean;
    transform_update(registry: CppRegistry): void;
    transform_patchPosition(registry: CppRegistry, entity: number, x: number, y: number, z: number): void;

    // Animation (Tween) API
    anim_createTween(registry: CppRegistry, entity: number, targetProp: number,
                      from: number, to: number, duration: number,
                      easing: number, delay: number,
                      loopMode: number, loopCount: number): number;
    anim_cancelTween(registry: CppRegistry, tweenEntity: number): void;
    anim_cancelAllTweens(registry: CppRegistry, targetEntity: number): void;
    anim_pauseTween(registry: CppRegistry, tweenEntity: number): void;
    anim_resumeTween(registry: CppRegistry, tweenEntity: number): void;
    anim_setTweenBezier(registry: CppRegistry, tweenEntity: number,
                         p1x: number, p1y: number, p2x: number, p2y: number): void;
    anim_setSequenceNext(registry: CppRegistry, tweenEntity: number, nextEntity: number): void;
    anim_updateTweens(registry: CppRegistry, deltaTime: number): void;
    anim_getTweenState(registry: CppRegistry, tweenEntity: number): number;

    // Pointer-based component access
    getTransformPtr(registry: CppRegistry, entity: number): number;
    getSpritePtr(registry: CppRegistry, entity: number): number;
    getVelocityPtr(registry: CppRegistry, entity: number): number;
    getCameraPtr(registry: CppRegistry, entity: number): number;
    getRigidBodyPtr(registry: CppRegistry, entity: number): number;
    getBoxColliderPtr(registry: CppRegistry, entity: number): number;
    getCircleColliderPtr(registry: CppRegistry, entity: number): number;

    _malloc(size: number): number;
    _free(ptr: number): void;

}
