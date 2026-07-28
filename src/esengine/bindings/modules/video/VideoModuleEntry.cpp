// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    VideoModuleEntry.cpp
 * @brief   Emscripten module: MPEG-1 video decoder (pl_mpeg)
 * @details The engine-owned software video decode path — a standalone wasm module
 *          (built like basis/spine) exposing a small C API over pl_mpeg. Every
 *          platform that runs the engine's wasm can run this, which is what makes
 *          it the guaranteed video backend on runtimes without a reliable native
 *          decoder (WeChat MiniGame, headless). Multi-instance: several videos may
 *          decode concurrently, each addressed by an integer handle.
 *
 *          Audio is decoded out-of-band (the cook demuxes the audio track for the
 *          engine's audio pipeline), so audio decoding is disabled per instance.
 */

#include <cstdint>
#include <cstdio>  // pl_mpeg's declarations expect size_t / FILE from the includer
#include <cstdlib>
#include <cstring>

#define PL_MPEG_IMPLEMENTATION
#include "pl_mpeg.h"

namespace {

constexpr int kMaxInstances = 16;

struct Instance {
    plm_t* plm = nullptr;
    plm_frame_t* frame = nullptr;  // latest decoded frame; owned by plm
    bool newFrame = false;
};

Instance g_instances[kMaxInstances];

Instance* get(int handle) {
    if (handle < 1 || handle > kMaxInstances) return nullptr;
    Instance& inst = g_instances[handle - 1];
    return inst.plm ? &inst : nullptr;
}

void onVideoFrame(plm_t*, plm_frame_t* frame, void* user) {
    auto* inst = static_cast<Instance*>(user);
    inst->frame = frame;
    inst->newFrame = true;
}

}  // namespace

extern "C" {

/**
 * Open an MPEG-PS / MPEG-1 stream from `dataPtr` (`size` bytes in the caller's heap).
 * The bytes are COPIED into memory this module owns, so the caller keeps and frees
 * its own buffer: ownership must not cross the boundary, because the two sides do not
 * necessarily share an allocator. They do in the wasm build — one emscripten heap —
 * and they do not in a native app, where the caller writes into the host's arena
 * (host/heap.hpp) and this module's `free` is libc's. Returns a handle >= 1, or 0.
 */
int es_video_open(uintptr_t dataPtr, uint32_t size) {
    const auto* source = reinterpret_cast<const uint8_t*>(dataPtr);
    if (!source || size == 0) return 0;
    int slot = -1;
    for (int i = 0; i < kMaxInstances; i++) {
        if (!g_instances[i].plm) { slot = i; break; }
    }
    if (slot < 0) return 0;
    auto* owned = static_cast<uint8_t*>(malloc(size));
    if (!owned) return 0;
    memcpy(owned, source, size);
    plm_t* plm = plm_create_with_memory(owned, size, /* free_when_done */ TRUE);
    if (!plm) {
        free(owned);
        return 0;
    }
    // Validate via the parsed sequence header, not plm_probe(): probe scans
    // forward from the current buffer position, so a stream whose only video
    // PES packet was already consumed during header parsing (tiny single-sector
    // files) would probe as empty despite decoding fine.
    if (plm_get_width(plm) <= 0 || plm_get_framerate(plm) <= 0) {
        plm_destroy(plm);
        return 0;
    }
    plm_set_audio_enabled(plm, FALSE);
    Instance& inst = g_instances[slot];
    inst.plm = plm;
    inst.frame = nullptr;
    inst.newFrame = false;
    plm_set_video_decode_callback(plm, onVideoFrame, &inst);
    return slot + 1;
}

uint32_t es_video_width(int handle) {
    Instance* inst = get(handle);
    return inst ? static_cast<uint32_t>(plm_get_width(inst->plm)) : 0u;
}

uint32_t es_video_height(int handle) {
    Instance* inst = get(handle);
    return inst ? static_cast<uint32_t>(plm_get_height(inst->plm)) : 0u;
}

double es_video_duration(int handle) {
    Instance* inst = get(handle);
    return inst ? plm_get_duration(inst->plm) : 0.0;
}

double es_video_framerate(int handle) {
    Instance* inst = get(handle);
    return inst ? plm_get_framerate(inst->plm) : 0.0;
}

/** Playhead in seconds (wraps on loop). */
double es_video_time(int handle) {
    Instance* inst = get(handle);
    return inst ? plm_get_time(inst->plm) : 0.0;
}

/** With looping on, the stream rewinds seamlessly and never reports ended. */
void es_video_set_loop(int handle, int loop) {
    Instance* inst = get(handle);
    if (inst) plm_set_loop(inst->plm, loop ? TRUE : FALSE);
}

int es_video_has_ended(int handle) {
    Instance* inst = get(handle);
    return inst ? plm_has_ended(inst->plm) : 1;
}

/**
 * Advance the decode clock by `dt` seconds, decoding everything now due (MPEG-1
 * P/B frames need every frame decoded, so there is no skip). Returns 1 if a new
 * video frame is pending conversion.
 */
int es_video_advance(int handle, double dt) {
    Instance* inst = get(handle);
    if (!inst) return 0;
    plm_decode(inst->plm, dt);
    return inst->newFrame ? 1 : 0;
}

/**
 * Convert the latest decoded frame into `out` as bottom-first RGBA rows — the
 * orientation the engine's flipY-off texture upload samples upright. `outSize`
 * must be at least width*height*4. `outPtr` is an offset the caller wrote — wasm
 * linear memory on the web, the host arena on a device — so the pixels land where
 * the caller reads them. Returns 1 and clears the new-frame flag on success.
 */
int es_video_frame_rgba(int handle, uintptr_t outPtr, uint32_t outSize) {
    Instance* inst = get(handle);
    auto* out = reinterpret_cast<uint8_t*>(outPtr);
    if (!inst || !inst->frame || !out) return 0;
    const int w = plm_get_width(inst->plm);
    const int h = plm_get_height(inst->plm);
    const int stride = w * 4;
    if (outSize < static_cast<uint32_t>(stride * h)) return 0;
    // plm_frame_to_rgba writes only the RGB bytes of each pixel — prefill so
    // alpha is opaque.
    memset(out, 0xFF, static_cast<size_t>(stride) * h);
    // Negative stride writes rows bottom-first: the converter indexes rows as
    // `dest[row * stride + …]`, so anchoring dest at the last row flips vertically
    // with no extra pass. (Row pairs stay adjacent; column offsets are positive.)
    plm_frame_to_rgba(inst->frame, out + static_cast<size_t>(h - 1) * stride, -stride);
    inst->newFrame = false;
    return 1;
}

/**
 * Exact-seek to `time` seconds. Decodes forward from the previous intra frame,
 * leaving the target frame pending as a new frame. Returns 1 on success.
 */
int es_video_seek(int handle, double time) {
    Instance* inst = get(handle);
    if (!inst) return 0;
    return plm_seek(inst->plm, time, /* seek_exact */ TRUE) ? 1 : 0;
}

/** Release the instance (frees the source bytes). Safe on a stale handle. */
void es_video_close(int handle) {
    if (handle < 1 || handle > kMaxInstances) return;
    Instance& inst = g_instances[handle - 1];
    if (inst.plm) plm_destroy(inst.plm);
    inst.plm = nullptr;
    inst.frame = nullptr;
    inst.newFrame = false;
}

}  // extern "C"
