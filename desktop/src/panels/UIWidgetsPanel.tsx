// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  UIWidgetsPanel — the UI-mode widget palette. Drag an item onto the
 *        viewport to place it, or click to add it under the Canvas.
 *
 * Data-driven from the SAME entity-template registry the Create popover uses —
 * there is no parallel widget list, so a new UI source (builtin, user, or
 * contributed) appears here for free with its registry label + icon.
 */
import { useSyncExternalStore } from 'react';
import { entitySources, entitySourceRegistry, createFromSource, SOURCE_DND_MIME, type EntitySource } from '@/engine/entitySources';
import { t } from '@/i18n';
import { useSelection } from '@/store/selectionStore';

export function UIWidgetsPanel() {
  // Read through the registry (not a module-load snapshot) so a contributed UI
  // template appears in the palette without a reload.
  const sources = useSyncExternalStore(entitySourceRegistry.subscribe.bind(entitySourceRegistry), entitySources);
  const uiSources = sources.filter((s) => s.category === 'UI');
  // A clicked widget passes no drop point, so createFromSource centres it in the Canvas
  // (the shared UI-placement path also handles the viewport drop's drop-point landing).
  const add = (s: EntitySource) => {
    void createFromSource(s, { parent: null }).then((id) => {
      if (id != null) useSelection.getState().select(id);
    });
  };
  return (
    <div className="ui-palette">
      <div className="ui-palette-hint">{t('uiw.hint')}</div>
      <div className="ui-palette-grid">
        {uiSources.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              type="button"
              className="ui-palette-item"
              draggable
              title={s.label}
              onDragStart={(e) => {
                e.dataTransfer.setData(SOURCE_DND_MIME, s.id);
                e.dataTransfer.setData('text/plain', s.label);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => add(s)}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span className="ui-palette-label">{s.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
