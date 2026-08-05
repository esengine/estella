// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    nativeBindings.ts
 * @brief   The names a native host binds on the JS global, declared once.
 * @details Half of this contract is generated — `es_set_<C>` / `es_<C>_buffer`
 *          and friends come out of the same reflection pass that emits the web
 *          bindings, so neither side can misspell them. The hand-written half
 *          (entities, hierarchy, textures, the platform primitives) had no such
 *          guarantee: the host spelled each name in C++, the SDK spelled it again
 *          in a string literal at the call site, and a mismatch surfaced whenever
 *          that particular call first ran.
 *
 *          These constants are the one spelling. The call sites read them, and
 *          {@link assertNativeBindings} checks the whole set at boot.
 *
 *          A name starting `es_rm_` or `es_renderer_` is GENERATED: the host binds
 *          it from the same `bindings/*.hpp` declaration embind registers on the
 *          web, so both platforms run one implementation of that entry point (and
 *          both get its BoundarySpan validation). The rest are the host's own —
 *          either native-only (KTX2 transcode, glyph rasterization) or a shape the
 *          generator cannot marshal (an `emscripten::val` result). Those, and only
 *          those, are hand-written in `native/host/bindings/`.
 */

/** Entity + hierarchy — the base Registry surface the SDK's World drives. */
export const REGISTRY_BINDINGS = {
    createEntity: 'es_createEntity',
    destroyEntity: 'es_destroyEntity',
    setParent: 'es_setParent',
    hasParent: 'es_hasParent',
    getParent: 'es_getParent',
    removeParent: 'es_removeParent',
    hasChildren: 'es_hasChildren',
    getChildren: 'es_getChildren',
} as const;

/**
 * The native ResourceManager surface the asset pipeline uploads through.
 *
 * `createTexture` and `releaseTexture` are the engine's own `rm_*` entry points,
 * generated — the same ones embind exposes as methods on the web ResourceManager,
 * so a texture is created by one implementation on both platforms. The other two
 * cannot be: KTX2 transcoding is native-only (the web path is WebGL2 + a wasm
 * transcoder), and the dimensions query returns an `emscripten::val`.
 */
export const RESOURCE_BINDINGS = {
    createTexture: 'es_rm_createTextureEx',
    createTextureKTX2: 'es_createTextureKTX2',
    releaseTexture: 'es_rm_releaseTexture',
    registerTextureWithPath: 'es_rm_registerTextureWithPath',
    getTextureDimensions: 'es_getTextureDimensions',
} as const;

/**
 * Text rendering, which on native crosses the seam twice: the host rasterizes a
 * glyph (it owns the font stack — there is no 2D canvas) and the host submits the
 * laid-out quads (there is no wasm heap to marshal them through). Everything
 * between those two calls — atlas, layout, batching — is the same SDK code the
 * web runs.
 *
 * Only the glyph source is genuinely the host's: rasterization has no engine entry
 * point to generate from, because on the web a 2D canvas does it. The other three
 * ARE engine entry points, generated — the submit even regains the boundary
 * validation a hand-written copy used to skip.
 *
 * OPTIONAL, like {@link AUDIO_BINDINGS}: a host that has not bound its font stack
 * simply draws no text, rather than failing to boot. {@link hasTextBindings} is
 * the gate.
 */
export const TEXT_BINDINGS = {
    rasterizeGlyph: 'es_rasterizeGlyph',
    submitTextBatch: 'es_renderer_submitTextBatch',
    updateTextureSubregion: 'es_rm_updateTextureSubregion',
    getTextureRenderId: 'es_rm_getTextureGLId',
} as const;

/** Whether a host bound the whole text surface — all-or-nothing, so a partially
 *  implemented host draws nothing instead of half-drawing. */
export function hasTextBindings(
    scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): boolean {
    return Object.values(TEXT_BINDINGS).every((name) => typeof scope[name] === 'function');
}

/**
 * The frame. These are the engine calls the SDK's own render pipeline makes on
 * web through the wasm module (`renderer_*`), bound here for a core that has no
 * heap to marshal through — so the CAMERAS, viewports, clear flags, y-sort and
 * pre-flush draws are decided by one implementation on both platforms, and the
 * native host owns only its swapchain.
 *
 * Required as a set (a host that renders binds all of them); {@link
 * hasRendererBindings} gates whether the SDK drives the frame at all, since a
 * host may still own it while this lands.
 */
export const RENDERER_BINDINGS = {
    resize: 'es_renderer_resize',
    beginFrame: 'es_renderer_beginFrame',
    updateTransforms: 'es_renderer_updateTransforms',
    begin: 'es_renderer_begin',
    submitAll: 'es_renderer_submitAll',
    flush: 'es_renderer_flush',
    end: 'es_renderer_end',
    setStage: 'es_renderer_setStage',
    setViewport: 'es_renderer_setViewport',
    setYSortLayers: 'es_renderer_setYSortLayers',
    /** Host-specific: the drawable size, which no wasm entry point has. */
    surfaceSize: 'es_renderer_surfaceSize',
} as const;

/** The per-frame counters, read one call each — the same entry points the wasm
 *  module exposes under the same names, so the two paths report identically. */
export const RENDERER_STATS_BINDINGS = {
    drawCalls: 'es_renderer_getDrawCalls',
    triangles: 'es_renderer_getTriangles',
    sprites: 'es_renderer_getSprites',
    text: 'es_renderer_getText',
    meshes: 'es_renderer_getMeshes',
    culled: 'es_renderer_getCulled',
} as const;

/**
 * What the SDK declares back to the host, on the same global object.
 *
 * A host predates these bindings gracefully: it keeps a fallback frame (one
 * full-viewport pass) for a game script that never drives one. `ownsFrame` is how
 * it learns to stop — set once the SDK's render pipeline is installed, so the two
 * never both draw (which would look like the SDK's frame silently vanishing, since
 * the host's pass would clear and re-collect over it).
 */
export const HOST_FLAGS = {
    ownsFrame: 'es_jsOwnsFrame',
} as const;

/**
 * Renderer entry points a host may legitimately NOT have, and which therefore
 * must stay out of `hasRendererBindings`.
 *
 * That probe is an all-or-nothing gate on the SDK driving the frame, so adding an
 * entry to RENDERER_BINDINGS retroactively declares every host built before it
 * rendererless — the SDK would hand the frame back and the game would go blank
 * on a shell that was working. A capability added after a host shipped belongs
 * here and is called through the optional path.
 */
export const RENDERER_OPTIONAL_BINDINGS = {
    /** 2.5D depth layers; hosts predating the feature simply stay painter-ordered. */
    setDepthLayers: 'es_renderer_setDepthLayers',
} as const;

/** Whether the host bound the whole frame surface — the gate for the SDK driving
 *  the frame (cameras and all) rather than the host hard-coding one. Optional
 *  entry points (RENDERER_OPTIONAL_BINDINGS) are deliberately not part of it. */
export function hasRendererBindings(
    scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): boolean {
    return Object.values(RENDERER_BINDINGS).every((name) => typeof scope[name] === 'function');
}

/**
 * Scene queries the wasm module answers as module-level functions over the
 * registry. The native registry answers them itself (see createNativeRegistry);
 * optional, since a host that binds neither simply has no cameras to render.
 */
export const SCENE_QUERY_BINDINGS = {
    canvasEntity: 'es_registry_getCanvasEntity',
    cameraEntities: 'es_registry_getCameraEntities',
} as const;

/** Platform primitives the SDK's bridge and file reading are built on. */
export const PLATFORM_BINDINGS = {
    readAsset: 'es_readAsset',
    loadImagePixels: 'es_loadImagePixels',
    utf8Decode: 'es_utf8Decode',
} as const;

/**
 * The native audio engine surface (a host with a sound device binds it). Unlike
 * the sets above this one is OPTIONAL: a host with no audio omits every name and
 * the audio system falls back to the silent Null backend, so it is not part of
 * {@link assertNativeBindings}' required set — {@link hasAudioBindings} decides
 * whether {@link NativeAudioBackend} is wired at all.
 */
export const AUDIO_BINDINGS = {
    load: 'es_audioLoad',
    unload: 'es_audioUnload',
    play: 'es_audioPlay',
    stop: 'es_audioStop',
    pause: 'es_audioPause',
    resume: 'es_audioResume',
    setVolume: 'es_audioSetVolume',
    setPan: 'es_audioSetPan',
    setLoop: 'es_audioSetLoop',
    setRate: 'es_audioSetRate',
    voiceState: 'es_audioVoiceState',
    suspendAll: 'es_audioSuspendAll',
    resumeAll: 'es_audioResumeAll',
} as const;

/** Whether a host bound the whole audio surface — the gate for the native audio
 *  backend (all-or-nothing, so a partially-implemented host stays silent rather
 *  than half-playing). */
export function hasAudioBindings(
    scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): boolean {
    return Object.values(AUDIO_BINDINGS).every((name) => typeof scope[name] === 'function');
}

/**
 * Verify a host bound everything before anything calls it.
 *
 * @throws listing every missing binding at once — a host that is halfway through
 *         implementing the contract learns all of what is left, not the first
 *         name some code path happened to reach.
 */
export function assertNativeBindings(
    scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): void {
    const missing = [
        ...Object.values(REGISTRY_BINDINGS),
        ...Object.values(RESOURCE_BINDINGS),
        ...Object.values(PLATFORM_BINDINGS),
    ].filter((name) => typeof scope[name] !== 'function');
    if (missing.length > 0) {
        throw new Error(
            `[native] the host has not bound: ${missing.join(', ')} — see NativeHostBindings `
            + 'and the es_* contract in nativeBindings.ts',
        );
    }
}
