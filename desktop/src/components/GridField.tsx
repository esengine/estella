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
  className?: string;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(props.value));
  useEffect(() => setText(String(props.value)), [props.value]);
  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n) && n !== props.value) props.onCommit(Math.max(props.min ?? 0, Math.floor(n)));
    else setText(String(props.value));
  };
  return (
    <label className={props.className ?? 'ts-field'}>
      <span>{props.label}</span>
      <input
        type="number" value={text} min={props.min ?? 0}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
    </label>
  );
}
