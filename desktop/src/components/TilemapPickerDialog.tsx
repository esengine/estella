// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  TilemapPickerDialog.tsx — the "New Tilemap" tileset + orientation chooser.
 *        Opened by the `tilemap.new` command when the project has more than one
 *        `.estileset` (one → created directly orthogonal, none → guided by a toast).
 *        Pick an orientation (orthogonal / isometric / staggered / hexagonal, with
 *        stagger axis+index and hex side length when relevant) and a tileset;
 *        `createTilemapFromTileset` does the full wiring (spawn the TilemapLayer,
 *        seed cellSize + grid, live-sync the tileset, open the painter).
 */
import { useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { SearchField } from '@/components/SearchField';
import { Segmented } from '@/components/Segmented';
import { ProjectStore } from '@/project/ProjectStore';
import { useEditorStore } from '@/store/editorStore';
import { createTilemapFromTileset } from '@/tilemap/createTilemap';
import {
  TileOrientation, usesStagger, isHexOrientation,
  orientationOptions, staggerAxisOptions, staggerIndexOptions,
} from '@/tilemap/tileOrientation';
import type { TileGridConfig } from '@/engine/entitySources';
import { t } from '@/i18n';

export function TilemapPickerDialog() {
  const close = () => useEditorStore.getState().setTilemapPickerOpen(false);
  const [q, setQ] = useState('');
  const [orientation, setOrientation] = useState<number>(TileOrientation.Orthogonal);
  const [staggerAxis, setStaggerAxis] = useState(0);
  const [staggerIndex, setStaggerIndex] = useState(0);
  const [hexSide, setHexSide] = useState('');

  const tilesets = ProjectStore.listAssets('tileset');
  const needle = q.trim().toLowerCase();
  const shown = needle ? tilesets.filter((ts) => ts.name.toLowerCase().includes(needle)) : tilesets;

  const stagger = usesStagger(orientation);
  const hex = isHexOrientation(orientation);

  const choose = (ref: string) => {
    const path = ProjectStore.assetInfo(ref)?.path;
    close();
    if (!path) return;
    const grid: TileGridConfig = { orientation };
    if (stagger) { grid.staggerAxis = staggerAxis; grid.staggerIndex = staggerIndex; }
    if (hex) { const s = Number(hexSide); if (Number.isFinite(s) && s > 0) grid.hexSideLength = s; }
    void createTilemapFromTileset(path, grid);
  };

  return (
    <Modal title={t('cmd.tilemap.new')} onClose={close} width={440}>
      <div className="tmpick">
        <p className="tmpick__hint">{t('tile.pick.hint')}</p>

        <div className="tmpick__orient">
          <label className="tmpick__flabel">{t('tile.orient.label')}</label>
          <Segmented
            grow
            ariaLabel={t('tile.orient.label')}
            value={String(orientation)}
            options={orientationOptions()}
            onChange={(v) => setOrientation(Number(v))}
          />
          {stagger && (
            <div className="tmpick__grid2">
              <label className="tmpick__flabel">{t('tile.orient.staggerAxis')}</label>
              <Segmented grow value={String(staggerAxis)} options={staggerAxisOptions()} onChange={(v) => setStaggerAxis(Number(v))} />
              <label className="tmpick__flabel">{t('tile.orient.staggerIndex')}</label>
              <Segmented grow value={String(staggerIndex)} options={staggerIndexOptions()} onChange={(v) => setStaggerIndex(Number(v))} />
            </div>
          )}
          {hex && (
            <div className="tmpick__row">
              <label className="tmpick__flabel">{t('tile.orient.hexSide')}</label>
              <input
                className="field tmpick__num"
                type="number"
                min={0}
                step={1}
                placeholder="auto"
                value={hexSide}
                onChange={(e) => setHexSide(e.target.value)}
              />
            </div>
          )}
        </div>

        <SearchField className="tmpick__search" autoFocus placeholder={t('tile.pick.search')} value={q} onChange={setQ} />
        {shown.length === 0 ? (
          <div className="empty-line">{t('tile.pick.noMatch')}</div>
        ) : (
          <div className="tmpick__list">
            {shown.map((ts) => (
              <button key={ts.ref} type="button" className="tmpick__item" onClick={() => choose(ts.ref)}>
                <LayoutGrid size={15} className="tmpick__icon" />
                <span className="tmpick__name">{ts.name.replace(/\.estileset$/, '')}</span>
                <span className="tmpick__path">{ts.path}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
