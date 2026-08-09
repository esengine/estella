// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    hoverSelect.ts
 * @brief   Shared hover-selection for keyboard-first pickers (command palette,
 *          Add Component, Create, @-mention): the row under the pointer takes
 *          the selection, but only once the pointer has actually moved.
 */
import { useCallback, useRef } from 'react';

/**
 * A gate that answers "did the pointer MOVE here", not "is it here".
 *
 * `mouseenter` also fires for content appearing (or scrolling) beneath a still
 * pointer, which hands an arbitrary row the keyboard's selection. The first
 * position only arms the gate, so an event at the resting spot never passes.
 */
export function makeMoveGate(): (x: number, y: number) => boolean {
  let at: { x: number; y: number } | null = null;
  return (x, y) => {
    const prev = at;
    at = { x, y };
    return prev != null && (prev.x !== x || prev.y !== y);
  };
}

/** Row props that give the active selection to whatever the pointer moves over. */
export function useHoverSelect(): (select: () => void) => { onMouseMove: (e: { clientX: number; clientY: number }) => void } {
  const moved = useRef<((x: number, y: number) => boolean) | null>(null);
  moved.current ??= makeMoveGate();
  return useCallback(
    (select: () => void) => ({
      onMouseMove: (e: { clientX: number; clientY: number }) => {
        if (moved.current!(e.clientX, e.clientY)) select();
      },
    }),
    [],
  );
}
