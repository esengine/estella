// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ParamControls.tsx
 * @brief   An action's declared parameters, rendered as real controls.
 *
 * One renderer for every surface that references an action by name — an event
 * wire, an FSM state hook, a BT leaf. The declaration lives in the registry
 * (sdk), the choices that depend on the scene come from `paramOptions`, and this
 * decides which control each declared type gets. Keeping it in one place is the
 * point: an action gains a parameter once and every authoring surface shows it.
 *
 * `entityId` is optional because not every surface HAS an entity: an `.esfsm`
 * asset is authored outside any scene, so its `optionsSource` parameters have
 * nothing to resolve against and fall back to free text — the same degradation
 * as a source that yields no options yet.
 */
import { Select } from '@/components/Select';
import { aiParamOptions } from '@/ai/paramOptions';
import { actionParams, actionSeparator } from '@/ai/actionCatalog';
import { prettyLabel } from '@/engine/schema';
import type { EntityId } from '@/types';
import { parseActionArg } from 'esengine';
import type { AiParamDef, AiParamValue } from 'esengine';
import type { ReactNode } from 'react';

/**
 * The values to show for an action reference, from whichever form it was
 * authored in: named parameters if it has them, else the canonical string
 * parsed through the action's own declaration (the projection the runtime uses).
 */
export function paramValuesOf(
  action: string,
  params: Readonly<Record<string, AiParamValue>> | undefined,
  arg: string | undefined,
): Record<string, AiParamValue> {
  if (params && Object.keys(params).length) return { ...params };
  return parseActionArg(arg, actionParams(action), actionSeparator(action));
}

/** One declared parameter, rendered by its declared type. */
export function ParamControl({
  def,
  value,
  entityId,
  siblings,
  onChange,
}: {
  def: AiParamDef;
  value: AiParamValue | undefined;
  /** The entity the action will run on, when the surface has one. */
  entityId?: EntityId;
  /** The reference's other parameter values, for one that narrows a sibling. */
  siblings: Readonly<Record<string, AiParamValue>>;
  onChange: (v: AiParamValue | undefined) => void;
}) {
  const label = def.label ?? prettyLabel(def.name);
  const dynamic = def.optionsSource && entityId != null
    ? aiParamOptions(def.optionsSource, { entityId, params: siblings })
    : null;
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

/**
 * Every declared parameter of `action`, as a block of controls. Renders nothing
 * when the action declares none — the caller keeps its plain argument field for
 * that case, since an undeclared action still takes a free string.
 */
export function ActionParams({
  action,
  params,
  arg,
  entityId,
  onChange,
}: {
  action: string;
  params: Readonly<Record<string, AiParamValue>> | undefined;
  arg: string | undefined;
  entityId?: EntityId;
  /** Called with the whole next record, or undefined once it is empty. */
  onChange: (next: Record<string, AiParamValue> | undefined) => void;
}): ReactNode {
  const defs = actionParams(action);
  if (defs.length === 0) return null;
  const values = paramValuesOf(action, params, arg);

  return (
    <div className="evt-params">
      {defs.map((def) => (
        <ParamControl
          key={def.name}
          def={def}
          value={values[def.name]}
          entityId={entityId}
          siblings={values}
          onChange={(v) => {
            const next = { ...values };
            if (v === undefined || v === '') delete next[def.name];
            else next[def.name] = v;
            onChange(Object.keys(next).length ? next : undefined);
          }}
        />
      ))}
    </div>
  );
}
