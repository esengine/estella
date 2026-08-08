// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Bindings.hpp
 * @brief   The es_* surface the SDK reaches the engine through, declared one
 *          pillar at a time.
 * @details The SDK's native path reads its primitives off `globalThis`:
 *          `createNativeRegistry` and `NativeMemoryProvider` want the entity and
 *          component calls, `createNativeResourceManager` wants the texture ones,
 *          `createHostBridge` wants assets / networking / audio. Each group is
 *          one TU under bindings/, so adding a call means editing the file that
 *          owns that pillar — not a 1400-line middle.
 *
 *          Two of those groups are NOT here, because they are generated from the
 *          same reflection the web's embind bindings come from:
 *            * `esn_register`           — es_set_<C> / es_<C>_buffer / _has / _remove
 *            * `esn_register_functions` — es_renderer_* / es_uiLayout_* / …
 *          Only what has no web counterpart is written by hand below.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "Runtime.hpp"

namespace eshost {

/** The linear heap bulk data crosses through — `es_heap` / `es_malloc` / `es_free`.
 *  What makes a `…Ptr` argument mean the same thing here as it does on the web
 *  (see heap.hpp), so an SDK subsystem module needs no native-only backend. */
void registerHeapBindings(HostState& h, JSValue global);

/** Entity + hierarchy: the base Registry surface the SDK's World drives. */
void registerEcsBindings(HostState& h, JSValue global);

/** Textures, the clear colour, the surface size, the camera list and the text
 *  batch — what the SDK's renderer and glyph atlas need from the device. */
void registerRenderBindings(HostState& h, JSValue global);

/** Packaged assets, image decode, the on-disk cache and UTF-8 decoding. */
void registerAssetBindings(HostState& h, JSValue global);

/** es_audio* over the native engine — bound ONLY when a sound device came up, so
 *  the SDK's hasAudioBindings() gates the native backend on real availability. */
void registerAudioBindings(HostState& h, JSValue global);

/** es_pollGamepads — the one half of input the engine pulls rather than is
 *  pushed; see InputBindings.cpp. */
void registerInputBindings(HostState& h, JSValue global);

/** es_fetch over the platform's native networking. */
void registerNetBindings(HostState& h, JSValue global);

/** es_textEditor_* over the platform's soft keyboard — bound ONLY when the
 *  platform has one, so the SDK gates its editing surface on real availability
 *  exactly as it does audio. */
void registerTextEditorBindings(HostState& h, JSValue global);

/** Run the JS callbacks for HTTP replies that arrived since the last frame. JS
 *  thread only; {@link deliverFetch} queued them from the completion thread. */
void drainFetches(HostState& h);

/** Push what the editing surface did since the last frame into JS. JS thread
 *  only; the deliverTextEditor* calls queued it from the platform's UI thread. */
void drainTextEditor(HostState& h);

}  // namespace eshost
