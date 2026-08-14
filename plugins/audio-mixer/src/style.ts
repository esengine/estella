// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  style.ts — the panel's own CSS.
 *
 * Written against the editor's theme VARIABLES, which are in scope inside a
 * contributed panel — not against its class names, which are internal and would
 * silently restyle this the day one of them is renamed.
 */
export const CSS = `
.mixer { display: flex; gap: 8px; padding: 10px; overflow-x: auto; align-items: flex-start; height: 100%; }
.mixer-empty { padding: 16px; color: var(--text-mute); font-size: var(--fs-sm); }
.mixer-strip {
  display: flex; flex-direction: column; gap: 6px;
  min-width: 190px; padding: 8px;
  background: var(--srf-2); border: 1px solid var(--border); border-radius: 6px;
}
.mixer-head { display: flex; align-items: center; gap: 6px; }
.mixer-name { flex: 1; font-size: var(--fs-sm); font-weight: 500; color: var(--text); }
.mixer-row { display: flex; align-items: center; gap: 6px; }
.mixer-row input[type='range'] { flex: 1; min-width: 0; accent-color: var(--acc); }
.mixer-num { width: 26px; text-align: right; font-family: var(--mono); font-size: var(--fs-2xs); color: var(--text-mute); }
.mixer-label { font-size: var(--fs-2xs); color: var(--text-mute); }
.mixer-icon {
  display: grid; place-items: center; width: 22px; height: 22px;
  background: none; border: 0; border-radius: 4px; color: var(--text-mute); cursor: pointer;
}
.mixer-icon:hover { background: var(--srf-3); color: var(--text); }
.mixer-icon.is-on { color: var(--acc); }
.mixer-select {
  background: var(--inset); color: var(--text);
  border: 1px solid var(--border); border-radius: 4px;
  font-size: var(--fs-2xs); padding: 2px 4px; min-width: 0;
}
.mixer-fx {
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
  padding: 4px; background: var(--srf-3); border-radius: 4px;
}
.mixer-num-field { display: flex; align-items: center; gap: 3px; font-size: var(--fs-2xs); color: var(--text-mute); }
.mixer-num-field input {
  width: 52px; background: var(--inset); color: var(--text);
  border: 1px solid var(--border); border-radius: 4px; font-size: var(--fs-2xs); padding: 2px 4px;
}
.mixer-add {
  display: flex; align-items: center; gap: 5px; align-self: stretch;
  padding: 8px 12px; background: none; cursor: pointer;
  border: 1px dashed var(--border); border-radius: 6px;
  color: var(--text-mute); font-size: var(--fs-sm); white-space: nowrap;
}
.mixer-add:hover { color: var(--text); border-color: var(--acc); }
`;
