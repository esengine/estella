// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  registry.ts — the editor settings registry, the declarative sibling of
 *        the command registry (commands/registry.ts). Features and plugins register
 *        sections + settings; the store holds values, SettingsDialog renders from
 *        here. Holds no reactive state — the single source of ids, defaults, and
 *        schema. One place to add a setting; the UI follows automatically.
 *
 * Both sets live in a ContributionRegistry, so a plugin's sections + settings are
 * owned and retractable as a group (the `plugin` nav category is where they land).
 */
import type { Setting, SettingsSection, SettingCategory } from './types';
import { ContributionRegistry, type Disposable, type Owner } from '@/contrib/ContributionRegistry';

class SettingsRegistry {
  private readonly settings = new ContributionRegistry<Setting>('setting');
  private readonly sections = new ContributionRegistry<SettingsSection>('settings section');

  registerSection(section: SettingsSection, owner: Owner = 'core'): Disposable {
    return this.sections.register(owner, section);
  }

  register(setting: Setting, owner: Owner = 'core'): Disposable {
    return this.settings.register(owner, setting);
  }

  get(id: string): Setting | undefined {
    return this.settings.get(id);
  }

  all(): Setting[] {
    return [...this.settings.all()];
  }

  getSection(id: string): SettingsSection | undefined {
    return this.sections.get(id);
  }

  allSections(): SettingsSection[] {
    // Stable sort: ties keep registration order (core before plugins).
    return [...this.sections.all()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  /** Sections grouped by nav category, in declared order. */
  sectionsByCategory(): { category: SettingCategory; sections: SettingsSection[] }[] {
    const order: SettingCategory[] = ['editor', 'project', 'plugin'];
    return order
      .map((category) => ({
        category,
        sections: this.allSections().filter((s) => s.category === category),
      }))
      .filter((g) => g.sections.length > 0);
  }

  /** Settings in a section, in declared registration order. */
  settingsForSection(sectionId: string): Setting[] {
    return this.all().filter((s) => s.section === sectionId);
  }

  /** Retract every section + setting of one owner (plugin unload / disable). */
  disposeOwner(owner: Owner): void {
    this.settings.disposeOwner(owner);
    this.sections.disposeOwner(owner);
  }

  /** Subscribe to either set changing — the dialog re-derives its nav from it. */
  subscribe(fn: () => void): () => void {
    const offSettings = this.settings.subscribe(fn);
    const offSections = this.sections.subscribe(fn);
    return () => {
      offSettings();
      offSections();
    };
  }

  /** Snapshot of both sets' identity, for useSyncExternalStore. */
  getRevision(): number {
    return this.settings.getRevision() + this.sections.getRevision();
  }
}

export const settingsRegistry = new SettingsRegistry();
