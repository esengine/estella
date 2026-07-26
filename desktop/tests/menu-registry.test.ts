// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The menu-bar registry MenuBar renders from. The central assertion pins the
 *        exact command order and separator placement the hand-written nested array
 *        used to produce, so deriving the strip is provably behavior-preserving.
 *        Beyond that: rows restate nothing a command already owns, separators are
 *        derived (never dangling), and contributed rows are retractable.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  menuBarMenus, menuItemGroups, registerMenuItem, disposeMenuOwner, menuItemRegistry,
} from '@/layout/menus';
import { commands } from '@/commands';

/** The command ids of a location, with `null` marking each derived separator. */
const layout = (location: string): (string | null)[] =>
  menuItemGroups(location).flatMap((group, i) => [
    ...(i > 0 ? [null] : []),
    ...group.map((item) => item.command ?? item.id),
  ]);

describe('menu registry', () => {
  it('keeps the menu strip in its established order', () => {
    expect(menuBarMenus().map((m) => m.id)).toEqual([
      'file', 'edit', 'entity', 'view', 'build', 'tools', 'window', 'help',
    ]);
  });

  it('reproduces the legacy menu contents, separators included', () => {
    expect(layout('file')).toEqual([
      'scene.new', null, 'project.open', null, 'project.save', 'project.saveAs', null, 'project.close',
    ]);
    expect(layout('edit')).toEqual([
      'edit.undo', 'edit.redo', null,
      'entity.cut', 'entity.copy', 'entity.paste', 'entity.delete', null,
      'edit.selectAll', 'entity.deselect',
    ]);
    expect(layout('entity')).toEqual([
      'entity.add', 'tilemap.new', 'tilemap.newCollisionLayer', null,
      'entity.duplicate', 'entity.delete', null,
      'entity.deselect',
    ]);
    expect(layout('view')).toEqual([
      'view.toggleGrid', 'view.toggleGizmos', 'view.toggleColliders', 'view.toggleTileCollision', 'view.togglePreviewFx', null,
      'view.toggleMinimap', 'view.toggleStats', 'view.toggleCoords', 'view.togglePerf', null,
      'view.toggleCoordSpace', 'view.togglePivotMode', 'view.toggleSnapping',
    ]);
    expect(layout('build')).toEqual(['project.export', null, 'build.scripts', 'project.extractSchemas']);
    // `plugins.open` joined the layout group after the migration — the Plugins panel
    // is opened on demand, so a menu row is how it's reached.
    expect(layout('window')).toEqual(['view.resetLayout', 'plugins.open', null, 'project.close']);
    expect(layout('help')).toEqual([
      'help.about', 'help.checkUpdates', null, 'palette.open', 'help.shortcuts', null, 'help.openLogs',
    ]);
  });

  it('ships the Tools menu empty, so the strip has nothing to render for it', () => {
    // MenuBar drops a menu with no rows — the location exists for contributions,
    // but an empty dropdown must never be openable.
    expect(menuItemGroups('tools')).toEqual([]);
  });

  it('every command row points at a registered command', () => {
    for (const menu of menuBarMenus()) {
      for (const group of menuItemGroups(menu.id)) {
        for (const item of group) {
          if (item.command) {
            expect(commands.get(item.command), `${menu.id}: ${item.command}`).toBeDefined();
          } else {
            expect(item.label, `${menu.id}: ${item.id} needs a label`).toBeDefined();
            expect(item.run, `${menu.id}: ${item.id} needs an action`).toBeDefined();
          }
        }
      }
    }
  });

  it('restates nothing a command already owns, except a deliberate label override', () => {
    const overrides = menuBarMenus()
      .flatMap((m) => menuItemGroups(m.id).flat())
      .filter((i) => i.command && i.label);
    // Back to Launcher is the one row worded differently from its command
    // (Close Project) — everything else must read its label off the command.
    expect(overrides.map((i) => i.id)).toEqual(['window/backToLauncher']);
  });

  it('a contributed row joins a group and is retracted with its owner', () => {
    registerMenuItem({ id: 'acme.bake', location: 'tools', group: 'tools', command: 'edit.undo' }, 'plugin:acme');
    expect(layout('tools')).toEqual(['edit.undo']);

    disposeMenuOwner('plugin:acme');
    expect(menuItemGroups('tools')).toEqual([]);
  });

  it('a contributed row lands after the built-ins of its group', () => {
    registerMenuItem({ id: 'acme.exportPlus', location: 'build', group: 'package', command: 'edit.redo' }, 'plugin:acme');
    expect(layout('build')).toEqual(['project.export', 'edit.redo', null, 'build.scripts', 'project.extractSchemas']);
    disposeMenuOwner('plugin:acme');
  });

  it('a row in an undeclared group renders last rather than vanishing', () => {
    registerMenuItem({ id: 'acme.odd', location: 'build', group: 'not-a-group', command: 'edit.undo' }, 'plugin:acme');
    expect(layout('build')).toEqual([
      'project.export', null, 'build.scripts', 'project.extractSchemas', null, 'edit.undo',
    ]);
    disposeMenuOwner('plugin:acme');
  });

  it('a `when`-gated row leaves no dangling separator', () => {
    let visible = true;
    registerMenuItem(
      { id: 'acme.gated', location: 'tools', group: 'tools', command: 'edit.undo', when: () => visible },
      'plugin:acme',
    );
    expect(layout('tools')).toEqual(['edit.undo']);
    visible = false;
    // The whole group disappears — not an empty group that would emit a separator.
    expect(menuItemGroups('tools')).toEqual([]);
    disposeMenuOwner('plugin:acme');
  });

  it('a contributed row cannot displace a built-in row', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    menuItemRegistry.register('plugin:evil', {
      id: 'file/project.save', location: 'file', group: 'new', command: 'entity.delete',
    });
    expect(layout('file')).toEqual([
      'scene.new', null, 'project.open', null, 'project.save', 'project.saveAs', null, 'project.close',
    ]);
    warn.mockRestore();
  });
});
