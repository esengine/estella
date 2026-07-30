// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    GridField.tsx
 * @brief   A grid-geometry number field that commits on blur/Enter (one undo
 *          step per edit) — shared by the Tileset and Flipbook editors.
 */
import { useEffect, useState } from 'react';

export function GridField(props: {
  label: string;
  value: number;
  min?: number;
  /** Upper clamp; grid geometry has none, a normalized anchor has 1. */
  max?: number;
  /** Decimals to keep. Omitted = the integer pixel grid this field started as. */
  decimals?: number;
  className?: string;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(props.value));
  useEffect(() => setText(String(props.value)), [props.value]);
  const commit = () => {
    const n = Number(text);
    if (!Number.isFinite(n) || n === props.value) {
      setText(String(props.value));
      return;
    }
    const q = props.decimals === undefined ? Math.floor(n) : Number(n.toFixed(props.decimals));
    props.onCommit(Math.min(props.max ?? Infinity, Math.max(props.min ?? 0, q)));
  };
  return (
    <label className={props.className ?? 'ts-field'}>
      <span>{props.label}</span>
      <input
        type="number" value={text} min={props.min ?? 0} max={props.max}
        step={props.decimals === undefined ? 1 : 10 ** -props.decimals}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
    </label>
  );
}
