// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  TilemapPickerDialog.tsx — the "New Tilemap" tileset chooser.
 *        Opened by the `tilemap.new` command when the project has more than one
 *        `.estileset` (one → created directly, none → guided by a toast). Pick a
 *        tileset and `createTilemapFromTileset` does the full wiring (spawn the
 *        TilemapLayer entity, seed cellSize, live-sync the tileset, open the
 *        painter). A store-flag dialog like BuildDialog / SettingsDialog.
 */
import { useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { SearchField } from '@/components/SearchField';
import { ProjectStore } from '@/project/ProjectStore';
import { useEditorStore } from '@/store/editorStore';
import { createTilemapFromTileset } from '@/tilemap/createTilemap';
import { t } from '@/i18n';

export function TilemapPickerDialog() {
  const close = () => useEditorStore.getState().setTilemapPickerOpen(false);
  const [q, setQ] = useState('');
  const tilesets = ProjectStore.listAssets('tileset');
  const needle = q.trim().toLowerCase();
  const shown = needle ? tilesets.filter((t) => t.name.toLowerCase().includes(needle)) : tilesets;

  const choose = (ref: string) => {
    const path = ProjectStore.assetInfo(ref)?.path;
    close();
    if (path) void createTilemapFromTileset(path);
  };

  return (
    <Modal title={t('cmd.tilemap.new')} onClose={close} width={440}>
      <div className="tmpick">
        <p className="tmpick__hint">{t('tile.pick.hint')}</p>
        <SearchField className="tmpick__search" autoFocus placeholder={t('tile.pick.search')} value={q} onChange={setQ} />
        {shown.length === 0 ? (
          <div className="empty-line">{t('tile.pick.noMatch')}</div>
        ) : (
          <div className="tmpick__list">
            {shown.map((t) => (
              <button key={t.ref} type="button" className="tmpick__item" onClick={() => choose(t.ref)}>
                <LayoutGrid size={15} className="tmpick__icon" />
                <span className="tmpick__name">{t.name.replace(/\.estileset$/, '')}</span>
                <span className="tmpick__path">{t.path}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
