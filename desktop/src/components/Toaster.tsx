// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { t } from '@/i18n';
import { Toasts } from '@/store/Toasts';

// Transient action feedback, stacked bottom-right over the editor shell.
export function Toaster() {
  const toasts = useSyncExternalStore(Toasts.subscribe, Toasts.getSnapshot);
  if (toasts.length === 0) return null;
  return (
    <div className="toaster">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind}`} role="status">
          <span className="toast__msg">{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                toast.action?.run();
                Toasts.dismiss(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button
            type="button"
            className="toast__close"
            aria-label={t('ui.dismiss')}
            onClick={() => Toasts.dismiss(toast.id)}
          >
            <X size={12} strokeWidth={2.2} />
          </button>
        </div>
      ))}
    </div>
  );
}
