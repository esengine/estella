// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ZoomControl.tsx
 * @brief   The shared atlas/canvas zoom stepper — − / % / + with an optional fit
 *          button — behind every panel that magnifies a fixed-size surface (the
 *          Tilemap palette, the Tileset editor). One recipe instead of a per-panel
 *          button group vs. range-slider split, so every zoomed view steps, clamps,
 *          and reads out the same way. Buttons reuse {@link IconButton}.
 */
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { IconButton } from './IconButton';
import { t } from '@/i18n';

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

export function ZoomControl({
  zoom,
  min = 0.25,
  max = 8,
  factor = 1.25,
  onZoom,
  onFit,
  fitTitle,
  className,
}: {
  zoom: number;
  min?: number;
  max?: number;
  /** Multiplicative step per − / + press (default 1.25×). */
  factor?: number;
  onZoom: (z: number) => void;
  /** Fit-to-view handler; omit to hide the fit button. */
  onFit?: () => void;
  /** Override the fit button's tooltip (default "Fit to view"). */
  fitTitle?: string;
  className?: string;
}) {
  return (
    <span className={`zoomctl${className ? ` ${className}` : ''}`}>
      <IconButton size="sm" title={t('ui.zoomOut')} disabled={zoom <= min} onClick={() => onZoom(clamp(zoom / factor, min, max))}>
        <ZoomOut size={13} />
      </IconButton>
      <span className="zoomctl-pct">{Math.round(zoom * 100)}%</span>
      <IconButton size="sm" title={t('ui.zoomIn')} disabled={zoom >= max} onClick={() => onZoom(clamp(zoom * factor, min, max))}>
        <ZoomIn size={13} />
      </IconButton>
      {onFit && (
        <IconButton size="sm" title={fitTitle ?? t('ui.zoomFit')} onClick={onFit}>
          <Maximize2 size={13} />
        </IconButton>
      )}
    </span>
  );
}
