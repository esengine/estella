// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  menus.ts
 * @brief THE authority for the menu bar — which menus exist and what sits in each.
 *        MenuBar renders from here, so adding a menu entry is one registration
 *        instead of an edit to a hand-written nested array.
 *
 * An entry is normally just a COMMAND REFERENCE: the command registry already owns
 * its label, shortcut hint, enablement, and checked state, so a menu row restates
 * none of it (the old array called cmdItem(id) for exactly this reason). `label` +
 * `run` exist for the rare row with no command behind it.
 *
 * Separators are derived, never authored: items carry a `group`, groups render in
 * the order declared by their menu's `groups` list, and a separator goes between
 * adjacent non-empty groups. That way a gated or contributed item can never leave a
 * dangling separator or two in a row.
 *
 * Kept free of React and of the command registry itself — MenuBar joins the two, so
 * this module stays a leaf that anything can consult.
 */
import { t } from '@/i18n';
import { ContributionRegistry, type Disposable, type Owner } from '@/contrib/ContributionRegistry';

/**
 * A menu-bar menu id, or (later) a context-menu location such as `outliner/item`.
 * Open by design: context menus join this registry once they carry a target.
 */
export type MenuLocation = string;

export interface MenuBarMenu {
  id: MenuLocation;
  title: () => string;
  /** Left-to-right position in the strip. */
  order: number;
  /** Group ids in render order; a separator falls between adjacent non-empty ones. */
  groups: string[];
}

export interface MenuContribution {
  /** Unique within the registry — a command row uses the command id. */
  id: string;
  location: MenuLocation;
  /** Which of the menu's `groups` this row belongs to (unknown ⇒ renders last). */
  group: string;
  /** Position within the group; ties fall back to registration order. */
  order?: number;
  /** Command id — its label, shortcut, enablement and checked state drive the row. */
  command?: string;
  /** Overrides the command's label (same action, menu-specific wording); the only
   *  thing a row may restate. Required for a row with no `command`. */
  label?: () => string;
  /** Action for a row with no command behind it. */
  run?: () => void;
  /** Hide the row entirely when this returns false (distinct from disabled). */
  when?: () => boolean;
}

const MENUS: MenuBarMenu[] = [
  { id: 'file', title: () => t('menu.file'), order: 10, groups: ['new', 'open', 'save', 'close'] },
  { id: 'edit', title: () => t('menu.edit'), order: 20, groups: ['history', 'clipboard', 'selection'] },
  { id: 'entity', title: () => t('menu.entity'), order: 30, groups: ['create', 'modify', 'selection'] },
  { id: 'view', title: () => t('menu.view'), order: 40, groups: ['show', 'overlays', 'gizmo'] },
  { id: 'build', title: () => t('menu.build'), order: 50, groups: ['package', 'scripts'] },
  // Where contributed commands land by default. Rendered only once something is in
  // it — an empty dropdown is broken UI, so the strip hides a menu with no rows.
  { id: 'tools', title: () => t('menu.tools'), order: 60, groups: ['tools'] },
  { id: 'window', title: () => t('menu.window'), order: 70, groups: ['layout', 'navigate'] },
  { id: 'help', title: () => t('menu.help'), order: 80, groups: ['about', 'help', 'diagnostics'] },
];

/** A command row, spelled as compactly as the old `cmdItem(id)` call it replaces. */
const cmd = (location: MenuLocation, group: string, command: string): MenuContribution => ({
  id: `${location}/${command}`,
  location,
  group,
  command,
});

const BUILTIN_ITEMS: MenuContribution[] = [
  cmd('file', 'new', 'scene.new'),
  cmd('file', 'open', 'project.open'),
  cmd('file', 'save', 'project.save'),
  cmd('file', 'save', 'project.saveAs'),
  cmd('file', 'close', 'project.close'),

  cmd('edit', 'history', 'edit.undo'),
  cmd('edit', 'history', 'edit.redo'),
  cmd('edit', 'clipboard', 'entity.cut'),
  cmd('edit', 'clipboard', 'entity.copy'),
  cmd('edit', 'clipboard', 'entity.paste'),
  cmd('edit', 'clipboard', 'entity.delete'),
  cmd('edit', 'selection', 'edit.selectAll'),
  cmd('edit', 'selection', 'entity.deselect'),

  cmd('entity', 'create', 'entity.add'),
  cmd('entity', 'create', 'tilemap.new'),
  cmd('entity', 'create', 'tilemap.newCollisionLayer'),
  cmd('entity', 'modify', 'entity.duplicate'),
  cmd('entity', 'modify', 'entity.delete'),
  cmd('entity', 'selection', 'entity.deselect'),

  cmd('view', 'show', 'view.toggleGrid'),
  cmd('view', 'show', 'view.toggleGizmos'),
  cmd('view', 'show', 'view.toggleColliders'),
  cmd('view', 'show', 'view.toggleTileCollision'),
  cmd('view', 'show', 'view.togglePreviewFx'),
  cmd('view', 'overlays', 'view.toggleMinimap'),
  cmd('view', 'overlays', 'view.toggleStats'),
  cmd('view', 'overlays', 'view.toggleCoords'),
  cmd('view', 'overlays', 'view.togglePerf'),
  cmd('view', 'gizmo', 'view.toggleCoordSpace'),
  cmd('view', 'gizmo', 'view.togglePivotMode'),
  cmd('view', 'gizmo', 'view.toggleSnapping'),

  cmd('build', 'package', 'project.export'),
  cmd('build', 'scripts', 'build.scripts'),
  cmd('build', 'scripts', 'project.extractSchemas'),

  // Resets only the dock layout, rebuilt in place (keeps scene/engine/undo), and
  // guarded so a wedged dirty asset-editor tab can't vanish unwarned.
  cmd('window', 'layout', 'agent.open'),
  cmd('window', 'layout', 'view.resetLayout'),
  cmd('window', 'layout', 'plugins.open'),
  {
    // The same guarded command as File ▸ Close Project, worded for where it leads —
    // never a second exit path that could skip the unsaved-changes prompt.
    ...cmd('window', 'navigate', 'project.close'),
    id: 'window/backToLauncher',
    label: () => t('menu.backToLauncher'),
  },

  cmd('help', 'about', 'help.about'),
  cmd('help', 'about', 'help.checkUpdates'),
  cmd('help', 'help', 'palette.open'),
  cmd('help', 'help', 'help.shortcuts'),
  cmd('help', 'diagnostics', 'help.openLogs'),
];

const menuContrib = new ContributionRegistry<MenuBarMenu>('menu');
const itemContrib = new ContributionRegistry<MenuContribution>('menu item');
menuContrib.registerAll('core', MENUS);
itemContrib.registerAll('core', BUILTIN_ITEMS);

export const menuRegistry = menuContrib;
export const menuItemRegistry = itemContrib;

export function registerMenu(menu: MenuBarMenu, owner: Owner = 'core'): Disposable {
  return menuContrib.register(owner, menu);
}

export function registerMenuItem(item: MenuContribution, owner: Owner = 'core'): Disposable {
  return itemContrib.register(owner, item);
}

/** Menu-bar menus in strip order. */
export function menuBarMenus(): MenuBarMenu[] {
  return [...menuContrib.all()].sort((a, b) => a.order - b.order);
}

/**
 * Items of one location, grouped and ordered for rendering: an array of non-empty
 * groups, each an array of items. `when`-gated rows are already dropped, so the
 * caller inserts one separator between consecutive returned groups and nothing else.
 * Groups the menu doesn't declare render last, in registration order.
 */
export function menuItemGroups(location: MenuLocation): MenuContribution[][] {
  const declared = menuContrib.get(location)?.groups ?? [];
  const visible = itemContrib.all().filter((i) => i.location === location && (i.when?.() ?? true));
  const rank = (group: string) => {
    const i = declared.indexOf(group);
    return i === -1 ? declared.length : i;
  };
  const byGroup = new Map<string, MenuContribution[]>();
  for (const item of visible) {
    const list = byGroup.get(item.group);
    if (list) list.push(item);
    else byGroup.set(item.group, [item]);
  }
  return [...byGroup.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([, items]) => [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
}

/** Retract every menu + item of one owner (plugin unload / disable). */
export function disposeMenuOwner(owner: Owner): void {
  itemContrib.disposeOwner(owner);
  menuContrib.disposeOwner(owner);
}
