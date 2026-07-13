// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  UIWidgetsPanel — the UI-mode widget palette. Drag an item onto the
 *        viewport to place it, or click to add it under the Canvas.
 *
 * Data-driven from the SAME `ENTITY_SOURCES` registry the Create popover uses —
 * there is no parallel widget list, so a new UI source (builtin or user) appears
 * here for free with its registry label + icon.
 */
import { ENTITY_SOURCES, createFromSource, SOURCE_DND_MIME, type EntitySource } from '@/engine/entitySources';
import { t } from '@/i18n';
import { useSelection } from '@/store/selectionStore';

const UI_SOURCES = ENTITY_SOURCES.filter((s) => s.category === 'UI');

export function UIWidgetsPanel() {
  const add = (s: EntitySource) => {
    void createFromSource(s, { parent: null }).then((id) => {
      if (id != null) useSelection.getState().select(id);
    });
  };
  return (
    <div className="ui-palette">
      <div className="ui-palette-hint">{t('uiw.hint')}</div>
      <div className="ui-palette-grid">
        {UI_SOURCES.map((s) => {
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
