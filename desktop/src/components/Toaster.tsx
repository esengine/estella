// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { Toasts } from '@/store/Toasts';

// Transient action feedback, stacked bottom-right over the editor shell.
export function Toaster() {
  const toasts = useSyncExternalStore(Toasts.subscribe, Toasts.getSnapshot);
  if (toasts.length === 0) return null;
  return (
    <div className="toaster">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`} role="status">
          <span className="toast__msg">{t.message}</span>
          <button
            type="button"
            className="toast__close"
            aria-label="Dismiss"
            onClick={() => Toasts.dismiss(t.id)}
          >
            <X size={12} strokeWidth={2.2} />
          </button>
        </div>
      ))}
    </div>
  );
}
