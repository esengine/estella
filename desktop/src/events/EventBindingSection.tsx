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
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight, CornerDownRight, MousePointerClick, Plus, SlidersHorizontal, X } from 'lucide-react';

import { Select } from '@/components/Select';
import { SuggestInput } from '@/components/SuggestInput';
import { aiActionItems, aiConditionItems } from '@/components/aiSuggest';
import { aiParamOptions } from '@/ai/paramOptions';
import { actionParams, actionSeparator, subscribeActionCatalog, getActionCatalogRevision } from '@/ai/actionCatalog';
import { SceneStore } from '@/engine/SceneStore';
import { SceneCommands } from '@/engine/SceneCommands';
import { prettyLabel } from '@/engine/schema';
import { readEventRows, resolveTargetName, sceneEntityNames } from '@/events/eventBindingModel';
import { useInspectorCollapse, isSectionCollapsed } from '@/store/inspectorCollapse';
import { t } from '@/i18n';
import type { EntityId } from '@/types';
import { UIEventType, parseActionArg } from 'esengine';
import type { AiParamDef, AiParamValue, EventBindingRow } from 'esengine';

const SECTION_KEY = '__events';
/** The type strings the built-in widgets emit — suggestions, not a closed set. */
const BUILTIN_EVENTS: string[] = Object.values(UIEventType);
/** Empty target = "this entity"; the sentinel keeps the Select's value a string. */
const SELF = '';

export function EventBindingSection({ entityId, interactive }: { entityId: EntityId; interactive: boolean }) {
  useSyncExternalStore(SceneStore.subscribe, SceneStore.getRevision);
  // The project's own actions arrive with the schemas artifact, after open —
  // re-render then, so their parameter controls appear without a reselect.
  useSyncExternalStore(subscribeActionCatalog, getActionCatalogRevision);
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

  // What the chosen action takes. A row authored before the action declared its
  // parameters still shows them: the canonical string parses into the same
  // record the runtime would build (registry.ts owns that projection).
  const defs = actionParams(row.action);
  const values: Record<string, AiParamValue> = row.params && Object.keys(row.params).length
    ? { ...row.params }
    : parseActionArg(row.arg, defs, actionSeparator(row.action));

  // An authored value the built-in list doesn't know (a widget's own event, or
  // an entity renamed since) still has to be selectable — append it rather than
  // silently snapping the row to something else.
  const eventOptions = BUILTIN_EVENTS.includes(row.event) ? BUILTIN_EVENTS : [...BUILTIN_EVENTS, row.event];
  const names = sceneEntityNames();
  const target = row.target ?? SELF;
  const targetOptions = target === SELF || names.includes(target) ? names : [...names, target];
  const targetEntity = resolveTargetName(entityId, target);
  const dangling = target !== SELF && targetEntity == null;

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
          // The old input belongs to the old action — switching drops both forms.
          onCommit={(v) => (v.trim() === row.action ? undefined : patch({ action: v.trim(), params: undefined, arg: undefined }))}
        />
        {defs.length === 0 && (
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
        )}
      </div>

      {defs.length > 0 && (
        <div className="evt-params">
          {defs.map((def) => (
            <ParamControl
              key={def.name}
              def={def}
              value={values[def.name]}
              // Options come from the entity the action RUNS on, so a row that
              // targets a panel offers that panel's controllers, not the button's.
              optionsEntity={targetEntity ?? entityId}
              siblings={values}
              onChange={(v) => {
                const next = { ...values };
                if (v === undefined || v === '') delete next[def.name];
                else next[def.name] = v;
                patch({ params: Object.keys(next).length ? next : undefined, arg: undefined });
              }}
            />
          ))}
        </div>
      )}

      {open && (
        <div className="evt-row-more" data-row={index}>
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

/**
 * One declared parameter, rendered by its declared type. An `optionsSource` that
 * yields nothing (no controller on the target yet) degrades to a text box rather
 * than an empty dropdown — the row stays authorable while the scene is half-built.
 */
function ParamControl({
  def,
  value,
  optionsEntity,
  siblings,
  onChange,
}: {
  def: AiParamDef;
  value: AiParamValue | undefined;
  optionsEntity: EntityId;
  siblings: Readonly<Record<string, AiParamValue>>;
  onChange: (v: AiParamValue | undefined) => void;
}) {
  const label = def.label ?? prettyLabel(def.name);
  const dynamic = def.optionsSource ? aiParamOptions(def.optionsSource, { entityId: optionsEntity, params: siblings }) : null;
  const options = dynamic ?? (def.options ? def.options.map((o) => ({ value: o.value, label: o.label })) : null);
  const text = value === undefined ? '' : String(value);

  let control: ReactNode;
  if (def.type === 'bool') {
    control = (
      <input type="checkbox" checked={value === true} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
    );
  } else if (def.type === 'number') {
    control = (
      <input
        className="evt-param-input"
        type="number"
        defaultValue={text}
        key={text}
        aria-label={label}
        min={def.min}
        max={def.max}
        step={def.step}
        onBlur={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
    );
  } else if (options && options.length) {
    // The authored value survives even when it is no longer on offer (a renamed
    // page), so opening the row never silently rewrites the data.
    const opts = options.some((o) => o.value === text) || !text ? options : [...options, { value: text }];
    control = (
      <Select
        value={text}
        options={opts.map((o) => ({ value: o.value, label: o.label }))}
        onChange={(v) => onChange(v)}
        ariaLabel={label}
        className="evt-param-sel"
      />
    );
  } else {
    control = (
      <input
        className="evt-param-input"
        defaultValue={text}
        key={text}
        aria-label={label}
        placeholder={def.tooltip}
        spellCheck={false}
        onBlur={(e) => onChange(e.target.value.trim() || undefined)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
    );
  }

  return (
    <label className="evt-param" title={def.tooltip}>
      <span className="evt-param-label">{label}</span>
      {control}
    </label>
  );
}
