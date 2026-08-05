// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  surfaceDriver.ts — main-side calls INTO the live editor window.
 *
 * The tool catalog (shared/toolCatalog.mjs) dispatches through an injected
 * `driver`, and this is the one that targets the real editor app: surface
 * calls resolve on `window.__estellaEditor.surface` (the same
 * EditorControlSurface the UI uses), `root: 'editor'` calls on
 * `window.__estellaEditor` (project / asset / play doors), renderer-code
 * snippets run verbatim, and the two main-process ops reach what the renderer
 * cannot — the composited window, and the play realm's out-of-process frame.
 *
 * Deliberately transport-free. The loopback /exec endpoint wraps this
 * (mcpEndpoint.ts owns the token, discovery file and ready line), and anything
 * else in main that wants to drive the editor calls the same object directly —
 * so an in-process caller and a remote MCP client cannot drift apart.
 */
import type { BrowserWindow } from 'electron';

/** What the tool registry calls: a surface/editor method, plus the two escape
 *  hatches it also knows about (`js` renderer code, `op` main-process routines). */
export interface SurfaceDriver {
  (method: string, args?: readonly unknown[], root?: string): Promise<unknown>;
  js(code: string): Promise<unknown>;
  op(op: string, input?: Record<string, unknown>): Promise<unknown>;
}

/**
 * executeJavaScript rejects a thrown error with an opaque "Script failed to
 * execute". Wrap the expression so the real message crosses the boundary — a
 * surface error like `component "X" is not on entity 5` IS the caller's
 * feedback, not a debugging detail.
 */
/**
 * Wrap a snippet so its value comes back and its throw becomes ours.
 *
 * A probe body is a PROGRAM, not necessarily an expression — `a(); b(); "done"`
 * is what anyone writes, and inside parentheses that is a syntax error. Which
 * form to use is decided HERE, in the main process, by trying to parse it: the
 * realm has a CSP and must not be asked to compile anything. An expression keeps
 * its implicit value; a body returns what it returns.
 */
const carryError = (code: string): string => {
  let isExpression = true;
  try {
    new Function(`return (${code})`);
  } catch {
    isExpression = false;
  }
  const value = isExpression ? `await (${code})` : `await (async () => { ${code} })()`;
  return `(async () => { try { return { v: ${value} }; } catch (e) { return { __estellaExecError: (e && e.message) || String(e) }; } })()`;
};

function unwrap(res: unknown): unknown {
  const r = res as { v?: unknown; __estellaExecError?: string } | null;
  if (r && typeof r === 'object' && r.__estellaExecError !== undefined) throw new Error(r.__estellaExecError);
  return r?.v;
}

/** JSON-encode a call's arguments, keeping `undefined` as the literal so the
 *  target method's own default parameters apply. */
const encodeArgs = (args: readonly unknown[]): string =>
  args.map((a) => (a === undefined ? 'undefined' : JSON.stringify(a))).join(',');

/**
 * A driver bound to the editor window. `getWin` re-resolves per call, so a
 * recreated window keeps working and a driver built before the window exists
 * is still valid.
 */
export function createSurfaceDriver(getWin: () => BrowserWindow | null): SurfaceDriver {
  const requireWin = (): BrowserWindow => {
    const win = getWin();
    if (!win) throw new Error('no editor window');
    return win;
  };

  const exec = async (code: string): Promise<unknown> => {
    const win = requireWin();
    // A call can arrive before the renderer finished booting (the endpoint comes
    // up with the window) — wait out the initial load instead of failing it.
    // Polled, never event-awaited: isLoading() covers SUBFRAMES (the play realm
    // prewarms in an iframe seconds after a project opens), but did-finish-load
    // fires only for the main frame — a call that awaited the event during a
    // subframe load parked forever, timing out whichever automation call drew
    // the short straw. Bounded: a page that never settles still gets the call,
    // and executeJavaScript's own error is a better answer than silence.
    for (let waited = 0; win.webContents.isLoading() && waited < 10_000; waited += 50) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return unwrap(await win.webContents.executeJavaScript(carryError(code), true));
  };

  const driver = ((method: string, args: readonly unknown[] = [], root?: string) => {
    const target = root === 'editor' ? 'window.__estellaEditor' : 'window.__estellaEditor.surface';
    return exec(`${target}.${method}(${encodeArgs(args)})`);
  }) as SurfaceDriver;

  driver.js = exec;

  driver.op = async (op, input = {}) => {
    switch (op) {
      case 'screenshot': {
        // The composited window, not the viewport canvas: this is the only way to
        // see the play realm, which renders in its own frame.
        const image = await requireWin().webContents.capturePage();
        return image.toPNG().toString('base64');
      }
      case 'play_probe': {
        // The play realm is an estella:// OOPIF — only a main-process frame eval
        // reaches it (window.__estellaPlay is the probe the realm publishes).
        const frames = requireWin().webContents.mainFrame.frames.filter((f) => f.url.startsWith('estella://'));
        const at = Number(input.frame ?? 0);
        const frame = frames[at];
        if (!frame) {
          throw new Error(`no play realm at index ${at} (${frames.length} running — enter play first)`);
        }
        return unwrap(await frame.executeJavaScript(carryError(String(input.code ?? 'true'))));
      }
      case 'play_input': {
        // Same frame lookup as play_probe — the realm is the only thing that has
        // an InputState — but the code is OURS, so a caller cannot mistype the
        // facade and get silence. Everything routes through the realm's
        // `__estellaPlay.input`, which is the platform binding's own callbacks.
        const frames = requireWin().webContents.mainFrame.frames.filter((f) => f.url.startsWith('estella://'));
        const at = Number(input.frame ?? 0);
        const frame = frames[at];
        if (!frame) {
          throw new Error(`no play realm at index ${at} (${frames.length} running — enter play first)`);
        }
        const { kind } = input as { kind?: string };
        const x = Number(input.x ?? 0), y = Number(input.y ?? 0);
        const button = Number(input.button ?? 0);
        const code = JSON.stringify(String(input.code ?? ''));
        const id = 1;
        const call = {
          click: `i.down(${x},${y},${button}); i.up(${button});`,
          move: `i.move(${x},${y});`,
          down: `i.down(${x},${y},${button});`,
          up: `i.up(${button});`,
          wheel: `i.wheel(${x},${y});`,
          key_down: `i.keyDown(${code});`,
          key_up: `i.keyUp(${code});`,
          tap: `i.touchStart(${id},${x},${y}); i.touchEnd(${id});`,
        }[kind ?? ''];
        if (!call) {
          throw new Error(
            `unknown play_input kind "${kind}" — one of click, move, down, up, wheel, key_down, key_up, tap`,
          );
        }
        return unwrap(await frame.executeJavaScript(carryError(
          `(() => { const p = window.__estellaPlay; if (!p || !p.input) `
          + `throw new Error('this play realm publishes no input door — it predates play_input'); `
          + `const i = p.input; ${call} return 'ok'; })()`,
        )));
      }
      default:
        throw new Error(`unknown main-process op: ${op}`);
    }
  };

  return driver;
}
