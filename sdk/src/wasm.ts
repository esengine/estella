// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    wasm.ts
 * @brief   WASM module type definitions
 */

import { Entity } from './types';
import type { Registry as GeneratedRegistry } from './wasm.generated';

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
    createShader(vertSrc: string, fragSrc: string): number;
    registerExternalTexture(glTextureId: number, width: number, height: number): number;
    getTextureGLId(handle: number): number;
    getTextureDimensions(handle: number): { width: number; height: number } | null;
    releaseTexture(handle: number): void;
    releaseShader(handle: number): void;
    setTextureMetadata(handle: number, left: number, right: number, top: number, bottom: number): void;
    updateTextureSubregion(handle: number, x: number, y: number, width: number, height: number, pixels: number, pixelsLen: number): void;
    registerTextureWithPath(handle: number, path: string): void;
    setTextureBudget(bytes: number): void;
    acquireTextureByPath(path: string): number;
    loadBitmapFont(fntContent: string, textureHandle: number, texWidth: number, texHeight: number): number;
    createLabelAtlasFont(textureHandle: number, texWidth: number, texHeight: number, chars: string, charWidth: number, charHeight: number): number;
    releaseBitmapFont(handle: number): void;
    measureBitmapText(fontHandle: number, text: string, fontSize: number, spacing: number): { width: number; height: number };
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

export interface SpineBounds {
    x: number;
    y: number;
    width: number;
    height: number;
    valid: boolean;
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
     * UI draw order of an entity (its UIVisual.uiOrder, assigned by the UI
     * render-order pass), so SDF text quads interleave with UI quads. -1 if the
     * entity is not a UI render node.
     */
    ui_getRenderOrder?(registry: CppRegistry, entity: number): number;
    getSpineBounds?(registry: CppRegistry, entity: number): SpineBounds;

    renderer_submitSpineBatch?(
        verticesPtr: number, vertexCount: number,
        indicesPtr: number, indexCount: number,
        textureId: number, blendMode: number,
        transformPtr: number,
        entity: number, layer: number, depth: number
    ): void;
    renderer_submitSpineBatchByEntity?(
        registry: CppRegistry,
        verticesPtr: number, vertexCount: number,
        indicesPtr: number, indexCount: number,
        textureId: number, blendMode: number,
        entity: number, skelScale: number, flipX: boolean, flipY: boolean,
        layer: number, depth: number
    ): void;
    /**
     * Submit pre-laid-out glyph quads against the dynamic SDF atlas.
     * Vertex format x,y,u,v,r,g,b,a; routed through the SDF batch variant.
     */
    renderer_submitTextBatch?(
        verticesPtr: number, vertexCount: number,
        indicesPtr: number, indexCount: number,
        textureId: number, transformPtr: number,
        entity: number, layer: number, depth: number
    ): void;

    // Material store (engine-side resolved render state, keyed by material handle).
    // flags packs depthTest (bit 0), depthWrite (bit 1), CullMode (bits 2-3).
    // Compiles a .esshader through ShaderParser (auto-generating the MaterialConstants block +
    // the enabled #pragma switch / feature permutation from featuresCsv) and registers its param
    // layout; returns the shader resource handle (0 on failure).
    compileEsshader(source: string, featuresCsv: string): number;
    defineMaterial(materialId: number, shader: number, blendMode: number, flags: number): void;
    // Packs a named param's components into the material's std140 UBO by reflected offset.
    setMaterialUniform(materialId: number, name: string, arity: number,
                       v0: number, v1: number, v2: number, v3: number): void;
    // Binds a texture param to its sampler unit; textureHandle is a texture resource handle.
    setMaterialTexture(materialId: number, name: string, textureHandle: number): void;
    undefineMaterial(materialId: number): void;

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
    renderer_beginFrame(): void;
    renderer_updateTransforms(registry: CppRegistry): void;
    renderer_begin(matrixPtr: number, targetHandle: number): void;
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
    renderer_setTextureParams(textureId: number, minFilter: number, magFilter: number, wrapS: number, wrapT: number): void;

    // Clip Rect API
    renderer_setEntityClipRect(entity: number, x: number, y: number, w: number, h: number): void;
    renderer_clearEntityClipRect(entity: number): void;
    renderer_clearAllClipRects(): void;

    // Stencil API
    renderer_clearStencil(): void;
    renderer_setEntityStencilMask(entity: number, refValue: number): void;
    renderer_setEntityStencilTest(entity: number, refValue: number): void;
    renderer_clearEntityStencilMask(entity: number): void;
    renderer_clearAllStencilMasks(): void;

    // ECS Query API
    registry_getCanvasEntity(registry: CppRegistry): number;
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
    renderer_getSnapshotPtr(): number;
    renderer_getSnapshotSize(): number;
    renderer_getSnapshotWidth(): number;
    renderer_getSnapshotHeight(): number;
    renderer_renderMaterialPreview(materialId: number, w: number, h: number): void;
    renderer_getPreviewPtr(): number;
    renderer_getPreviewSize(): number;
    renderer_getPreviewWidth(): number;
    renderer_getPreviewHeight(): number;

    // UI Systems
    uiLayout_update(registry: CppRegistry, camLeft: number, camBottom: number, camRight: number, camTop: number): void;
    uiHitTest_update(registry: CppRegistry, mouseWorldX: number, mouseWorldY: number, mouseDown: boolean, mousePressed: boolean, mouseReleased: boolean): void;
    uiHitTest_getHitEntity(): number;
    uiHitTest_getHitEntityPrev(): number;
    uiNode_computedWidth(registry: CppRegistry, entity: number): number;
    uiNode_computedHeight(registry: CppRegistry, entity: number): number;
    uiRenderOrder_update(registry: CppRegistry): void;
    uiFlexLayout_update(registry: CppRegistry): void;
    getUINodeComputedWidth?(registry: CppRegistry, entity: number): number;
    getUINodeComputedHeight?(registry: CppRegistry, entity: number): number;
    uiTree_markStructureDirty(): void;
    uiTree_markDirty(entity: number): void;
    uiTree_markAllDirty(): void;
    transform_update(registry: CppRegistry): void;
    // Layout anim-override flags (function names predate the UINode rename; they
    // now operate on UINode.anim_override_).
    uiRect_clearAnimOverrides(registry: CppRegistry): void;
    uiRect_setAnimOverride(registry: CppRegistry, entity: number, flags: number): void;
    transform_patchPosition(registry: CppRegistry, entity: number, x: number, y: number, z: number): void;

    // Animation (Tween) API
    _anim_createTween(registry: CppRegistry, entity: number, targetProp: number,
                      from: number, to: number, duration: number,
                      easing: number, delay: number,
                      loopMode: number, loopCount: number): number;
    _anim_cancelTween(registry: CppRegistry, tweenEntity: number): void;
    _anim_cancelAllTweens(registry: CppRegistry, targetEntity: number): void;
    _anim_pauseTween(registry: CppRegistry, tweenEntity: number): void;
    _anim_resumeTween(registry: CppRegistry, tweenEntity: number): void;
    _anim_setTweenBezier(registry: CppRegistry, tweenEntity: number,
                         p1x: number, p1y: number, p2x: number, p2y: number): void;
    _anim_setSequenceNext(registry: CppRegistry, tweenEntity: number, nextEntity: number): void;
    _anim_updateTweens(registry: CppRegistry, deltaTime: number): void;
    _anim_getTweenState(registry: CppRegistry, tweenEntity: number): number;

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
