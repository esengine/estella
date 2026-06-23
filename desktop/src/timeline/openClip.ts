// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    openClip.ts
 * @brief   Open an animation clip (.esanim / legacy .estimeline) from disk into
 *          the Sequencer (docs/REARCH_ANIMATION.md P2).
 *
 * Reads the project file, parses it through the unified clip loader (rich
 * multi-track or legacy flipbook), opens it as the editor TimelineDocument bound
 * to the current selection as its preview root, and reveals the Sequencer.
 */

import { parseAnimationClip } from 'esengine';
import { TimelineDocument } from './TimelineDocument';
import { useSequencerStore } from '@/store/sequencerStore';
import { useSelection } from '@/store/selectionStore';
import { dockApi } from '@/layout/dockApi';
import { Toasts } from '@/store/Toasts';

export async function openAnimationClip(path: string): Promise<void> {
  try {
    const text = await window.estella.fs.read(path);
    const asset = parseAnimationClip(JSON.parse(text));
    // Bind the preview to the current selection (if any) so scrubbing animates it.
    const rootEntity = useSelection.getState().selectedId;
    TimelineDocument.open({ asset, filePath: path, rootEntity });
    useSequencerStore.getState().resetForClip();
    dockApi.revealAndExpand('sequencer');
  } catch (e) {
    Toasts.push(`无法打开动画：${String(e)}`, 'error');
  }
}
