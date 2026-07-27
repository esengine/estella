// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    externalPrograms.ts
 * @brief   Which outside program opens which kind of file. The editor has no
 *          script editor and no image editor and should not grow one — but a
 *          double-click has to do SOMETHING, so the answer is a program the user
 *          already has, named once in Settings.
 *
 *          A slot is registered, not hard-coded, for the reason every other table
 *          here is a registry: a contributed asset type must be able to say "open
 *          me the way scripts are opened" — or to bring its own slot — without the
 *          settings UI knowing it exists. Registering a slot registers its setting
 *          in the same call and retracts both together, so a slot without a
 *          setting, or a setting nobody reads, cannot happen.
 *
 *          The value is editor-scoped on purpose. `C:\...\Code.exe` is true of one
 *          machine; in project settings it would be committed and then be wrong for
 *          everyone else who opened the project.
 */
import { settingsRegistry } from '@/settings/registry';
import { ContributionRegistry, type Disposable, type Owner } from '@/contrib/ContributionRegistry';
import { useSettings } from '@/store/settingsStore';
import { t } from '@/i18n';

export interface ExternalProgram {
  /** Stable slot id, referenced by AssetTypeDef.externalProgram. */
  id: string;
  label: string;
  description?: string;
  /** Offer detected code editors for this slot (only source has a catalog). */
  detect?: boolean;
  /** Push the value somewhere on change + on hydrate (see the browser slot). */
  effect?: (program: string) => void;
}

/** The setting id a slot's configured path is stored under. */
export const programSettingId = (id: string): string => `externalTools.${id}`;

class ExternalProgramRegistry {
  private readonly programs = new ContributionRegistry<ExternalProgram>('external program');

  /** Register a slot and the setting that fills it. Disposing retracts both. */
  register(program: ExternalProgram, owner: Owner = 'core'): Disposable {
    const slot = this.programs.register(owner, program);
    const setting = settingsRegistry.register(
      {
        id: programSettingId(program.id),
        type: 'path',
        scope: 'editor',
        section: 'externalTools',
        label: program.label,
        description: program.description,
        default: '',
        placeholder: t('set.externalTools.placeholder'),
        pickTitle: program.label,
        detect: program.detect,
        effect: program.effect,
      },
      owner,
    );
    return {
      dispose: () => {
        slot.dispose();
        setting.dispose();
      },
    };
  }

  get(id: string): ExternalProgram | undefined {
    return this.programs.get(id);
  }

  all(): ExternalProgram[] {
    return [...this.programs.all()];
  }

  /** The configured path for a slot, or '' when the user has named none. */
  pathFor(id: string): string {
    return useSettings.getState().getValue<string>(programSettingId(id)) ?? '';
  }
}

export const externalPrograms = new ExternalProgramRegistry();

// ── The built-in slots ──────────────────────────────────────────────────────
// Three, because three is what the editor genuinely cannot do itself. Anything
// with an editor of its own (scenes, materials, tilemaps) never reaches here.
externalPrograms.register({
  id: 'script',
  label: t('set.externalTools.script'),
  description: t('set.externalTools.script.desc'),
  detect: true,
});
externalPrograms.register({
  id: 'image',
  label: t('set.externalTools.image'),
  description: t('set.externalTools.image.desc'),
});
// The browser is the one slot the renderer does not use itself: main opens urls
// while reacting to a window.open or finishing an export preview, so it needs its
// own copy of the value rather than a call site to read it.
externalPrograms.register({
  id: 'browser',
  label: t('set.externalTools.browser'),
  description: t('set.externalTools.browser.desc'),
  effect: (program) => window.estella?.shell?.setBrowser?.(program),
});
