// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useSyncExternalStore } from 'react';
import { LoadGate } from '@/store/loadGate';

// Full-screen project-open loading overlay (Unreal-style): shown over the mounting
// editor while prewarm tasks run, so the editor and the first Play are both warm
// once it clears. Task labels are supplied by the orchestrator (already localized).
export function LoadingScreen() {
  const { active, tasks } = useSyncExternalStore(LoadGate.subscribe, LoadGate.getSnapshot);
  if (!active) return null;
  return (
    <div className="loadscreen" role="status" aria-live="polite">
      <div className="loadscreen__panel">
        <svg className="loadscreen__mark" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z" />
        </svg>
        <div className="loadscreen__tasks">
          {tasks.map((task) => (
            <div key={task.key} className={`loadscreen__task${task.done ? ' is-done' : ''}`}>
              <span className="loadscreen__spinner" aria-hidden="true" />
              <span className="loadscreen__label">{task.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
