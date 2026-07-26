// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  contextMenus.ts
 * @brief Contributed right-click rows, kept separate from the menu-BAR registry
 *        because they answer a different question: a menu-bar row is a command that
 *        is always there, while a context row is evaluated against a TARGET (the
 *        entity or asset that was clicked) each time the menu opens.
 *
 * That target is why these can't just be command references — `when(target)` and
 * `run(target)` need the click's subject, which a command id cannot carry.
 */
import { ContributionRegistry, type Disposable, type Owner } from '@/contrib/ContributionRegistry';
import { localizePlugin } from './localize';
import type { MenuItem } from '@/components/Menu';
import type { ContextMenuContribution, ContextMenuLocation, ContextMenuTarget } from './types';

const contrib = new ContributionRegistry<ContextMenuContribution>('context menu item');

export const contextMenuRegistry = {
  register: (owner: Owner, item: ContextMenuContribution): Disposable => contrib.register(owner, item),
  disposeOwner: (owner: Owner): void => contrib.disposeOwner(owner),
  all: (): readonly ContextMenuContribution[] => contrib.all(),

  /** Rows for a location that apply to `target`, in registration order. */
  forTarget(location: ContextMenuLocation, target: ContextMenuTarget): ContextMenuContribution[] {
    return contrib.all().filter((i) => i.location === location && (i.when?.(target) ?? true));
  },
};

/**
 * Contributed rows as menu items, with a leading separator when there are any — so a
 * host menu appends ONE spread and gets correct grouping whether or not a plugin is
 * loaded (and no dangling separator when none is).
 */
export function contributedContextRows(location: ContextMenuLocation, target: ContextMenuTarget): MenuItem[] {
  const rows = contextMenuRegistry.forTarget(location, target);
  if (rows.length === 0) return [];
  return [
    { sep: true },
    ...rows.map((row) => ({ label: localizePlugin(row.label), onClick: () => row.run(target) })),
  ];
}
