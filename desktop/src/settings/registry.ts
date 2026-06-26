// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  registry.ts — the editor settings registry, the declarative sibling of
 *        the command registry (commands/registry.ts). Features and plugins register
 *        sections + settings; the store holds values, SettingsDialog renders from
 *        here. Holds no reactive state — the single source of ids, defaults, and
 *        schema. One place to add a setting; the UI follows automatically.
 */
import type { Setting, SettingsSection, SettingCategory } from './types';

class SettingsRegistry {
  private readonly settings = new Map<string, Setting>();
  private readonly sections = new Map<string, SettingsSection>();

  registerSection(section: SettingsSection): void {
    this.sections.set(section.id, section);
  }

  register(setting: Setting): void {
    this.settings.set(setting.id, setting);
  }

  get(id: string): Setting | undefined {
    return this.settings.get(id);
  }

  all(): Setting[] {
    return [...this.settings.values()];
  }

  getSection(id: string): SettingsSection | undefined {
    return this.sections.get(id);
  }

  allSections(): SettingsSection[] {
    return [...this.sections.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
}

export const settingsRegistry = new SettingsRegistry();
