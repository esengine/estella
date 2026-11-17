// SPDX-License-Identifier: Apache-2.0

/** Settle rendered frames after the export's boot overlay stops intercepting input. */
export function packageFramesScript(settle, timeout) {
  if (!Number.isInteger(settle) || settle < 0 || !Number.isFinite(timeout) || timeout < 0) {
    throw new Error('Package settling requires nonnegative frames and a finite timeout');
  }
  return '(' + waitPackageFrames.toString() + ')(' + settle + ',' + timeout + ')';
}

function waitPackageFrames(settle, timeout) {
  return new Promise(resolve => {
    let frames = 0, phase = 'canvas', finished = false, pendingFrame;
    const finish = ok => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(pendingFrame);
      clearTimeout(deadline);
      resolve({ok, frames, phase: ok ? 'ready' : phase});
    };
    // A stalled requestAnimationFrame must not suspend the deadline too.
    const deadline = setTimeout(() => finish(false), timeout);
    const tick = () => {
      const canvas = document.querySelector('canvas');
      const overlay = document.getElementById('es-splash');
      if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
        frames = 0; phase = 'canvas';
      } else if ((overlay && !overlay.classList.contains('es-splash-gone')) || globalThis.__estellaIdentDone === false) {
        frames = 0; phase = 'boot';
      } else {
        phase = 'settle'; frames++;
        if (frames >= settle) return finish(true);
      }
      pendingFrame = requestAnimationFrame(tick);
    };
    pendingFrame = requestAnimationFrame(tick);
  });
}
