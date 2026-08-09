// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  inputScript.mjs — the gesture a launcher plays into a packaged game.
 *
 * Shared by launch-export and launch-minigame so a golden project's declared
 * input means one thing whichever package it is driving. Events are real DOM
 * events on the page the build owns: a package has no automation hook, and the
 * point is the path a player's hardware takes, not a way around it.
 *
 * Pointer positions are FRACTIONS of the surface, because the surface size is
 * chosen per project (it follows the editor's play panel) and a pixel target
 * would land somewhere else on every game.
 */

/**
 * JS source that plays `spec` and then lets the game run on.
 * `{ keys?: string[], pointer?: { x, y, action? }, frames?: number }`
 */
export function inputScript(spec) {
  const keys = JSON.stringify(spec.keys ?? []);
  const pointer = JSON.stringify(spec.pointer ?? null);
  const frames = Number(spec.frames ?? 40);
  return `
    (async () => {
      const raf = () => new Promise((r) => requestAnimationFrame(r));
      const keys = ${keys};
      const pointer = ${pointer};
      const fireKey = (type, code) => {
        const e = new KeyboardEvent(type, { key: code, code, bubbles: true, cancelable: true });
        window.dispatchEvent(e);
        document.dispatchEvent(e);
      };
      const canvas = document.querySelector('canvas');
      // Pointer AND mouse: engines bind one or the other depending on what the
      // host advertises, and a package driven through only half of that pair
      // looks unresponsive for a reason that is the harness's fault.
      const firePointer = (type, x, y) => {
        if (!canvas) return;
        const r = canvas.getBoundingClientRect();
        const clientX = r.left + r.width * x;
        const clientY = r.top + r.height * y;
        const init = { clientX, clientY, bubbles: true, cancelable: true, button: 0, buttons: type === 'up' ? 0 : 1, pointerId: 1, isPrimary: true, pointerType: 'mouse' };
        const names = { down: ['pointerdown', 'mousedown'], move: ['pointermove', 'mousemove'], up: ['pointerup', 'mouseup'] };
        for (const n of names[type]) {
          canvas.dispatchEvent(n.startsWith('pointer') ? new PointerEvent(n, init) : new MouseEvent(n, init));
        }
        if (type === 'up') canvas.dispatchEvent(new MouseEvent('click', init));
      };

      for (const k of keys) fireKey('keydown', k);
      if (pointer) {
        firePointer('move', pointer.x, pointer.y);
        await raf();
        firePointer('down', pointer.x, pointer.y);
        // Held across a few frames: a press sampled once per frame can land
        // between two of them and never be seen as a press at all.
        for (let i = 0; i < 4; i++) await raf();
        firePointer('up', pointer.x, pointer.y);
      }
      for (let i = 0; i < ${frames}; i++) await raf();
      for (const k of keys) fireKey('keyup', k);
      await raf();
      return keys.length + (pointer ? 1 : 0);
    })()
  `;
}
