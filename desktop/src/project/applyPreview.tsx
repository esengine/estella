// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  applyPreview.tsx — the "Apply to Prefab" change preview.
 *
 * Apply-to-Prefab rewrites the SHARED prefab asset for every instance, so before
 * committing we show an itemized diff (each override by entity + component.field,
 * plus added/removed entities) and let the user confirm. Built on the existing
 * confirm service (its body is a ReactNode), so it reuses the themed modal +
 * keyboard contract rather than inventing a second dialog stack.
 */
import type { ReactNode } from 'react';
import type { PrefabOverride, AddedEntity, PrefabEntityId } from 'esengine';
import { confirm } from '@/components/confirm';
import { t } from '@/i18n';

export interface ApplyDelta {
  overrides: readonly PrefabOverride[];
  added: readonly AddedEntity[];
  removed: readonly PrefabEntityId[];
}

/** Human label for one override — "Transform.position", a component type, or a word. */
function overrideLabel(o: PrefabOverride): string {
  switch (o.type) {
    case 'property':
      return `${o.componentType}.${o.propertyName}`;
    case 'component_added':
    case 'component_replaced':
      return o.componentData?.type ?? '?';
    case 'component_removed':
      return o.componentType ?? '?';
    case 'name':
      return t('proj.applyDiffName');
    case 'visibility':
      return t('proj.applyDiffVisibility');
    case 'parent':
      return t('proj.applyDiffReparent');
    default:
      return o.type;
  }
}

/** Change kind → the left-bar colour class (edit=amber, add=green, remove=red). */
function overrideKind(o: PrefabOverride): 'edit' | 'add' | 'remove' {
  if (o.type === 'component_added' || o.type === 'component_replaced') return 'add';
  if (o.type === 'component_removed') return 'remove';
  return 'edit';
}

function DiffBody({
  prefabName,
  delta,
  nameOf,
}: {
  prefabName: string;
  delta: ApplyDelta;
  nameOf: (id: PrefabEntityId) => string;
}): ReactNode {
  const rows: ReactNode[] = [];
  delta.overrides.forEach((o, i) =>
    rows.push(
      <li key={`o${i}`} className={`ad-item ad-${overrideKind(o)}`}>
        <span className="ad-ent">{nameOf(o.prefabEntityId)}</span>
        <span className="ad-detail">{overrideLabel(o)}</span>
      </li>,
    ),
  );
  delta.added.forEach((a, i) =>
    rows.push(
      <li key={`a${i}`} className="ad-item ad-add">
        <span className="ad-ent">{a.name}</span>
        <span className="ad-detail">{t('proj.applyDiffAdded')}</span>
      </li>,
    ),
  );
  delta.removed.forEach((id, i) =>
    rows.push(
      <li key={`r${i}`} className="ad-item ad-remove">
        <span className="ad-ent">{nameOf(id)}</span>
        <span className="ad-detail">{t('proj.applyDiffRemoved')}</span>
      </li>,
    ),
  );
  return (
    <div className="apply-diff">
      <p className="ad-lead">{t('proj.applyPreviewLead', { name: prefabName })}</p>
      <ul className="ad-list">{rows}</ul>
    </div>
  );
}

/**
 * Show the Apply preview and resolve true if the user confirms. Structural edits
 * (added/removed) mark the action destructive (red confirm). `nameOf` resolves a
 * prefab-entity id to a display name (instance entity, else prefab base, else id).
 */
export function previewApply(
  prefabName: string,
  delta: ApplyDelta,
  nameOf: (id: PrefabEntityId) => string,
): Promise<boolean> {
  // A re-parent rewrites the shared prefab's topology — count it structural so
  // the confirm reads as destructive, like add/remove.
  const structural =
    delta.added.length + delta.removed.length + delta.overrides.filter((o) => o.type === 'parent').length;
  return confirm({
    title: t('proj.applyPreviewTitle'),
    confirmLabel: t('proj.applyLabel'),
    danger: structural > 0,
    body: <DiffBody prefabName={prefabName} delta={delta} nameOf={nameOf} />,
  });
}
