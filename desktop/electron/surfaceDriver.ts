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
import { scriptDiagnostics, lookupScriptSymbol, isScriptPath } from './scriptService';
import { searchInRoot, writeInRoot } from './projectFs';

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
const carryError = (code: string, preamble = ''): string => {
  let isExpression = true;
  try {
    new Function(`return (${code})`);
  } catch {
    isExpression = false;
  }
  const value = isExpression ? `await (${code})` : `await (async () => { ${code} })()`;
  return `(async () => { try { ${preamble} return { v: ${value} }; } catch (e) { return { __estellaExecError: (e && e.message) || String(e) }; } })()`;
};

interface GameRect {
  x: number; y: number; width: number; height: number;
  windowWidth: number; windowHeight: number; playing: boolean;
}

/**
 * A capture, as sixteen colour letters — the screenshot for a caller with no vision.
 *
 * Half the models an editor gets pointed at cannot receive an image, and for those the
 * whole verifying-by-looking half of the job was closed: the agent kernel told them, in
 * so many words, not to spend a call on a picture they could not see. So they verified
 * by reading their own fields back, which is exactly the reading that cannot see a
 * sprite that never drew, content off camera, or a shader that came out black.
 *
 * Coarse on purpose. At 64 columns a cell is a dozen-odd pixels, which is enough for
 * "five rows of colour across the top, one white bar near the bottom, a dot between
 * them" — a Breakout, recognisably — and small enough to read in a tool result. The
 * palette is fixed rather than a per-capture legend, so the letters mean the same thing
 * in every reply and can be reasoned about directly.
 */
const PALETTE: ReadonlyArray<[string, number, number, number, string]> = [
  ['.', 0, 0, 0, 'black'], ['K', 85, 85, 85, 'dark grey'],
  ['r', 128, 0, 0, 'dark red'], ['R', 255, 0, 0, 'red'],
  ['g', 0, 128, 0, 'dark green'], ['G', 0, 255, 0, 'green'],
  ['y', 128, 128, 0, 'olive'], ['Y', 255, 255, 0, 'yellow'],
  ['b', 0, 0, 128, 'navy'], ['B', 0, 0, 255, 'blue'],
  ['m', 128, 0, 128, 'purple'], ['M', 255, 0, 255, 'magenta'],
  ['c', 0, 128, 128, 'teal'], ['C', 0, 255, 255, 'cyan'],
  ['w', 170, 170, 170, 'grey'], ['W', 255, 255, 255, 'white'],
];

/** The legend, WRITTEN FROM the palette — a hand-kept one drifts, and it did:
 *  `K` (the dark grey between black and grey, and the commonest ink in a dim
 *  scene) was missing from it, so the one channel a blind caller reads was
 *  handing back a letter its own key did not explain. */
const PALETTE_LEGEND = PALETTE.map(([ink, , , , name]) => `${ink} ${name}`).join('  ');

function nearestInk(r: number, g: number, b: number): string {
  let best = '.';
  let bestDist = Infinity;
  for (const [ink, pr, pg, pb] of PALETTE) {
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestDist) { bestDist = d; best = ink; }
  }
  return best;
}

function colorGrid(image: Electron.NativeImage, rect: GameRect | null, cols: number, rows: number): string {
  const w = Math.max(8, Math.min(160, Math.round(cols)));
  const h = Math.max(4, Math.min(90, Math.round(rows)));
  const full = image.getSize();
  let shot = image;
  let what = 'the whole editor window';
  if (rect && rect.windowWidth > 0) {
    // capturePage is in device pixels and the rect is in CSS pixels.
    const scale = full.width / rect.windowWidth;
    const crop = {
      x: Math.max(0, Math.round(rect.x * scale)),
      y: Math.max(0, Math.round(rect.y * scale)),
      width: Math.min(full.width, Math.round(rect.width * scale)),
      height: Math.min(full.height, Math.round(rect.height * scale)),
    };
    if (crop.width > 8 && crop.height > 8) {
      shot = image.crop(crop);
      what = rect.playing ? 'the RUNNING GAME' : 'the edit viewport';
    }
  }
  // BGRA, row-major. Electron 42's own typings declare this `void`; it returns the
  // buffer the docs promise, so the cast is over their declaration, not over reality.
  const src = shot.getSize();
  const bitmap = shot.getBitmap() as unknown as Buffer;
  const cols_ = Math.min(w, src.width);
  const rows_ = Math.min(h, src.height);

  // Each cell reports its most UNUSUAL pixel, not its average. Downscaling was
  // the obvious way to build this grid and it hides precisely what a game is
  // made of: a bullet, a thin sprite, a line of text is a few pixels inside a
  // twenty-pixel cell, and averaged against the background it comes back as
  // empty space. A dogfood run read a screen with a row of aliens across the
  // top of it as blank and carried on. So: find the background (the commonest
  // colour in the capture), then let whichever pixel is FURTHEST from it speak
  // for the cell.
  const ink = new Uint8Array(src.width * src.height);
  const inkIndex = new Map(PALETTE.map(([letter], i) => [letter, i]));
  const counts = new Array(PALETTE.length).fill(0);
  for (let p = 0, n = src.width * src.height; p < n; p++) {
    const i = p * 4;
    const idx = inkIndex.get(nearestInk(bitmap[i + 2], bitmap[i + 1], bitmap[i])) ?? 0;
    ink[p] = idx;
    counts[idx]++;
  }
  let bg = 0;
  for (let i = 1; i < counts.length; i++) if (counts[i] > counts[bg]) bg = i;
  const [, br, bgc, bb] = PALETTE[bg];

  const lines: string[] = [];
  for (let cy = 0; cy < rows_; cy++) {
    const y0 = Math.floor((cy * src.height) / rows_);
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * src.height) / rows_));
    let line = '';
    for (let cx = 0; cx < cols_; cx++) {
      const x0 = Math.floor((cx * src.width) / cols_);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * src.width) / cols_));
      let best = bg;
      let bestDist = -1;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * src.width + x) * 4;
          const d = (bitmap[i + 2] - br) ** 2 + (bitmap[i + 1] - bgc) ** 2 + (bitmap[i] - bb) ** 2;
          if (d > bestDist) { bestDist = d; best = ink[y * src.width + x]; }
        }
      }
      line += PALETTE[best][0];
    }
    lines.push(`${String(cy).padStart(2, ' ')} ${line}`);
  }
  const px = rect ? `${Math.round(rect.width / cols_)}x${Math.round(rect.height / rows_)} css px` : 'unknown';
  return [
    `${cols_}x${rows_} colour grid of ${what} (one letter per ${px} cell).`,
    `Palette: ${PALETTE_LEGEND}. Column 0 is the LEFT edge, row 0 the TOP.`,
    'Each cell is its most unusual pixel, not an average, so one bullet in a cell'
    + ` still shows. The background here came out \`${PALETTE[bg][0]}\` (${PALETTE[bg][4]}).`,
    ...lines,
  ].join('\n');
}

/**
 * What a play probe finds already in scope.
 *
 * The tool's own description says the surface IS `window.__estellaPlay = { find, … }`,
 * and every driver so far has read that as "so `find(...)` works" and written exactly
 * that. It did not, and the first four probes of a session went to discovering the
 * prefix instead of the game. Destructuring here makes the obvious reading the true
 * one; `window.__estellaPlay` keeps working for code that spells it out.
 */
const PROBE_SCOPE =
  'const p = window.__estellaPlay;'
  + " if (!p) throw new Error('this realm publishes no probe surface — enter play first');"
  + ' const { app, getComponent, find, componentNames, resource, setResource, input, get, set, step } = p;';

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
export function createSurfaceDriver(
  getWin: () => BrowserWindow | null,
  getRoot: () => string | null = () => null,
): SurfaceDriver {
  const requireWin = (): BrowserWindow => {
    const win = getWin();
    if (!win) throw new Error('no editor window');
    return win;
  };
  const requireProjectRoot = (): string => {
    const root = getRoot();
    if (!root) throw new Error('no project open');
    return root;
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
        if (input.format !== 'grid') return image.toPNG().toString('base64');
        // The same picture, in the only form a caller without vision can read.
        const rect = await exec('window.__estellaEditor.gameRect()') as GameRect | null;
        return colorGrid(image, rect, Number(input.cols ?? 64), Number(input.rows ?? 32));
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
        return unwrap(await frame.executeJavaScript(carryError(String(input.code ?? 'true'), PROBE_SCOPE)));
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
      // — What the TypeScript compiler knows. Main-process because the language
      //   service lives here (scriptService.ts), reading the project off disk. —
      case 'check_scripts':
        return scriptDiagnostics(input.path ? String(input.path) : undefined);
      case 'lookup_symbol': {
        // One call, any number of names. Learning an unfamiliar API means asking about
        // a dozen symbols at once, and one-per-call turned that into a dozen round
        // trips — a Breakout dogfood spent 32 of its calls here before writing a line.
        const limit = input.limit === undefined ? undefined : Number(input.limit);
        const names = Array.isArray(input.name)
          ? (input.name as unknown[]).map(String)
          : [String(input.name ?? '')];
        if (names.length === 1) return lookupScriptSymbol(names[0], limit);
        const out: Record<string, unknown> = {};
        for (const name of names) out[name] = lookupScriptSymbol(name, limit);
        return out;
      }
      case 'search_project_files':
        return searchInRoot(requireProjectRoot(), {
          query: String(input.query ?? ''),
          regex: Boolean(input.regex),
          glob: input.glob === undefined ? undefined : String(input.glob),
          maxResults: input.maxResults === undefined ? undefined : Number(input.maxResults),
        });
      case 'write_project_file': {
        // The write and the compiler's verdict on it are ONE answer. Split apart
        // they are two tool calls, the second of which nobody makes: an agent
        // that has just written a file believes it.
        const relPath = String(input.path ?? '');
        const content = String(input.content ?? '');
        await writeInRoot(requireProjectRoot(), relPath, content);
        if (!isScriptPath(relPath)) return { ok: true, path: relPath };
        // A file that DECLARES components changes what the editor knows an entity
        // can carry, and the watcher only gets there after a 250ms debounce plus
        // an extract. A writer uses what it just declared in the very next call —
        // a person pauses between the two, nothing else does — and the reply it
        // raced was "component X has no field Y (fields: )": an empty schema,
        // worded as a typo. Same contract as the asset doors: returned ⇒ usable.
        if (/\bdefine(Component|Tag)\s*\(/.test(content)) {
          await exec('window.__estellaEditor.refreshSchemas()').catch(() => {
            // No automation hook published (a host with no driver authorised) —
            // the debounced watcher still gets there, just later.
          });
        }
        const diagnostics = scriptDiagnostics(relPath).filter((d) => d.category === 'error');
        return { ok: true, path: relPath, errors: diagnostics.length, diagnostics: diagnostics.slice(0, 40) };
      }
      default:
        throw new Error(`unknown main-process op: ${op}`);
    }
  };

  return driver;
}
