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
 * `{ keys?, pointer?, frames?, taps?: [{key, at}], holds?: [{key, from, to}] }`
 *
 * `keys` hold for the whole run, `taps` press at a frame index, `holds` hold over
 * a frame range. A playthrough is a sequence, not a posture: "walk there, turn
 * round, hit it" cannot be said by keys all pressed at frame zero.
 */
export function inputScript(spec) {
  const keys = JSON.stringify(spec.keys ?? []);
  const pointer = JSON.stringify(spec.pointer ?? null);
  const frames = Number(spec.frames ?? 40);
  const taps = JSON.stringify(
    (spec.taps ?? []).map((t) => ({ key: String(t.key), at: Number(t.at) || 0 })),
  );
  const holds = JSON.stringify(
    (spec.holds ?? []).map((h) => ({
      key: String(h.key), from: Number(h.from) || 0, to: Number(h.to ?? frames),
    })),
  );
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
      const taps = ${taps};
      const holds = ${holds};
      const down = new Set();
      for (let i = 0; i < ${frames}; i++) {
        for (const h of holds) {
          if (h.from === i) { fireKey('keydown', h.key); down.add(h.key); }
          if (h.to === i && down.has(h.key)) { fireKey('keyup', h.key); down.delete(h.key); }
        }
        for (const t of taps) {
          if (t.at !== i) continue;
          fireKey('keydown', t.key);
          // Held a couple of frames for the same reason a pointer press is:
          // a key sampled once per frame can land between two of them.
          for (let j = 0; j < 2; j++) await raf();
          fireKey('keyup', t.key);
        }
        await raf();
      }
      for (const k of down) fireKey('keyup', k);
      for (const k of keys) fireKey('keyup', k);
      await raf();
      return keys.length + taps.length + holds.length + (pointer ? 1 : 0);
    })()
  `;
}
