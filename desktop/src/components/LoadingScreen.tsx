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
        {/* The faceted brand star — the splash's featured moment (see favicon.svg). */}
        <svg className="loadscreen__mark" viewBox="0 0 100 100" aria-hidden="true">
          <path d="M50 50 L42 42 L50 6 L58 42 Z" fill="#4aa6ec" />
          <path d="M50 50 L58 42 L94 50 L58 58 Z" fill="#2f88d6" />
          <path d="M50 50 L58 58 L50 94 L42 58 Z" fill="#1c5988" />
          <path d="M50 50 L42 58 L6 50 L42 42 Z" fill="#2c7cc0" />
          <g stroke="#0a1826" strokeWidth="0.7" strokeLinecap="round" opacity="0.5">
            <line x1="50" y1="50" x2="42" y2="42" />
            <line x1="50" y1="50" x2="58" y2="42" />
            <line x1="50" y1="50" x2="58" y2="58" />
            <line x1="50" y1="50" x2="42" y2="58" />
          </g>
          <path d="M42 42 L50 50 L58 42" fill="none" stroke="#9fd2f7" strokeWidth="0.7" opacity="0.55" />
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
