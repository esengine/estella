/**
 * @file    wasm.ts
 * @brief   WASM module type definitions
 */

import { Entity } from './types';
import type { Registry as GeneratedRegistry } from './wasm.generated';

// =============================================================================
// C++ Registry Interface
// =============================================================================

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
    releaseTexture(handle: number): void;
    releaseShader(handle: number): void;
    setTextureMetadata(handle: number, left: number, right: number, top: number, bottom: number): void;
    registerTextureWithPath(handle: number, path: string): void;
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

    // Material cache
    invalidateMaterialCache(materialId: number): void;
    clearMaterialCache(): void;

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
    renderer_begin(matrixPtr: number, targetHandle: number): void;
    renderer_flush(): void;
    renderer_end(): void;
    renderer_submitSprites(registry: CppRegistry): void;
    renderer_submitBitmapText(registry: CppRegistry): void;
    renderer_submitShapes?(registry: CppRegistry): void;
    renderer_submitSpine?(registry: CppRegistry): void;
    renderer_submitParticles?(registry: CppRegistry): void;
    renderer_submitTriangles(
        verticesPtr: number, vertexCount: number,
        indicesPtr: number, indexCount: number,
        textureId: number, blendMode: number,
        transformPtr: number): void;
    particle_update?(registry: CppRegistry, dt: number): void;
    particle_play?(registry: CppRegistry, entity: number): void;
    particle_stop?(registry: CppRegistry, entity: number): void;
    particle_reset?(registry: CppRegistry, entity: number): void;
    particle_getAliveCount?(entity: number): number;

    // Tilemap API
    tilemap_initLayer?(entity: number, width: number, height: number,
                       tileWidth: number, tileHeight: number): void;
    tilemap_destroyLayer?(entity: number): void;
    tilemap_setTile?(entity: number, x: number, y: number, tileId: number): void;
    tilemap_getTile?(entity: number, x: number, y: number): number;
    tilemap_fillRect?(entity: number, x: number, y: number,
                      w: number, h: number, tileId: number): void;
    tilemap_setTiles?(entity: number, tilesPtr: number, count: number): void;
    tilemap_hasLayer?(entity: number): boolean;
    tilemap_submitLayer?(entity: number, textureId: number,
                         sortLayer: number, depth: number,
                         tilesetColumns: number,
                         uvTileWidth: number, uvTileHeight: number,
                         originX: number, originY: number,
                         camLeft: number, camBottom: number,
                         camRight: number, camTop: number): void;
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
    registry_getSchemaPoolVersion(registry: CppRegistry, poolId: number): number;
    registry_batchSyncPhysicsTransforms(registry: CppRegistry, bufferPtr: number, count: number, ppu: number): void;

    // GL Debug API
    gl_enableErrorCheck(enabled: boolean): void;
    gl_checkErrors(context: string): number;
    renderer_diagnose(): void;

    // UI Systems
    uiLayout_update(registry: CppRegistry, camLeft: number, camBottom: number, camRight: number, camTop: number): void;
    uiHitTest_update(registry: CppRegistry, mouseWorldX: number, mouseWorldY: number, mouseDown: boolean, mousePressed: boolean, mouseReleased: boolean): void;
    uiHitTest_getHitEntity(): number;
    uiHitTest_getHitEntityPrev(): number;
    uiRenderOrder_update(registry: CppRegistry): void;
    uiFlexLayout_update(registry: CppRegistry): void;
    getUIRectComputedWidth(registry: CppRegistry, entity: number): number;
    getUIRectComputedHeight(registry: CppRegistry, entity: number): number;
    transform_update(registry: CppRegistry): void;

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

    _malloc(size: number): number;
    _free(ptr: number): void;

}
