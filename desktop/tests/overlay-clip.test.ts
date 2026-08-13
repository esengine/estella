// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A parked drawer must not be somewhere the page can scroll to.
 *
 * Reported as "closing the agent shifts the whole editor left". A shut drawer is
 * still in the layout, parked off the edge by `translateX(100%)` — 384px of
 * horizontal overflow for as long as it is shut, which is nearly always, and the
 * bottom one 379px of vertical. `overflow: hidden` is not the fix and was not
 * the state: hidden merely removes the scrollbar and can still be scrolled BY
 * CODE, which is what the focus handed back on close did — sliding the editor
 * sideways with no scrollbar left to slide it back.
 *
 * Asserted against the stylesheet because the rule IS the fix, and nothing else
 * in the suite renders a DOM to catch it going away.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROME_CSS = readFileSync(path.join(HERE, '..', 'src', 'theme', 'chrome.css'), 'utf8');

/** The `.scrim { ... }` block — the drawers' own container. */
function scrimBlock(): string {
  const at = CHROME_CSS.search(/^\.scrim\s*\{/m);
  expect(at, '.scrim has no rule in chrome.css').toBeGreaterThanOrEqual(0);
  return CHROME_CSS.slice(at, CHROME_CSS.indexOf('}', at));
}

describe('the drawer container clips what it parks', () => {
  it('clips, so a shut drawer adds no overflow to the page', () => {
    expect(scrimBlock()).toMatch(/overflow:\s*clip\b/);
  });

  // `hidden` looks like it works — the scrollbar goes — and leaves the failure
  // fully intact, because a hidden box is still programmatically scrollable.
  it('does not settle for hidden, which code can still scroll', () => {
    expect(scrimBlock()).not.toMatch(/overflow:\s*hidden\b/);
  });

  // Both drawers park off an edge; clipping one axis leaves the other's 379px.
  it('parks both drawers outside the box it clips', () => {
    expect(CHROME_CSS).toMatch(/scrim--bottom.*\{[^}]*transform:\s*translateY\(100%\)/s);
    expect(CHROME_CSS).toMatch(/scrim--right.*\{[^}]*transform:\s*translateX\(100%\)/s);
  });
});
