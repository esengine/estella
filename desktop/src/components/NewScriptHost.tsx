// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  NewScriptHost.tsx — renders the NewScriptService queue's front request
 *        as a NewScriptDialog. Mounted once in the editor shell (next to
 *        ConfirmHost); queued requests show one at a time in arrival order.
 */
import { useSyncExternalStore } from 'react';
import { NewScriptService } from './newScript';
import { NewScriptDialog } from './NewScriptDialog';

export function NewScriptHost() {
  const queue = useSyncExternalStore(NewScriptService.subscribe, NewScriptService.getSnapshot);
  const cur = queue[0];
  if (!cur) return null;
  return (
    <NewScriptDialog
      key={cur.id}
      dir={cur.dir}
      onDone={(path) => NewScriptService.settle(cur.id, path)}
    />
  );
}
