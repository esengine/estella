// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  PrefabModeBanner.tsx — the full-width bar shown while a prefab is open
 *        in Prefab Mode (ProjectStore.openPrefab). It names the prefab being
 *        edited and offers Save + Back to Scene. Mounted in the shell between the
 *        Toolbar and the workspace; renders nothing outside prefab mode.
 */
import { useSyncExternalStore } from 'react';
import { Package, ArrowLeft, Save } from 'lucide-react';
import { ProjectStore } from '@/project/ProjectStore';
import { Button } from './Button';
import { t } from '@/i18n';

export function PrefabModeBanner() {
  const project = useSyncExternalStore(ProjectStore.subscribe, ProjectStore.getSnapshot);
  const pe = project?.prefabEdit;
  if (!pe) return null;
  const back = pe.returnScene ? t('proj.prefabModeBackTo', { name: pe.returnScene }) : t('proj.prefabModeBack');
  const label = pe.isVariant ? t('proj.prefabModeVariantBanner') : t('proj.prefabModeBanner');
  return (
    <div className="prefab-mode-bar">
      <span className="pmb-icon"><Package size={14} strokeWidth={1.9} /></span>
      <span className="pmb-label">{label}</span>
      <span className="pmb-name">{pe.name}</span>
      <span className="pmb-actions">
        <Button variant="primary" onClick={() => void ProjectStore.save()}>
          <Save size={13} strokeWidth={1.9} /> {t('proj.prefabModeSave')}
        </Button>
        <Button onClick={() => void ProjectStore.exitPrefabMode()}>
          <ArrowLeft size={13} strokeWidth={1.9} /> {back}
        </Button>
      </span>
    </div>
  );
}
