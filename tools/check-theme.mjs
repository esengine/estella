#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Whether the editor's VISUAL layer holds the contracts it was built on —
 *        colour, spacing, type, icons and which component a control is.
 *
 * Every invariant in this repository has a gate except the visual layer, which
 * is why the visual layer is the one that drifted: `--text-faint` shipped at
 * 3.26:1 on a panel — under the floor for body text, as the colour of most
 * labels in the editor — and a chart series ran on a 100%-saturated viewport
 * colour.
 *
 * Four claims are absolute: text stays readable on the surfaces it sits on, a
 * panel label stays quieter than the viewport, a token that NAMES a thing only
 * colours that thing, and a tip is the editor's rather than the OS's `title=`. That a token EXISTS at all is check-css-vars.mjs —
 * its subject is every reader of the editor's variables, plugins and docs too.
 *
 * Six are RATCHETS, because each is hundreds of declarations deep and a gate
 * that reddens on all of them gets switched off. Banked, may fall, never rise:
 * spacing off the grid `--u` declares; colour literals where a token belongs; raw
 * font-size; how many distinct icon sizes and stroke widths exist at all; and
 * hand-rolled `<button>` where the editor has a component.
 *
 *   node tools/check-theme.mjs            # check
 *   node tools/check-theme.mjs --update   # bank the current state
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS = 'desktop/src/theme/tokens.css';

/** WCAG 2.x relative luminance, then the contrast ratio between two sRGB hexes. */
const channel = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** Body text, per WCAG AA and Unity's own editor accessibility page. */
const FLOOR = 4.5;
/**
 * The surfaces text is READ on: the panel body and the raised strip above it.
 * `--srf-4` and up are hover and popover fills, where the ramp is lower by
 * construction — holding those to the body floor would mean one flat text
 * colour, so they are counted and reported, not enforced.
 */
const READING_SURFACES = ['--srf-2', '--srf-3'];

const css = readFileSync(path.join(ROOT, TOKENS), 'utf8');
const valueOf = (name) => {
  const hit = new RegExp(`^\\s*${name}:\\s*(#[0-9a-fA-F]{6})\\b`, 'm').exec(css);
  return hit ? hit[1] : null;
};

const textTokens = [...css.matchAll(/^\s*(--text(?:-[a-z]+)?):\s*(#[0-9a-fA-F]{6})\b/gm)]
  .map(([, name, hex]) => ({ name, hex }));

const problems = [];
if (textTokens.length === 0) problems.push(`${TOKENS}: no --text* tokens found — the ramp cannot be read`);

const reported = [];
for (const surface of READING_SURFACES) {
  const bg = valueOf(surface);
  if (!bg) { problems.push(`${TOKENS}: ${surface} is not a hex value — the ramp cannot be judged against it`); continue; }
  for (const { name, hex } of textTokens) {
    const ratio = contrast(hex, bg);
    reported.push({ surface, name, ratio });
    if (ratio < FLOOR) {
      problems.push(`${TOKENS}: ${name} (${hex}) is ${ratio.toFixed(2)}:1 on ${surface} (${bg}) — body text needs ${FLOOR}:1`);
    }
  }
}

/**
 * `--cat-*` labels content on a PANEL; `--gizmo-*` draws over a scene and has to
 * win against it. A deliberate borrowing is the identity rule's business, below.
 */
const saturation = (hex) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const [hi, lo] = [Math.max(r, g, b), Math.min(r, g, b)];
  if (hi === lo) return 0;
  const l = (hi + lo) / 2;
  return Math.round(((hi - lo) / (l > 0.5 ? 2 - hi - lo : hi + lo)) * 100);
};

/**
 * Only the panel ramp is held. The reverse — "a gizmo must be vivid" — was
 * written here and measured false: `--gizmo-shadow` is 19%, `--gizmo-stream-cell`
 * 17%, grey on purpose. A gizmo's saturation follows what it draws.
 */
const PANEL_CEILING = 80;

// `--asset-*` labels content in the same place and by the same rule — a content
// browser icon and a component header bar sit on the same panel.
const content = [...css.matchAll(/^\s*(--(?:cat|asset)-[a-z-]+):\s*(#[0-9a-fA-F]{6})\b/gm)]
  .map(([, name, hex]) => ({ name, hex, sat: saturation(hex) }));

if (content.length === 0) problems.push(`${TOKENS}: no --cat-*/--asset-* tokens found — the content ramp cannot be read`);
for (const { name, hex, sat } of content) {
  if (sat >= PANEL_CEILING) {
    problems.push(`${TOKENS}: ${name} (${hex}) is ${sat}% saturated — a panel label stays under ${PANEL_CEILING}%, that is viewport brightness`);
  }
}

/**
 * A token whose whole value is `var(--other)` is a second name for a value that
 * already has one. Three such vocabularies had grown over this palette, and one
 * of them put `--border` (the dark groove) beside `--border-line` (the light
 * hairline) — one word over two roles the real names keep apart.
 */
for (const m of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*var\(\s*(--[a-z0-9-]+)\s*\)\s*;/gm)) {
  problems.push(`${TOKENS}: ${m[1]} is only another name for ${m[2]} — `
    + 'one value, one name; use the one that holds it');
}

/**
 * An identity token names a thing, not a role: `--ax-x` is the X axis,
 * `--gizmo-collider` is a collider, `--sel` is the selection. Colouring anything
 * else with one is a claim about what the colour means, and the claim is false —
 * which is how a record button came to be X-axis red and a chart series came to
 * be particle amber. Role tokens (`--acc`, `--warn`, `--text-dim`) are the
 * opposite and may colour anything in that role.
 *
 * A panel may still carry one, but only as a legend: the World panel's residency
 * chips are the colours the viewport draws those cells in, and any other colour
 * there would make the legend lie. A gate cannot tell a legend from a theft, so
 * each place that may hold one is listed with the reason it names the same thing.
 */
const NAMES_THE_SAME_THING = [
  ['.viewport__', 'the scene canvas and the gizmos drawn on it'],
  ['.vp-', "the viewport's own HUD — axis ball, coordinate readout"],
  ['.ts-p', 'the tileset collision-polygon editor, a canvas of its own'],
  ['.ax.', "an Inspector vec field's axis letters: the legend for the gizmo's arms"],
  ['.world__cell-state', "the World panel's residency legend for what the viewport draws"],
  ['panels/SequencerCurve.tsx', 'a curve channel IS the axis channel, so it takes the axis colour'],
];

/**
 * Every identity family with the thing it names and the places that thing is
 * drawn. A chrome colour that turns out to name one thing belongs here: that is
 * what "the chrome has one colour" means once it is true.
 */
const IDENTITIES = [
  {
    token: /^--(?:sel|sel-hi|sel-soft|gizmo-[a-z-]+|ax-[xyz])$/,
    names: "the viewport's selection, gizmos and axes",
    places: NAMES_THE_SAME_THING,
  },
  {
    token: /^--nebula(?:-soft)?$/,
    names: 'the built-in agent',
    places: [
      ['.ag-', 'the agent drawer'],
      ['.md-', "the agent's rendered replies"],
      ['.row.agent-', 'Outliner rows the agent touched'],
      ['.act-agent', "the agent's activity-bar button"],
      ['.viewport__agentpeek', 'what the agent is pointing at in the viewport'],
      ['@keyframes ag-', "the agent's own animations"],
    ],
  },
  {
    token: /^--info-warm(?:-soft|-line)?$/,
    names: 'a prefab',
    places: [
      ['.row.prefab', 'Outliner rows that are prefab instances'],
      ['.prefab-mode-bar', 'the bar that says a prefab is open for editing'],
      ['.menubar-title .prefab-crumb-tag', 'the title crumb of an open prefab'],
      ['.shell--prefab', 'the workspace frame while a prefab is open'],
    ],
  },
  {
    token: /^--vram$/,
    names: "the profiler's GPU series",
    places: [['panels/ProfilerPanel.tsx', 'the chart that draws that series']],
  },
];
const identityOf = (name) => IDENTITIES.find((family) => family.token.test(name));

/** Comments out, offsets kept, so a selector is never read out of one. */
const uncomment = (t) => t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/** The selector a declaration sits under: back to its `{`, then to where that rule began. */
const selectorAt = (text, at) => {
  const open = text.lastIndexOf('{', at);
  if (open < 0) return '';
  const began = Math.max(text.lastIndexOf('}', open), text.lastIndexOf('{', open - 1), -1);
  return text.slice(began + 1, open).trim().replace(/\s+/g, ' ');
};

/** A keyframe stop's selector is `0%`, which says nothing; its animation's name does. */
const siteAt = (text, at) => {
  const selector = selectorAt(text, at);
  if (!/^(?:from|to|\d+%)/.test(selector)) return selector;
  return selectorAt(text, text.lastIndexOf('{', text.lastIndexOf('{', at) - 1));
};

const SRC_DIR = path.join(ROOT, 'desktop', 'src');
const everyFile = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) everyFile(p, out);
    else if (/\.(css|ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
};

let identityUses = 0;
for (const file of everyFile(SRC_DIR)) {
  const rel = path.relative(SRC_DIR, file).replaceAll(path.sep, '/');
  const text = uncomment(readFileSync(file, 'utf8'));
  for (const m of text.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
    const family = identityOf(m[1]);
    if (!family) continue;
    identityUses += 1;
    const line = text.slice(0, m.index).split('\n').length;
    // A script colouring an element has no selector, so its site is the file.
    const isCss = rel.endsWith('.css');
    const parts = isCss ? siteAt(text, m.index).split(',').map((s) => s.trim()).filter(Boolean) : [rel];
    const strayed = parts.filter((p) => !family.places.some(([where]) => p.startsWith(where)));
    if (parts.length > 0 && strayed.length === 0) continue;
    const site = parts.length === 0 ? '(no selector)' : strayed.join(', ');
    problems.push(`desktop/src/${rel}:${line}: ${site} is coloured with ${m[1]}, which names `
      + `${family.names} — an identity token only colours the thing it names`);
  }
}

/**
 * Spacing that is not on the grid, per file. A count rather than a line, so
 * inserting a rule does not churn the baseline; per file, so a fix in one place
 * cannot be spent on a regression in another.
 */
const THEME_DIR = path.join(ROOT, 'desktop', 'src', 'theme');
const BASELINE = path.join(ROOT, 'tools', 'baselines', 'theme-drift.json');

/**
 * The spacing grid, read off the token that declares it rather than repeated
 * here: `--u` had no other reader, so the theme's own statement of its grid and
 * the rule that enforces it could have disagreed with nothing to notice.
 */
const GRID = (() => {
  const px = /--u:\s*(\d+)px/.exec(readFileSync(path.join(THEME_DIR, 'tokens.css'), 'utf8'))?.[1];
  if (!px) throw new Error('desktop/src/theme/tokens.css declares no --u: the spacing grid has no author');
  return Number(px);
})();

const offGridByFile = () => {
  const out = {};
  for (const f of readdirSync(THEME_DIR).filter((n) => n.endsWith('.css'))) {
    const text = readFileSync(path.join(THEME_DIR, f), 'utf8');
    let n = 0;
    for (const m of text.matchAll(/(?:gap|padding|margin)[a-z-]*:\s*([^;}]+)/g)) {
      // A fractional value is centring arithmetic (-4.5px on a 9px dot), not a
      // spacing step, and read as `5px` it was counted as one.
      for (const px of m[1].matchAll(/(?<![\d.])(\d+)px/g)) {
        const v = Number(px[1]);
        if (v !== 0 && v % GRID !== 0) n++;
      }
    }
    if (n > 0) out[f] = n;
  }
  return out;
};

/** Colour written where a token belongs. tokens.css is the one place they are
 *  DEFINED, so it is the one file exempt. */
const colourLiteralsByFile = () => {
  const out = {};
  for (const f of readdirSync(THEME_DIR).filter((n) => n.endsWith('.css') && n !== 'tokens.css')) {
    const text = readFileSync(path.join(THEME_DIR, f), 'utf8');
    const n = (text.match(/#[0-9a-fA-F]{3,8}\b/g)?.length ?? 0)
      + (text.match(/\brgba?\(/g)?.length ?? 0);
    if (n > 0) out[f] = n;
  }
  return out;
};

/**
 * Glyphs that are drawn as ICONS, each with the reason. Their size is set by the
 * shape they sit in, not by the reading ramp, so a step of the type scale would
 * be a wrong answer rather than a tidier one. Keyed by file, then selector.
 */
const NOT_TYPE = {
  'launcher.css': {
    '.proj-card__glyph': 'a project\'s initial standing in for its thumbnail, sized to the card',
  },
  'viewport.css': {
    '.vp-axes .va-end text': 'an axis letter inside its 84px gizmo knob, sized to the circle',
  },
  'tileset.css': {
    '.ts-acell.has-anim::after': 'the ▶ badge in a tile cell\'s corner, sized to the cell',
  },
  'controls.css': {
    '.dirty-dot': 'the ● unsaved marker, relative so it follows whatever title it sits in',
  },
};

/** A font-size given as a number rather than a step of the type scale. */
const rawFontSizeByFile = () => {
  const out = {};
  for (const f of readdirSync(THEME_DIR).filter((n) => n.endsWith('.css') && n !== 'tokens.css')) {
    const text = uncomment(readFileSync(path.join(THEME_DIR, f), 'utf8'));
    const exempt = NOT_TYPE[f] ?? {};
    const seen = new Set();
    let n = 0;
    for (const m of text.matchAll(/font-size:\s*\d/g)) {
      const selector = selectorAt(text, m.index);
      if (selector in exempt) seen.add(selector);
      else n += 1;
    }
    for (const selector of Object.keys(exempt)) {
      if (!seen.has(selector)) {
        problems.push(`desktop/src/theme/${f}: ${selector} is declared an icon glyph but sets no raw `
          + 'font-size any more — drop it from NOT_TYPE');
      }
    }
    if (n > 0) out[f] = n;
  }
  return out;
};

/**
 * How many distinct sizes and stroke widths the icons use.
 *
 * Counted only for names the file itself imported from lucide: `size={44}` on an
 * asset thumbnail and `strokeWidth={12}` on an SVG hit area are not icons, and
 * counting them made the first measurement of this wrong.
 */
const iconScale = () => {
  const sizes = new Set();
  const strokes = new Set();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      const text = readFileSync(full, 'utf8');
      const names = new Set();
      for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'lucide-react'/g)) {
        for (const raw of m[1].split(',')) {
          const n = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop().trim();
          if (n && /^[A-Z]/.test(n)) names.add(n);
        }
      }
      if (names.size === 0) continue;
      for (const m of text.matchAll(/<([A-Z][A-Za-z0-9]*)\b([^>]*)>/g)) {
        if (!names.has(m[1])) continue;
        const size = /\bsize=\{(\d+(?:\.\d+)?)\}/.exec(m[2]);
        const stroke = /\bstrokeWidth=\{(\d+(?:\.\d+)?)\}/.exec(m[2]);
        if (size) sizes.add(size[1]);
        if (stroke) strokes.add(stroke[1]);
      }
    }
  };
  walk(path.join(ROOT, 'desktop', 'src'));
  return { sizes: [...sizes].sort((a, b) => a - b), strokes: [...strokes].sort((a, b) => a - b) };
};

/**
 * A DOM element's `title=` is the operating system's tooltip: unthemed, unzoomed,
 * and drawn in the wrong window from a popout. The editor's is `data-tip`
 * (TipLayer), plus an `aria-label` where the tip was the control's only name.
 * An iframe's title is its accessible name, not a tip.
 */
const nativeTitles = () => {
  const out = [];
  for (const file of everyFile(SRC_DIR)) {
    if (!file.endsWith('.tsx')) continue;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/<([a-z][a-z0-9]*)\b([^<]*?)\/?>/gs)) {
      if (m[1] === 'iframe' || !/(?<![\w-])title=/.test(m[2])) continue;
      const line = text.slice(0, m.index).split('\n').length;
      out.push(`desktop/src/${path.relative(SRC_DIR, file).replaceAll(path.sep, '/')}:${line}`);
    }
  }
  return out;
};

/** The shared controls themselves: the one `<button>` each renders is the component. */
const PRIMITIVES = new Set([
  'components/Button.tsx', 'components/IconButton.tsx', 'components/Menu.tsx',
  'components/Select.tsx', 'components/Segmented.tsx',
]);

/** A button that declares itself an item of a list, tab strip or menu is not an action button. */
const ITEM_ROLE = /\brole=(?:"|\{?['"`])(?:option|tab|menuitem|menuitemcheckbox|menuitemradio|radio)\b/;

/**
 * Buttons the editor hand-rolled rather than took from `<Button>`/`<IconButton>`.
 * A ratchet, not a rule: a raw `<button>` in a tile cell is right.
 */
const handRolledByFile = () => {
  const out = {};
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.tsx$/.test(e.name)) continue;
      const text = readFileSync(full, 'utf8');
      const rel = path.relative(path.join(ROOT, 'desktop', 'src'), full).replaceAll(path.sep, '/');
      if (PRIMITIVES.has(rel)) continue;
      const n = [...text.matchAll(/<button\b([^<]*?)\/?>/gs)].filter((m) => !ITEM_ROLE.test(m[1])).length;
      if (n > 0) out[rel] = n;
    }
  };
  walk(path.join(ROOT, 'desktop', 'src'));
  return out;
};

/**
 * Files whose colours are NOT the palette's to hold, each with the reason —
 * without this the ratchet's target of zero is unreachable, and a target nobody
 * can reach is not one anybody aims at.
 */
const NOT_THE_PALETTE = {
  'components/LoadingScreen.tsx':
    'the Estella mark itself (see favicon.svg). Its blue and --star came from the same place,'
    + ' but a logo that moves when the accent moves is not a logo',
};

/**
 * Colour written into CODE rather than read from a token. The ratchet above
 * guards `theme/`, which is where tokens are DEFINED; this guards everywhere
 * else, which is where a literal means the palette was bypassed. Generated
 * files are exempt — their colours come from whatever generated them.
 */
const colourLiteralInCodeByFile = () => {
  const out = {};
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'theme') walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(e.name) || e.name.includes('.generated.')) continue;
      const rel = path.relative(path.join(ROOT, 'desktop', 'src'), full).replaceAll(path.sep, '/');
      if (rel in NOT_THE_PALETTE) continue;
      const text = readFileSync(full, 'utf8');
      const n = (text.match(/#[0-9a-fA-F]{3,8}\b/g)?.length ?? 0)
        + (text.match(/\brgba?\(/g)?.length ?? 0);
      if (n > 0) out[rel] = n;
    }
  };
  walk(path.join(ROOT, 'desktop', 'src'));
  return out;
};

const current = offGridByFile();
const colours = colourLiteralsByFile();
const colourCode = colourLiteralInCodeByFile();
const fontSizes = rawFontSizeByFile();
const icons = iconScale();
const handRolled = handRolledByFile();
for (const site of nativeTitles()) {
  problems.push(`${site}: title= is the operating system's tooltip — use data-tip, `
    + 'and aria-label where it was the control\'s only name');
}
const total = Object.values(current).reduce((a, b) => a + b, 0);

const byName = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

if (process.argv.includes('--update')) {
  mkdirSync(path.dirname(BASELINE), { recursive: true });
  const state = {
    spacing: byName(current),
    colourLiterals: byName(colours),
    colourLiteralsInCode: byName(colourCode),
    rawFontSize: byName(fontSizes),
    iconScale: icons,
    handRolled: byName(handRolled),
  };
  writeFileSync(BASELINE, `${JSON.stringify(state, null, 2)}\n`);
  console.log(`check-theme: banked ${total} off-grid spacing(s), `
    + `${Object.values(colours).reduce((a, b) => a + b, 0)} colour literal(s) in theme, `
    + `${Object.values(colourCode).reduce((a, b) => a + b, 0)} in code, `
    + `${Object.values(fontSizes).reduce((a, b) => a + b, 0)} raw font-size(s), `
    + `${icons.sizes.length} icon size(s) and ${icons.strokes.length} stroke width(s), `
    + `${Object.values(handRolled).reduce((a, b) => a + b, 0)} hand-rolled control(s).`);
  process.exit(0);
}

let banked = {
  spacing: {}, colourLiterals: {}, colourLiteralsInCode: {}, rawFontSize: {},
  iconScale: { sizes: [], strokes: [] }, handRolled: {},
};
if (!existsSync(BASELINE)) {
  problems.push(`no drift baseline at ${BASELINE} — run with --update once to create it`);
} else {
  banked = JSON.parse(readFileSync(BASELINE, 'utf8'));
  /** Per file, so a fix in one place cannot pay for a regression in another. */
  const ratchet = (now, was, what, under = 'desktop/src/theme/') => {
    for (const [file, n] of Object.entries(now)) {
      const before = was?.[file] ?? 0;
      if (n > before) {
        problems.push(`${under}${file}: ${n - before} new ${what} (${before} banked, ${n} now)`);
      }
    }
  };
  ratchet(current, banked.spacing, `spacing value(s) off the ${GRID}px grid`);
  ratchet(colours, banked.colourLiterals, 'colour literal(s) where a token belongs');
  ratchet(colourCode, banked.colourLiteralsInCode,
    'colour literal(s) in code — read the token, do not restate it', 'desktop/src/');
  ratchet(fontSizes, banked.rawFontSize, 'raw font-size(s) — use a step of the scale');
  ratchet(handRolled, banked.handRolled,
    'hand-rolled <button> — the editor has <Button>/<IconButton>', 'desktop/src/');
  // Not per file: a new icon size anywhere is one more size the editor has.
  for (const [kind, now] of [['size', icons.sizes], ['stroke width', icons.strokes]]) {
    const was = new Set(kind === 'size' ? banked.iconScale?.sizes ?? [] : banked.iconScale?.strokes ?? []);
    const added = now.filter((v) => !was.has(v));
    if (added.length > 0) {
      problems.push(`desktop/src/: icon ${kind} ${added.join(', ')} is new — `
        + `${was.size} were already in use, and mixing them is what the ramp exists to stop`);
    }
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`  ${p}`);
  console.error(`check-theme: ${problems.length} finding(s).`);
  process.exit(1);
}

const worst = reported.reduce((a, b) => (a.ratio <= b.ratio ? a : b));
const loudest = content.reduce((a, b) => (a.sat >= b.sat ? a : b));
console.log(
  `check-theme: ${textTokens.length} text token(s) over ${READING_SURFACES.length} reading surface(s) — `
  + `all >= ${FLOOR}:1, closest is ${worst.name} at ${worst.ratio.toFixed(2)}:1 on ${worst.surface}. `
  + `${content.length} content label(s) under ${PANEL_CEILING}% saturation, loudest is ${loudest.name} at ${loudest.sat}%. `
  + `${identityUses} identity-token use(s), every one on the thing it names. `
  + `Ratchets hold: ${total} off-grid spacing(s), `
  + `${Object.values(colours).reduce((a, b) => a + b, 0)} colour literal(s) in theme `
  + `and ${Object.values(colourCode).reduce((a, b) => a + b, 0)} in code `
  + `(${Object.keys(NOT_THE_PALETTE).length} file(s) declared not the palette's), `
  + `${Object.values(fontSizes).reduce((a, b) => a + b, 0)} raw font-size(s) `
  + `(${Object.values(NOT_TYPE).reduce((a, o) => a + Object.keys(o).length, 0)} declared icon glyph(s)), `
  + `${icons.sizes.length} icon size(s) / ${icons.strokes.length} stroke width(s), `
  + `${Object.values(handRolled).reduce((a, b) => a + b, 0)} hand-rolled control(s).`,
);
