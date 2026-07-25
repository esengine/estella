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
 */

/** Entity + hierarchy — the base Registry surface the SDK's World drives. */
export const REGISTRY_BINDINGS = {
    createEntity: 'es_createEntity',
    destroyEntity: 'es_destroyEntity',
    setParent: 'es_setParent',
    hasParent: 'es_hasParent',
    removeParent: 'es_removeParent',
    hasChildren: 'es_hasChildren',
    getChildren: 'es_getChildren',
} as const;

/** The native ResourceManager surface the asset pipeline uploads through. */
export const RESOURCE_BINDINGS = {
    createTexture: 'es_createTexture',
    createTextureKTX2: 'es_createTextureKTX2',
    releaseTexture: 'es_releaseTexture',
    getTextureDimensions: 'es_getTextureDimensions',
} as const;

/**
 * Text rendering, which on native crosses the seam twice: the host rasterizes a
 * glyph (it owns the font stack — there is no 2D canvas) and the host submits the
 * laid-out quads (there is no wasm heap to marshal them through). Everything
 * between those two calls — atlas, layout, batching — is the same SDK code the
 * web runs.
 *
 * OPTIONAL, like {@link AUDIO_BINDINGS}: a host that has not bound its font stack
 * simply draws no text, rather than failing to boot. {@link hasTextBindings} is
 * the gate.
 */
export const TEXT_BINDINGS = {
    rasterizeGlyph: 'es_rasterizeGlyph',
    submitTextBatch: 'es_submitTextBatch',
    updateTextureSubregion: 'es_updateTextureSubregion',
    getTextureRenderId: 'es_getTextureRenderId',
} as const;

/** Whether a host bound the whole text surface — all-or-nothing, so a partially
 *  implemented host draws nothing instead of half-drawing. */
export function hasTextBindings(
    scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): boolean {
    return Object.values(TEXT_BINDINGS).every((name) => typeof scope[name] === 'function');
}

/**
 * The other direction: what the HOST calls on the JS side, beyond the game's own
 * `update`. Declared here for the same reason as the es_* names — the C++ host
 * spells it once, the SDK installs it once.
 */
export const HOST_ENTRIES = {
    /** Run the render pipeline's pre-flush callbacks (the text batches). The host
     *  calls it between collecting the scene and flushing the frame, which is
     *  where the web pipeline runs them too. Absent unless the SDK installed it. */
    preFlush: 'es_jsPreFlush',
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
