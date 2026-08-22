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
 * `{ keys?, pointer?, frames?, taps?: [{key, at}], holds?: [{key, from, to}],
 *    touches?: [{ from, to, x, y, toX?, toY? }] }`
 *
 * `keys` hold for the whole run, `taps` press at a frame index, `holds` hold over
 * a frame range. A playthrough is a sequence, not a posture: "walk there, turn
 * round, hit it" cannot be said by keys all pressed at frame zero.
 *
 * `hidden` is a frame range the page spends in the background: document.hidden
 * plus a visibilitychange, which is the pair the engine's lifecycle listens to.
 *
 * `pad` is a gamepad the harness holds: the engine polls navigator.getGamepads,
 * so standing one up there drives its real polling path rather than poking its
 * state. Each entry sets axes/buttons over a frame range.
 *
 * `touches` are real TouchEvents — what a phone sends and what the web platform
 * binds; a mouse pointer proves nothing about playing with a thumb. Each presses
 * at (x, y) and optionally drags to (toX, toY) over its frame range, in
 * fractions of the surface.
 */
export function inputScript(spec) {
  const keys = JSON.stringify(spec.keys ?? []);
  const pointer = JSON.stringify(spec.pointer ?? null);
  const frames = Number(spec.frames ?? 40);
  const taps = JSON.stringify(
    (spec.taps ?? []).map((t) => ({ key: String(t.key), at: Number(t.at) || 0 })),
  );
  const hidden = JSON.stringify(
    (spec.hidden ?? []).map((h) => ({ from: Number(h.from) || 0, to: Number(h.to ?? frames) })),
  );
  const pad = JSON.stringify(
    (spec.pad ?? []).map((p) => ({
      from: Number(p.from) || 0,
      to: Number(p.to ?? frames),
      axes: p.axes ?? {},
      buttons: p.buttons ?? {},
    })),
  );
  const touches = JSON.stringify(
    (spec.touches ?? []).map((t, i) => ({
      id: i + 1,
      from: Number(t.from) || 0,
      to: Number(t.to ?? frames),
      x: Number(t.x) || 0,
      y: Number(t.y) || 0,
      toX: t.toX === undefined ? Number(t.x) || 0 : Number(t.toX),
      toY: t.toY === undefined ? Number(t.y) || 0 : Number(t.toY),
    })),
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
      let touchBroken = null;
      const fireTouch = (type, id, x, y, live) => {
        if (!canvas || touchBroken) return;
        try {
        const r = canvas.getBoundingClientRect();
        // Real Touch instances: TouchEvent's lists reject plain objects, and a
        // constructor that throws leaves the driver's promise unresolved — the
        // harness hangs rather than failing.
        const make = (t) => new Touch({
          identifier: t.id, target: canvas,
          clientX: r.left + r.width * t.x, clientY: r.top + r.height * t.y,
          pageX: r.left + r.width * t.x, pageY: r.top + r.height * t.y,
          screenX: r.left + r.width * t.x, screenY: r.top + r.height * t.y,
        });
        const changed = [make({ id, x, y })];
        // The full list is every finger still down; the changed list only the
        // ones this event is about. A handler reading the wrong one loses a
        // second finger, so the harness fills both.
        const all = live.map((t) => make(t));
        canvas.dispatchEvent(new TouchEvent(type, {
          bubbles: true, cancelable: true,
          touches: all, targetTouches: all, changedTouches: changed,
        }));
        } catch (e) {
          touchBroken = String(e);
          console.log('[engine] touch events unavailable: ' + touchBroken);
        }
      };

      const taps = ${taps};
      const holds = ${holds};
      const touches = ${touches};
      const hiddenSpec = ${hidden};
      const setHidden = (h) => {
        Object.defineProperty(document, 'hidden', { value: h, configurable: true });
        Object.defineProperty(document, 'visibilityState', {
          value: h ? 'hidden' : 'visible', configurable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      };
      const padSpec = ${pad};
      let padState = null;
      if (padSpec.length) {
        padState = {
          index: 0, id: 'harness pad', connected: true, mapping: 'standard', timestamp: 0,
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
          axes: [0, 0, 0, 0],
        };
        Object.defineProperty(navigator, 'getGamepads', {
          value: () => [padState], configurable: true, writable: true,
        });
      }
      const live = [];
      const down = new Set();
      for (let i = 0; i < ${frames}; i++) {
        for (const h of holds) {
          if (h.from === i) { fireKey('keydown', h.key); down.add(h.key); }
          if (h.to === i && down.has(h.key)) { fireKey('keyup', h.key); down.delete(h.key); }
        }
        for (const h of hiddenSpec) {
          if (i === h.from) setHidden(true);
          else if (i === h.to) setHidden(false);
        }
        if (padState) {
          for (const p of padSpec) {
            const on = i >= p.from && i < p.to;
            for (const k of Object.keys(p.axes)) padState.axes[+k] = on ? p.axes[k] : 0;
            for (const k of Object.keys(p.buttons)) {
              const v = on ? p.buttons[k] : 0;
              padState.buttons[+k] = { pressed: v > 0.5, touched: v > 0, value: v };
            }
          }
          padState.timestamp = i;
        }
        for (const t of touches) {
          if (i === t.from) {
            live.push({ id: t.id, x: t.x, y: t.y });
            fireTouch('touchstart', t.id, t.x, t.y, live);
          } else if (i > t.from && i < t.to) {
            const k = (i - t.from) / Math.max(1, t.to - t.from);
            const at = live.find((l) => l.id === t.id);
            if (at) {
              at.x = t.x + (t.toX - t.x) * k;
              at.y = t.y + (t.toY - t.y) * k;
              fireTouch('touchmove', t.id, at.x, at.y, live);
            }
          } else if (i === t.to) {
            const at = live.find((l) => l.id === t.id);
            const idx = live.indexOf(at);
            if (idx >= 0) live.splice(idx, 1);
            fireTouch('touchend', t.id, at ? at.x : t.toX, at ? at.y : t.toY, live);
          }
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
      return keys.length + taps.length + holds.length + touches.length + padSpec.length
        + hiddenSpec.length + (pointer ? 1 : 0);
    })()
  `;
}
