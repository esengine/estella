// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  imageSize.ts — a project image's pixel dimensions, decoded once.
 *
 * Several places need "how big is this PNG" for real geometry, not decoration: the
 * size a dropped sprite spawns at, the size an assigned texture fits to, a tileset's
 * grid. Each decoding its own `new Image()` means one project image is decoded once
 * per asker, and — worse — an asker that needs the answer NOW has to go async even
 * though something else already has it. One cache, so the second asker is free.
 */

/** A decoded image's pixel dimensions. */
export interface ImageSize {
  x: number;
  y: number;
}

const cache = new Map<string, ImageSize>();
const inFlight = new Map<string, Promise<ImageSize>>();

/** The fallback for an image that cannot be decoded — never zero, so a sprite built
 *  from it is still visible and selectable rather than a zero-area quad. */
export const FALLBACK_IMAGE_SIZE: ImageSize = { x: 100, y: 100 };

/** The dimensions if they are already known, else null — the synchronous read, for a
 *  caller that can only act inside the current tick (an undo-coalescing edit). */
export function peekImageSize(path: string): ImageSize | null {
  return cache.get(path) ?? null;
}

/** The dimensions of a project image, decoded through the `estella://` transport and
 *  memoized by path. Concurrent asks for one path share a single decode. */
export function imageSize(path: string): Promise<ImageSize> {
  const hit = cache.get(path);
  if (hit) return Promise.resolve(hit);
  const running = inFlight.get(path);
  if (running) return running;
  const p = new Promise<ImageSize>((resolve) => {
    const img = new Image();
    const done = (size: ImageSize) => {
      cache.set(path, size);
      inFlight.delete(path);
      resolve(size);
    };
    img.onload = () => done(
      img.naturalWidth > 0 && img.naturalHeight > 0
        ? { x: img.naturalWidth, y: img.naturalHeight }
        : FALLBACK_IMAGE_SIZE,
    );
    img.onerror = () => done(FALLBACK_IMAGE_SIZE);
    img.src = `estella://project/${path}`;
  });
  inFlight.set(path, p);
  return p;
}

/** Drop a path's cached size — the image on disk changed (re-import, external edit),
 *  so the next ask must decode again. */
export function invalidateImageSize(path: string): void {
  cache.delete(path);
  inFlight.delete(path);
}
