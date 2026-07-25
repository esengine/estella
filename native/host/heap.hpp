// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    heap.hpp
 * @brief   The host's linear heap — what a `uintptr_t` argument means on a device.
 * @details Half the engine's binding surface marshals bulk data as a pointer plus
 *          a count: tile arrays, polygon vertices, body transforms, spine meshes.
 *          On the web that pointer is an offset into wasm's linear memory, which JS
 *          holds as `Module.HEAPF32` and writes through directly. A native host had
 *          no such thing, so every one of those entry points was web-only — the
 *          reason physics, tilemaps and spine could not run on a device.
 *
 *          This is that memory: ONE arena the host allocates and JS sees as a
 *          zero-copy `ArrayBuffer`, with `malloc`/`free` over it. Offsets into it
 *          are what cross the boundary, so an SDK module interface
 *          (`HEAPF32` + `_malloc` + a `…Ptr` argument) is satisfied natively by the
 *          same code that satisfies it on the web — no per-subsystem backend.
 *
 *          It is also what lets `BoundarySpan` do its real job here: the arena is a
 *          bounded region, so a JS-supplied span is range-checked on a device
 *          exactly as it is in the sandbox (see `setBoundaryRegion`).
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include <cstddef>
#include <cstdint>

namespace eshost {

/**
 * Reserve the arena on first use and answer its base. Null only if the
 * reservation failed, which is fatal for any subsystem that marshals buffers.
 * Untouched pages never become resident, so the reservation costs address space,
 * not memory.
 */
uint8_t* heapBase();

/** Arena size in bytes (constant for the process lifetime, so JS views built over
 *  it stay valid — unlike a growable wasm heap). */
size_t heapSize();

/**
 * Allocate @p bytes and return its OFFSET, or 0 when the arena is full (0 is
 * never a valid allocation, so it reads as null the way `_malloc` does). First
 * fit over an implicit block list, coalescing free neighbours as it scans.
 */
uint32_t heapAlloc(size_t bytes);

/** Release an offset from {@link heapAlloc}. A 0 offset is a no-op. */
void heapFree(uint32_t offset);

/**
 * Resolve an offset to a real address, or nullptr when it is out of range.
 * @param bytes The span length when the caller knows it (0 = unknown, then only
 *              the offset itself is checked; the binding's own `BoundarySpan`
 *              validates the length).
 */
void* heapPtr(uint32_t offset, size_t bytes);

/** Peak bytes handed out, for the boot log — an arena that runs out should say so
 *  before a subsystem starts silently dropping buffers. */
size_t heapHighWater();

// Publishing a module-owned buffer INTO the heap (what an entry point that returns
// a pointer needs) goes through `EsnSlot` / `esn_publish` in esn_shim.hpp: that is
// the layer the generated wrappers are written against, and one mechanism is
// enough.

}  // namespace eshost
