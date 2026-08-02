// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AgentMark.tsx
 * @brief   The agent's mark: four facets around a centre.
 *
 * The ONE shape that means "the agent" — the drawer head, the empty state and
 * the status bar all wear it, so the same mark means the same thing wherever it
 * turns up. `live` lights the facets in turn, which is the thing a spinner in
 * the transcript cannot do: say that work is still happening from across the
 * window, with the drawer closed.
 *
 * Drawn in the editor's own violet (--nebula) rather than a palette of its own,
 * the same accent the Outliner dot and the viewport echo already use for "the
 * agent touched this".
 */
export function AgentMark({ size = 14, live, className }: {
  size?: number;
  live?: boolean;
  className?: string;
}) {
  return (
    <svg
      className={`ag-mark${live ? ' live' : ''}${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path className="ag-p-n" d="M12 1.6 13.55 10.6 12 12 10.45 10.6Z" />
      <path className="ag-p-e" d="M22.4 12 13.4 13.55 12 12 13.4 10.45Z" />
      <path className="ag-p-s" d="M12 22.4 10.45 13.4 12 12 13.55 13.4Z" />
      <path className="ag-p-w" d="M1.6 12 10.6 10.45 12 12 10.6 13.55Z" />
    </svg>
  );
}
