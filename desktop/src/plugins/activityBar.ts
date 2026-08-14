// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  activityBar.ts
 * @brief Contributed buttons on the far-left icon rail.
 *
 * The rail's own buttons are written into the component, because the editor's
 * modes and panels are not a set that changes. A plugin's is, so it arrives here
 * and the rail renders both — which is what the audio mixer needed the day it
 * became a plugin and lost the entry point it had shipped with for a year.
 */
import { ContributionRegistry, type Disposable, type Owner } from '@/contrib/ContributionRegistry';

/** A rail button as the component draws it: label localized, glyph already vetted. */
export interface ActivityBarItem {
  id: string;
  title: string;
  /** Inline SVG, or null for the glyph every contributed thing wears. */
  icon: string | null;
  run(): void;
}

const contrib = new ContributionRegistry<ActivityBarItem>('activity bar item');

export const activityBarRegistry = {
  register: (owner: Owner, item: ActivityBarItem): Disposable => contrib.register(owner, item),
  disposeOwner: (owner: Owner): void => contrib.disposeOwner(owner),
  all: (): readonly ActivityBarItem[] => contrib.all(),
  subscribe: (fn: () => void): (() => void) => contrib.subscribe(fn),
};

/**
 * The icon a plugin supplied, or null when it is not an `<svg>` element.
 *
 * A shape check, not a sandbox — a plugin is trusted code in this renderer and
 * reaches the DOM directly anyway. What it buys is a legible failure: a wrong
 * value draws the fallback instead of a stray element in the rail.
 */
export function railIcon(icon: string | undefined): string | null {
  const svg = (icon ?? '').trim();
  return /^<svg[\s>]/i.test(svg) && /<\/svg>$/i.test(svg) ? svg : null;
}
