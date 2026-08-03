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
                if (!toast.action?.keepOpen) Toasts.dismiss(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          )}
          {!toast.pinned && (
            <button
              type="button"
              className="toast__close"
              aria-label={t('ui.dismiss')}
              onClick={() => Toasts.dismiss(toast.id)}
            >
              <X size={12} strokeWidth={2.2} />
            </button>
          )}
          {toast.progress !== undefined && (
            <div
              className={`toast__bar${toast.progress === 'indeterminate' ? ' toast__bar--waiting' : ''}`}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={toast.progress === 'indeterminate' ? undefined : toast.progress}
            >
              <span
                className="toast__bar-fill"
                style={toast.progress === 'indeterminate' ? undefined : { width: `${toast.progress}%` }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
