// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Where a packaging setting is edited — and that it is edited in exactly
 *        one place.
 *
 *        `Setting.platform` puts a target's own values (a WeChat appid, the
 *        desktop channel, Steam's ids) on that target's page in Package Project
 *        and takes them out of the settings window. What is guarded is not that
 *        they render but that there is one editor per value, and it is reachable.
 */
import { describe, it, expect, afterEach } from 'vitest';
import '@/settings';
import { settingsRegistry } from '@/settings/registry';
import { ProjectStore } from '@/project/ProjectStore';
import { BUILTIN_PLATFORMS } from '@/project/platforms';
import { platformLabel, unlabeledBuiltins } from '@/project/platformLabels';
import type { EnumSetting, ObjectListSetting } from '@/settings/types';

/** Every registered setting that claims a packaging target. */
const targetOwned = () => settingsRegistry.all().filter((s) => s.platform);

describe('a packaging setting has one home', () => {
  it('names a target the editor actually offers', () => {
    // A typo reports nothing: the row leaves the settings window AND matches no
    // platform page, so the value becomes uneditable while every manifest-level
    // test still passes. Custom platform ids are open, so the guard is built-ins.
    const known = new Set<string>(BUILTIN_PLATFORMS);
    for (const s of targetOwned()) expect(known.has(s.platform!)).toBe(true);
  });

  it('has a name to be reported under', () => {
    // Settings search names the target a row belongs to. A built-in without a
    // label is reported by its raw id there — and nowhere else, since every other
    // surface builds its own row and would look right.
    expect(unlabeledBuiltins()).toEqual([]);
    for (const s of targetOwned()) expect(platformLabel(s.platform!)).not.toBe(s.platform);
  });

  it('is not also offered by the settings window', () => {
    const inSections = new Set(
      settingsRegistry.allSections().flatMap((sec) => settingsRegistry.settingsForSection(sec.id).map((s) => s.id)),
    );
    for (const s of targetOwned()) expect(inSections.has(s.id)).toBe(false);
  });

  it('leaves no setting with neither home', () => {
    // `section` stays declared on a target-owned row (settings search reports
    // where it lives), so the two queries must partition the registry.
    const sectioned = settingsRegistry.allSections()
      .flatMap((sec) => settingsRegistry.settingsForSection(sec.id));
    const total = sectioned.length + targetOwned().length;
    expect(total).toBe(settingsRegistry.all().length);
  });

  it('puts the desktop channel, Steam and the store ids on their target pages', () => {
    const desktop = settingsRegistry.settingsForPlatform('desktop').map((s) => s.id);
    expect(desktop).toEqual(expect.arrayContaining([
      'project.packaging.desktop.channel',
      'project.packaging.desktop.steam.appId',
      'project.packaging.desktop.steam.sdkPath',
      'project.packaging.desktop.steam.depot.macos',
      'project.packaging.desktop.steam.depot.windows',
      'project.packaging.desktop.steam.depot.linux',
    ]));
    expect(settingsRegistry.settingsForPlatform('wechat').map((s) => s.id))
      .toContain('project.packaging.wechat.appid');
    expect(settingsRegistry.settingsForPlatform('android').map((s) => s.id))
      .toEqual(expect.arrayContaining([
        'project.packaging.android.versionCode',
        'project.packaging.android.output',
        'project.packaging.android.appBundle',
      ]));
  });

  it('keeps the platform-neutral rows in the settings window', () => {
    // One project ships as one application, and every store keeps the same list of
    // achievement ids under a different name — so these answer for the project,
    // not for a target, and a target page is the wrong place to ask.
    for (const id of ['project.packaging.appId', 'project.packaging.icon', 'project.packaging.achievements']) {
      expect(settingsRegistry.get(id)?.platform).toBeUndefined();
    }
    expect(settingsRegistry.settingsForSection('packaging').map((s) => s.id))
      .toEqual(expect.arrayContaining(['project.packaging.appId', 'project.packaging.achievements']));
  });
});

describe('a list whose store normalizes rows away', () => {
  const real = { get: ProjectStore.packagingSettings, set: ProjectStore.setPackaging };
  afterEach(() => {
    ProjectStore.packagingSettings = real.get;
    ProjectStore.setPackaging = real.set;
  });

  it('flags a blank new row, because writing it through loses it', () => {
    // The store drops an id no achievement could match, so a blank row written
    // straight through never comes back and Add looks dead. Holding a row that
    // `rowError` rejects is the rule that pairs with it.
    const s = settingsRegistry.get('project.packaging.achievements') as ObjectListSetting;
    let stored: string[] = [];
    ProjectStore.packagingSettings = () => ({ achievements: stored });
    ProjectStore.setPackaging = (async (p: { achievements?: string[] }) => {
      stored = p.achievements ?? stored;
    }) as typeof ProjectStore.setPackaging;

    const row = s.newRow();
    s.bind!.set([...s.bind!.get(), row]);
    expect(s.bind!.get()).toHaveLength(0);
    expect(s.rowError!(row, [row])).toBeTruthy();

    // Once named it survives the same round trip.
    const named = { id: 'FIRST_BLOOD' };
    expect(s.rowError!(named, [named])).toBeNull();
    s.bind!.set([named]);
    expect(s.bind!.get()).toEqual([{ id: 'FIRST_BLOOD' }]);
  });
});

describe('a target whose destinations branch the nav', () => {
  it('is the desktop channel, and its options are the branches', () => {
    const s = settingsRegistry.get('project.packaging.desktop.channel');
    expect(s?.type === 'enum' && s.navBranch).toBe(true);
    expect((s as EnumSetting).options.map((o) => o.value)).toEqual(['standalone', 'steam']);
  });

  it('is the only one, so the nav has one level of branching', () => {
    // The nav takes the FIRST branch a target declares; a second would be
    // silently ignored rather than shown, so there must not be one.
    for (const p of BUILTIN_PLATFORMS) {
      const branches = settingsRegistry.settingsForPlatform(p)
        .filter((s) => s.type === 'enum' && s.navBranch);
      expect(branches.length).toBeLessThanOrEqual(1);
    }
  });
});

describe('rows that only apply on one answer', () => {
  const visible = (id: string) => settingsRegistry.get(id)!.visibleWhen?.() !== false;
  // The predicates read the live project, so the packaging accessor is stood in
  // for — and put back, since the registry these tests share outlives the block.
  const real = ProjectStore.platformPackaging;
  afterEach(() => { ProjectStore.platformPackaging = real; });

  it('asks for Steam ids only on the Steam channel', () => {
    // Not a styling detail: a depot id on a standalone build is not a blank to
    // fill in, it is a question nobody asked — and showing it is exactly the
    // "every target's answers at once" list this split removes.
    ProjectStore.platformPackaging = () => ({ desktop: { channel: 'standalone' } });
    expect(visible('project.packaging.desktop.steam.appId')).toBe(false);
    expect(visible('project.packaging.desktop.steam.depot.macos')).toBe(false);
    // The channel itself is always the question.
    expect(visible('project.packaging.desktop.channel')).toBe(true);

    ProjectStore.platformPackaging = () => ({ desktop: { channel: 'steam' } });
    expect(visible('project.packaging.desktop.steam.appId')).toBe(true);
    expect(visible('project.packaging.desktop.steam.sdkPath')).toBe(true);
    expect(visible('project.packaging.desktop.steam.depot.linux')).toBe(true);
  });

  it('asks for an App Bundle only when the build produces a package', () => {
    ProjectStore.platformPackaging = () => ({ android: { output: 'project' } });
    expect(visible('project.packaging.android.appBundle')).toBe(false);
    ProjectStore.platformPackaging = () => ({ android: { output: 'package' } });
    expect(visible('project.packaging.android.appBundle')).toBe(true);
    // Absent output means the default, which is a package.
    ProjectStore.platformPackaging = () => ({});
    expect(visible('project.packaging.android.appBundle')).toBe(true);
  });
});
