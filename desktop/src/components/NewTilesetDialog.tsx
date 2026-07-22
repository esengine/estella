// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  NewTilesetDialog — pick the tile grid (size / margin / spacing) when turning a
 *        texture into a `.estileset`, with a live grid overlay on the image, instead of
 *        the old blind 16×16 default that forced you to notice and hand-fix the grid in
 *        the editor. Seeds a good tile-size guess, warns when the sheet isn't evenly
 *        divided, and reports the resulting column/row/tile count. (Tiled's New-Tileset.)
 */
import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { GridField } from '@/components/GridField';
import { colsFor, rowsFor } from '@/tools/tileMath';
import { t } from '@/i18n';

export interface TilesetGrid {
  tileWidth: number;
  tileHeight: number;
  margin: number;
  spacing: number;
  columns: number;
}

/** The largest common tile size that divides both image dimensions evenly — the usual
 *  sheet grid. Falls back to 16 when nothing common divides (an odd or trimmed sheet). */
function guessTileSize(w: number, h: number): number {
  for (const s of [32, 16, 24, 48, 64, 8]) if (w % s === 0 && h % s === 0) return s;
  return 16;
}

const PREVIEW_MAX = 420;

export function NewTilesetDialog({ textureUrl, onCancel, onConfirm }: {
  textureUrl: string;
  onCancel: () => void;
  onConfirm: (grid: TilesetGrid) => void;
}) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [tw, setTw] = useState(16);
  const [th, setTh] = useState(16);
  const [mg, setMg] = useState(0);
  const [sp, setSp] = useState(0);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Seed the tile size from a good guess so the grid usually lands right on open.
  const adopt = (w: number, h: number) => {
    setNat({ w, h });
    const g = guessTileSize(w, h);
    setTw(g);
    setTh(g);
  };
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) adopt(img.naturalWidth, img.naturalHeight);
  }, [textureUrl]);

  const cols = nat ? colsFor(nat.w, tw, mg, sp) : 0;
  const rows = nat ? rowsFor(nat.h, th, mg, sp) : 0;
  const stride = (n: number, tile: number) => (n - mg + sp) % (tile + sp);
  const uneven = nat != null && cols > 0 && rows > 0 && (stride(nat.w, tw) !== 0 || stride(nat.h, th) !== 0);

  const scale = nat ? Math.min(1, PREVIEW_MAX / nat.w, (PREVIEW_MAX * 0.75) / nat.h) : 1;
  const cells: { x: number; y: number }[] = [];
  if (nat && cols > 0 && rows > 0 && cols * rows <= 4096) {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ x: mg + c * (tw + sp), y: mg + r * (th + sp) });
  }

  return (
    <Modal
      title={t('tile.newTilesetTitle')}
      onClose={onCancel}
      width={480}
      footer={(
        <>
          <Button onClick={onCancel}>{t('ui.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!nat}
            onClick={() => onConfirm({ tileWidth: tw, tileHeight: th, margin: mg, spacing: sp, columns: Math.max(1, cols) })}
          >
            {t('tile.newTilesetCreate')}
          </Button>
        </>
      )}
    >
      <div className="nts">
        <div className="nts-preview" style={{ width: (nat?.w ?? 0) * scale, height: (nat?.h ?? 0) * scale }}>
          <img
            ref={imgRef}
            className="nts-img"
            src={textureUrl}
            alt=""
            draggable={false}
            onLoad={(e) => adopt(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
          />
          {nat && cells.length > 0 && (
            <svg className="nts-grid" width={nat.w * scale} height={nat.h * scale} viewBox={`0 0 ${nat.w} ${nat.h}`} preserveAspectRatio="none">
              {cells.map((cell, i) => (
                <rect key={i} x={cell.x} y={cell.y} width={tw} height={th} vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
          )}
        </div>
        <div className="nts-fields">
          <GridField label={t('tile.field.tileW')} value={tw} min={1} onCommit={setTw} />
          <GridField label={t('tile.field.tileH')} value={th} min={1} onCommit={setTh} />
          <GridField label={t('tile.field.margin')} value={mg} onCommit={setMg} />
          <GridField label={t('tile.field.spacing')} value={sp} onCommit={setSp} />
        </div>
        <div className="nts-stat">
          {nat ? t('tile.newTilesetCount', { cols, rows, count: cols * rows }) : t('tile.newTilesetLoading')}
          {uneven && <span className="nts-warn">{t('tile.newTilesetUneven')}</span>}
        </div>
      </div>
    </Modal>
  );
}
