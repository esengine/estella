// Does Chromium hand a WebGL2 context back at all, in THIS environment?
// No engine, no wasm — just the extension and the spec's contract, so a red
// result here means the harness is wrong and a green one means the engine is.
import { app, BrowserWindow } from 'electron';

const HTML = `data:text/html,<html><body><canvas id="c" width="64" height="64"></canvas></body></html>`;



app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 200, height: 200 });
  await win.loadURL(HTML);

  const probe = async (listenOn) => win.webContents.executeJavaScript(`(async () => {
    const c = document.getElementById('c');
    const gl = c.getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_lose_context');
    const out = { listenOn: ${JSON.stringify(listenOn)}, hasGl: !!gl, hasExt: !!ext };
    if (!ext) return out;

    let restoredFired = false;
    const target = ${listenOn === 'window' ? 'window' : 'c'};
    const capture = ${listenOn === 'window'};
    target.addEventListener('webglcontextlost', (e) => { e.preventDefault(); }, capture);
    target.addEventListener('webglcontextrestored', () => { restoredFired = true; }, capture);

    ext.loseContext();
    await new Promise((r) => setTimeout(r, 200));
    out.lostAfterLose = gl.isContextLost();

    // The spec says restoreContext may only be honoured after the lost event
    // has been dispatched, so this deliberately runs in a later task.
    ext.restoreContext();
    await new Promise((r) => setTimeout(r, 1500));
    out.lostAfterRestore = gl.isContextLost();
    out.restoredEventFired = restoredFired;
    return out;
  })()`, true);

  // A fresh page per variant: a context that already died would poison the next.
  const onCanvas = await probe('canvas');
  await win.loadURL(HTML);
  const onWindow = await probe('window');

  // The one difference left between this probe and the engine: the engine's
  // canvas is never attached to the document.
  await win.loadURL(HTML);
  const detached = await win.webContents.executeJavaScript(`(async () => {
    const c = document.createElement('canvas');   // deliberately NOT appended
    c.width = 64; c.height = 64;
    const gl = c.getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_lose_context');
    const out = { attached: false, hasGl: !!gl, hasExt: !!ext };
    if (!ext) return out;
    let restoredFired = false;
    c.addEventListener('webglcontextlost', (e) => { e.preventDefault(); });
    c.addEventListener('webglcontextrestored', () => { restoredFired = true; });
    ext.loseContext();
    await new Promise((r) => setTimeout(r, 200));
    out.lostAfterLose = gl.isContextLost();
    ext.restoreContext();
    await new Promise((r) => setTimeout(r, 1500));
    out.lostAfterRestore = gl.isContextLost();
    out.restoredEventFired = restoredFired;
    return out;
  })()`, true);

  // The other difference: the engine keeps running frames against the dead
  // context between the loss and the restore.
  await win.loadURL(HTML);
  const busy = await win.webContents.executeJavaScript(`(async () => {
    const c = document.getElementById('c');
    const gl = c.getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_lose_context');
    const out = { keepsDrawing: true, hasExt: !!ext };
    if (!ext) return out;
    let restoredFired = false;
    c.addEventListener('webglcontextlost', (e) => { e.preventDefault(); });
    c.addEventListener('webglcontextrestored', () => { restoredFired = true; });

    ext.loseContext();
    await new Promise((r) => setTimeout(r, 200));
    out.lostAfterLose = gl.isContextLost();

    const hammer = setInterval(() => { gl.clear(gl.COLOR_BUFFER_BIT); gl.getError(); }, 16);
    ext.restoreContext();
    await new Promise((r) => setTimeout(r, 1500));
    clearInterval(hammer);
    out.lostAfterRestore = gl.isContextLost();
    out.restoredEventFired = restoredFired;
    return out;
  })()`, true);

  console.log('PROBE ' + JSON.stringify({ onCanvas, onWindow, detached, busy }));
  app.quit();
});
