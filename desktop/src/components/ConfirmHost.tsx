// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ConfirmHost.tsx — renders the ConfirmService queue's front request as
 *        a ConfirmDialog. Mounted once in the editor shell (next to Toaster);
 *        queued requests show one at a time in arrival order.
 */
import { useSyncExternalStore } from 'react';
import { t } from '@/i18n';
import { ConfirmService } from './confirm';
import { ConfirmDialog } from './ConfirmDialog';

export function ConfirmHost() {
  const queue = useSyncExternalStore(ConfirmService.subscribe, ConfirmService.getSnapshot);
  const cur = queue[0];
  if (!cur) return null;
  return (
    <ConfirmDialog
      key={cur.id}
      title={cur.title}
      body={cur.body}
      confirmLabel={cur.confirmLabel ?? t('ui.ok')}
      danger={cur.danger}
      onConfirm={() => ConfirmService.settle(cur.id, true)}
      onCancel={() => ConfirmService.settle(cur.id, false)}
    />
  );
}
