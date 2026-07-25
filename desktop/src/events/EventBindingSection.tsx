// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    EventBindingSection.tsx
 * @brief   The Details panel's Events section — authoring a wire from an entity
 *          event to a named action, with no code.
 *
 * One row is one {@link EventBindingRow}: "on `click`, run `ui.setPage` on
 * `Panel` with `tabs:settings`". The vocabularies are borrowed, not invented —
 * events from the SDK's `UIEventType`, actions/conditions from the same
 * `aiRegistry` palette the FSM/BT editors use (so a game's `registerAction`
 * shows up in all three), targets from the scene's entity names resolved by the
 * runtime's nearest-first rule. Deliberately NOT a graph: a row has no
 * branching, and anything needing logic points at an action (`fsm.fire`) that
 * hands off to the editors that already do graphs.
 *
 * Lives beside its model rather than inside Details.tsx: the section is
 * self-contained (reads the SceneModel, writes through SceneCommands, like the
 * Controllers strip), and keeping the pair in one feature folder is what the
 * `controller/` · `fsm/` · `bt/` folders already do.
 */
import { useState } from 'react';
import { useSyncExternalStore } from 'react';
import { ChevronDown, ChevronRight, CornerDownRight, MousePointerClick, Plus, SlidersHorizontal, X } from 'lucide-react';

import { Select } from '@/components/Select';
import { SuggestInput } from '@/components/SuggestInput';
import { aiActionItems, aiConditionItems } from '@/components/aiSuggest';
import { SceneStore } from '@/engine/SceneStore';
import { SceneCommands } from '@/engine/SceneCommands';
import { readEventRows, resolveTargetName, sceneEntityNames } from '@/events/eventBindingModel';
import { useInspectorCollapse, isSectionCollapsed } from '@/store/inspectorCollapse';
import { t } from '@/i18n';
import type { EntityId } from '@/types';
import { UIEventType } from 'esengine';
import type { EventBindingRow } from 'esengine';

const SECTION_KEY = '__events';
/** The type strings the built-in widgets emit — suggestions, not a closed set. */
const BUILTIN_EVENTS: string[] = Object.values(UIEventType);
/** Empty target = "this entity"; the sentinel keeps the Select's value a string. */
const SELF = '';

export function EventBindingSection({ entityId, interactive }: { entityId: EntityId; interactive: boolean }) {
  useSyncExternalStore(SceneStore.subscribe, SceneStore.getRevision);
  const collapseExplicit = useInspectorCollapse((s) => s.explicit);
  const toggleCollapse = useInspectorCollapse((s) => s.toggle);
  const collapsed = isSectionCollapsed(collapseExplicit, SECTION_KEY);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const rows = readEventRows(entityId);
  // Non-interactive entities don't emit anything yet, so an empty section there
  // would be pure noise — but an authored wire always shows, wherever it is.
  if (!interactive && rows.length === 0) return null;

  const addRow = () => {
    SceneCommands.addEventBinding(entityId, { event: UIEventType.Click, action: '' });
    if (collapsed) toggleCollapse(SECTION_KEY);
  };

  return (
    <div className="evt-inline">
      <div
        className="evt-head"
        role="button"
        tabIndex={0}
        onClick={() => toggleCollapse(SECTION_KEY)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleCollapse(SECTION_KEY);
          }
        }}
      >
        <span className="evt-caret">
          {collapsed ? <ChevronRight size={12} strokeWidth={2.4} /> : <ChevronDown size={12} strokeWidth={2.4} />}
        </span>
        <MousePointerClick size={12} strokeWidth={2} className="evt-head-icon" />
        <span className="evt-title">{t('evt.section')}</span>
        {rows.length > 0 && <span className="evt-count">{rows.length}</span>}
        <button
          type="button"
          className="evt-add"
          title={t('evt.add')}
          onClick={(e) => {
            e.stopPropagation();
            addRow();
          }}
        >
          <Plus size={12} strokeWidth={2.4} />
        </button>
      </div>

      {!collapsed && (
        <>
          {rows.length === 0 && (
            <div className="evt-empty">
              <p>{t('evt.empty')}</p>
              <p className="evt-empty-hint">{t('evt.emptyHint')}</p>
            </div>
          )}
          {rows.map((row, i) => (
            <EventRow
              key={i}
              entityId={entityId}
              row={row}
              index={i}
              open={!!expanded[i] || !!row.guard || !!row.once}
              onToggleMore={() => setExpanded((s) => ({ ...s, [i]: !s[i] }))}
            />
          ))}
        </>
      )}
    </div>
  );
}

function EventRow({
  entityId,
  row,
  index,
  open,
  onToggleMore,
}: {
  entityId: EntityId;
  row: EventBindingRow;
  index: number;
  open: boolean;
  onToggleMore: () => void;
}) {
  const patch = (p: Partial<EventBindingRow>) => SceneCommands.updateEventBinding(entityId, index, p);
  const enabled = row.enabled !== false;

  // An authored value the built-in list doesn't know (a widget's own event, or
  // an entity renamed since) still has to be selectable — append it rather than
  // silently snapping the row to something else.
  const eventOptions = BUILTIN_EVENTS.includes(row.event) ? BUILTIN_EVENTS : [...BUILTIN_EVENTS, row.event];
  const names = sceneEntityNames();
  const target = row.target ?? SELF;
  const targetOptions = target === SELF || names.includes(target) ? names : [...names, target];
  const dangling = target !== SELF && resolveTargetName(entityId, target) == null;

  return (
    <div className={`evt-row${enabled ? '' : ' off'}`}>
      <div className="evt-row-head">
        <input
          type="checkbox"
          className="evt-chk"
          checked={enabled}
          title={t('evt.rowEnabled')}
          onChange={(e) => patch({ enabled: e.target.checked ? undefined : false })}
        />
        <Select
          value={row.event}
          options={eventOptions.map((v) => ({ value: v }))}
          onChange={(v) => patch({ event: v })}
          ariaLabel={t('evt.event')}
          className="evt-sel"
        />
        <CornerDownRight size={11} strokeWidth={2} className="evt-arrow" />
        <Select
          value={target}
          options={[{ value: SELF, label: t('evt.targetSelf') }, ...targetOptions.map((v) => ({ value: v }))]}
          onChange={(v) => patch({ target: v === SELF ? undefined : v })}
          ariaLabel={t('evt.target')}
          className={`evt-sel${dangling ? ' bad' : ''}`}
        />
        <button
          type="button"
          className={`evt-more${open ? ' on' : ''}`}
          title={t('evt.more')}
          onClick={onToggleMore}
        >
          <SlidersHorizontal size={11} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="evt-del"
          title={t('evt.remove')}
          onClick={() => SceneCommands.removeEventBinding(entityId, index)}
        >
          <X size={12} strokeWidth={2.4} />
        </button>
      </div>

      {dangling && <div className="evt-warn">{t('evt.targetMissing', { name: target })}</div>}

      <div className="evt-row-body">
        <SuggestInput
          key={`${index}-action-${row.action}`}
          defaultValue={row.action}
          items={aiActionItems()}
          placeholder={t('evt.actionPh')}
          ariaLabel={t('evt.action')}
          onCommit={(v) => patch({ action: v.trim() })}
        />
        <input
          className="evt-arg"
          defaultValue={row.arg ?? ''}
          key={`${index}-arg-${row.arg ?? ''}`}
          placeholder={t('evt.argPh')}
          spellCheck={false}
          onBlur={(e) => patch({ arg: e.target.value.trim() || undefined })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </div>

      {open && (
        <div className="evt-row-more">
          <SuggestInput
            key={`${index}-guard-${row.guard ?? ''}`}
            defaultValue={row.guard ?? ''}
            items={aiConditionItems()}
            placeholder={t('evt.guardPh')}
            ariaLabel={t('evt.guard')}
            onCommit={(v) => patch({ guard: v.trim() || undefined })}
          />
          <label className="evt-once" title={t('evt.onceTip')}>
            <input
              type="checkbox"
              checked={!!row.once}
              onChange={(e) => patch({ once: e.target.checked ? true : undefined })}
            />
            {t('evt.once')}
          </label>
        </div>
      )}
    </div>
  );
}
