// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Export progress events. The export pipelines emit a `phase` per major
 *        step so the Package Project dialog can show a live build log (UE-style)
 *        instead of a single spinner line. The IPC handler forwards these to the
 *        renderer over `project:exportProgress`.
 */
export interface ExportProgress {
  /** Human label of the current step (shown in the build log). */
  phase: string;
  /** Optional detail — a count, a path, a size. */
  detail?: string;
}

export type OnExportProgress = (p: ExportProgress) => void;
