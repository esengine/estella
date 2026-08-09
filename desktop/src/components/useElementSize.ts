// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    useElementSize.ts
 * @brief   Live content-box size of a ref'd element, for the panels that fit a
 *          drawing to the space a dock gave them (9-slice box, flipbook stage).
 */
import { useEffect, useState, type RefObject } from 'react';

/** Observes `ref` and returns its client size; `{ w: 0, h: 0 }` before first layout. */
export function useElementSize(ref: RefObject<HTMLElement | null>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    // The element's own document: a popped-out panel lives in another window,
    // whose ResizeObserver is the one that fires for it.
    const RO = el.ownerDocument.defaultView?.ResizeObserver ?? ResizeObserver;
    const ro = new RO(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}
