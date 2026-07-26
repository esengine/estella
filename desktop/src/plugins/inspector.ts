// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  inspector.ts
 * @brief Contributed inspector sections, and the builder that turns a plugin's row
 *        calls into the editor's own `InspectorComponent` shape.
 *
 * The builder exists so the plugin API never exposes `InspectorField` — a 20-case
 * union with presentation, prefab-override, and multi-select semantics that plugins
 * have no business reproducing. A plugin says `ui.number('gain', 'Gain', 0.5)`; the
 * host decides how a number row looks, and the section renders through the SAME
 * ComponentSection every built-in component uses, so it is native by construction
 * rather than by imitation.
 *
 * Section ids are prefixed with the plugin's own id, so two plugins can both add a
 * "Stats" section to Sprite without colliding in the collapse-state store.
 */
import { ContributionRegistry, type Disposable, type Owner } from '@/contrib/ContributionRegistry';
import type { InspectorComponent, InspectorField } from '@/types';
import type {
  AssetInspectorContribution, ComponentInspectorContribution, InspectorContribution,
  InspectorSectionBuilder, LocalizedString,
} from './types';

const contrib = new ContributionRegistry<InspectorContribution>('inspector section');

export const inspectorRegistry = {
  register: (owner: Owner, section: InspectorContribution): Disposable => contrib.register(owner, section),
  disposeOwner: (owner: Owner): void => contrib.disposeOwner(owner),
  all: (): readonly InspectorContribution[] => contrib.all(),
  subscribe: (fn: () => void): (() => void) => contrib.subscribe(fn),
  getRevision: (): number => contrib.getRevision(),

  /** Sections attached to a component type. */
  forComponent(component: string): ComponentInspectorContribution[] {
    return contrib.all().filter((s): s is ComponentInspectorContribution => s.kind === 'component' && s.component === component);
  },

  /** Sections attached to an asset type. */
  forAssetType(assetType: string): AssetInspectorContribution[] {
    return contrib.all().filter((s): s is AssetInspectorContribution => s.kind === 'asset' && s.assetType === assetType);
  },
};

/** Collects builder calls into inspector fields. */
export function createSectionBuilder(localize: (v: LocalizedString) => string): {
  ui: InspectorSectionBuilder;
  fields: InspectorField[];
} {
  const fields: InspectorField[] = [];
  let infoCount = 0;
  const ui: InspectorSectionBuilder = {
    info(label, value) {
      // A read-only row is a string field the write path never routes (no `key` the
      // contribution declared), so it needs a key that cannot collide with a real one.
      fields.push({ key: `__info${infoCount++}`, label: localize(label), type: 'string', value });
    },
    number(key, label, value, opts) {
      fields.push({
        key, label: localize(label), type: 'number', value,
        min: opts?.min, max: opts?.max, step: opts?.step, unit: opts?.unit,
        slider: opts?.min !== undefined && opts?.max !== undefined,
      });
    },
    bool(key, label, value) {
      fields.push({ key, label: localize(label), type: 'bool', value });
    },
    text(key, label, value) {
      fields.push({ key, label: localize(label), type: 'string', value });
    },
    vec2(key, label, value) {
      fields.push({ key, label: localize(label), type: 'vec2', value: [value.x, value.y] });
    },
    color(key, label, value) {
      fields.push({ key, label: localize(label), type: 'color', value });
    },
    select(key, label, value, options) {
      fields.push({ key, label: localize(label), type: 'select', value, selectOptions: [...options] });
    },
  };
  return { ui, fields };
}

/** True for a row produced by `ui.info` — read-only, never written back. */
export const isInfoRow = (key: string): boolean => key.startsWith('__info');

/**
 * Build the `InspectorComponent` for one contributed section. Returns null when the
 * section produced no rows, so an empty section doesn't render as a bare header.
 */
export function buildContributedSection(
  section: InspectorContribution,
  localize: (v: LocalizedString) => string,
  emit: (ui: InspectorSectionBuilder) => void,
): InspectorComponent | null {
  const { ui, fields } = createSectionBuilder(localize);
  emit(ui);
  if (fields.length === 0) return null;
  return { name: section.id, label: localize(section.title), fields };
}
