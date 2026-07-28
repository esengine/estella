// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    VideoBindings.hpp
 * @brief   The MPEG-1 decoder's entry points, declared once for both platforms.
 * @details The engine owns its video decode (pl_mpeg) rather than depending on a
 *          platform's media stack, which is what makes a cooked `.esv` play the same
 *          way everywhere. On the web it links as a wasm side module; a native app
 *          compiles the same TU into the host binary and reaches it through the
 *          QuickJS wrappers EHT generates from these declarations.
 *
 *          Bulk data crosses as an offset into the caller's heap (wasm linear memory
 *          on the web, the host arena on a device): the source bytes in, the decoded
 *          RGBA frame out. Nothing owns anything across the boundary — see
 *          `es_video_open`.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include <cstdint>

extern "C" {

/** Open a stream from `size` bytes at `dataPtr`; the bytes are copied, so the caller
 *  keeps its buffer. Returns a handle >= 1, or 0. */
int es_video_open(uintptr_t dataPtr, uint32_t size);
/** Release the instance and everything it decoded. Safe on a stale handle. */
void es_video_close(int handle);

uint32_t es_video_width(int handle);
uint32_t es_video_height(int handle);
double es_video_duration(int handle);
double es_video_framerate(int handle);
/** Presentation time of the last decoded frame, in seconds. */
double es_video_time(int handle);
void es_video_set_loop(int handle, int loop);
int es_video_has_ended(int handle);

/** Decode forward by `dt` seconds; returns 1 when a new frame became available. */
int es_video_advance(int handle, double dt);
/** Write the pending frame as RGBA into `outPtr` (>= width*height*4 bytes). */
int es_video_frame_rgba(int handle, uintptr_t outPtr, uint32_t outSize);
/** Exact-seek to `time` seconds, leaving the target frame pending. */
int es_video_seek(int handle, double time);

}  // extern "C"
