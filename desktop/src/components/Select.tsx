// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Select.tsx
 * @brief   The shared themed dropdown — replaces native <select> everywhere so
 *          lists match the editor (same popover, hover, check mark) and stay
 *          keyboard-operable: Enter/Space opens focused on the current option,
 *          arrows move, Enter picks, Escape returns focus to the trigger.
 *
 *          Two trigger looks: 'input' (standalone, input-well styling — the
 *          default) and 'field' (fills an inspector `.field.dropdown` wrapper,
 *          like Details' EnumControl). List styling reuses the `.dd-*` popover
 *          vocabulary.
 */
import { useRef, type CSSProperties } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { Popover, usePopover } from './Popover';
import { useListbox } from './useListbox';

export interface SelectOption<T extends string> {
  value: T;
  label?: string;
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  variant = 'input',
  className,
  style,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  ariaLabel?: string;
  variant?: 'input' | 'field';
  /** Extra trigger classes (e.g. a panel's sizing class). */
  className?: string;
  style?: CSSProperties;
}) {
  const pop = usePopover();
  const trigger = useRef<HTMLButtonElement>(null);
  const { triggerProps, listProps } = useListbox(pop.isOpen);
  const cur = options.find((o) => o.value === value);

  const close = () => {
    pop.close();
    trigger.current?.focus();
  };
  const toggle = () => {
    if (pop.isOpen) close();
    else pop.open(trigger.current);
  };

  const triggerClass =
    variant === 'field' ? 'dd-trigger' : `sel-trigger${className ? ` ${className}` : ''}`;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={triggerClass}
        style={style}
        aria-label={ariaLabel}
        {...triggerProps}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={toggle}
      >
        <span className="dd-val">{cur ? cur.label ?? cur.value : String(value)}</span>
        <ChevronDown size={12} strokeWidth={2} />
      </button>
      {pop.anchor && (
        <Popover anchor={pop.anchor} width={Math.max(pop.anchor.width, 120)} onClose={close}>
          <div className="dd-list" {...listProps}>
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={`dd-opt${o.value === value ? ' on' : ''}`}
                onClick={() => {
                  onChange(o.value);
                  close();
                }}
              >
                <span className="dd-opt-label">{o.label ?? o.value}</span>
                {o.value === value && <Check size={12} strokeWidth={2.4} />}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}
