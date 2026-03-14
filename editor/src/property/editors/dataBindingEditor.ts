import type { PropertyEditorContext, PropertyEditorInstance } from '../PropertyEditor';
import { getComponentSchema } from '../../schemas/ComponentSchemas';

interface TargetOption {
    value: string;
    label: string;
}

function getBindableTargets(entityComponents?: string[]): TargetOption[] {
    if (!entityComponents) return [];
    const targets: TargetOption[] = [];
    for (const comp of entityComponents) {
        if (comp === 'Transform' || comp === 'DataBinding') continue;
        const schema = getComponentSchema(comp);
        if (!schema) continue;
        for (const prop of schema.properties) {
            if (prop.name === '*') continue;
            if (prop.readOnly) continue;
            const target = `${comp}.${prop.name}`;
            const typeHint = prop.type;
            targets.push({ value: target, label: `${target}  (${typeHint})` });
        }
    }
    return targets;
}

interface BindingItem {
    target: string;
    expression: string;
}

function parseBindings(value: unknown): BindingItem[] {
    if (!Array.isArray(value)) return [];
    return value.map((v: unknown) => {
        if (typeof v === 'string') {
            const eqIdx = v.indexOf('=');
            if (eqIdx === -1) return { target: v, expression: '' };
            return { target: v.slice(0, eqIdx), expression: v.slice(eqIdx + 1) };
        }
        if (v && typeof v === 'object' && 'target' in v && 'expression' in v) {
            return { target: (v as BindingItem).target, expression: (v as BindingItem).expression };
        }
        return { target: '', expression: '' };
    });
}

function serializeBindings(items: BindingItem[]): string[] {
    return items.map(b => `${b.target}=${b.expression}`);
}

const REMOVE_ICON = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

export function createDataBindingsEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, onChange, entityComponents } = ctx;
    let items = parseBindings(value);
    const targets = getBindableTargets(entityComponents);

    const wrapper = document.createElement('div');
    wrapper.className = 'es-data-bindings-editor';

    const listEl = document.createElement('div');
    listEl.className = 'es-data-bindings-list';

    const addBtn = document.createElement('button');
    addBtn.className = 'es-btn es-btn-sm es-btn-add-item';
    addBtn.textContent = '+ Add Binding';
    addBtn.title = 'Add binding';

    function emitChange() {
        onChange(serializeBindings(items));
    }

    function renderItems() {
        listEl.innerHTML = '';
        items.forEach((item, index) => {
            const row = document.createElement('div');
            row.className = 'es-data-binding-row';
            row.style.cssText = 'margin-bottom: 6px; padding: 6px; background: var(--es-bg-secondary, #2a2a2a); border-radius: 4px;';

            const targetRow = document.createElement('div');
            targetRow.style.cssText = 'display: flex; align-items: center; gap: 4px; margin-bottom: 4px;';

            const targetLabel = document.createElement('span');
            targetLabel.textContent = 'Target';
            targetLabel.style.cssText = 'font-size: 11px; color: var(--es-text-secondary, #888); width: 52px; flex-shrink: 0;';

            if (targets.length > 0) {
                const targetSelect = document.createElement('select');
                targetSelect.className = 'es-input';
                targetSelect.style.cssText = 'flex: 1; font-size: 11px;';
                const emptyOpt = document.createElement('option');
                emptyOpt.value = '';
                emptyOpt.textContent = '-- Select --';
                targetSelect.appendChild(emptyOpt);
                for (const t of targets) {
                    const opt = document.createElement('option');
                    opt.value = t.value;
                    opt.textContent = t.label;
                    if (t.value === item.target) opt.selected = true;
                    targetSelect.appendChild(opt);
                }
                if (item.target && !targets.some(t => t.value === item.target)) {
                    const opt = document.createElement('option');
                    opt.value = item.target;
                    opt.textContent = item.target;
                    opt.selected = true;
                    targetSelect.appendChild(opt);
                }
                targetSelect.addEventListener('change', () => {
                    items[index].target = targetSelect.value;
                    emitChange();
                });
                targetRow.appendChild(targetLabel);
                targetRow.appendChild(targetSelect);
            } else {
                const targetInput = document.createElement('input');
                targetInput.type = 'text';
                targetInput.className = 'es-input es-input-string';
                targetInput.style.cssText = 'flex: 1; font-size: 11px;';
                targetInput.value = item.target;
                targetInput.placeholder = 'Component.field';
                targetInput.addEventListener('change', () => {
                    items[index].target = targetInput.value;
                    emitChange();
                });
                targetRow.appendChild(targetLabel);
                targetRow.appendChild(targetInput);
            }

            const removeBtn = document.createElement('button');
            removeBtn.className = 'es-btn es-btn-icon es-btn-clear';
            removeBtn.title = 'Remove';
            removeBtn.innerHTML = REMOVE_ICON;
            removeBtn.addEventListener('click', () => {
                items.splice(index, 1);
                emitChange();
                renderItems();
            });
            targetRow.appendChild(removeBtn);

            const exprRow = document.createElement('div');
            exprRow.style.cssText = 'display: flex; align-items: center; gap: 4px;';

            const exprLabel = document.createElement('span');
            exprLabel.textContent = 'Expr';
            exprLabel.style.cssText = 'font-size: 11px; color: var(--es-text-secondary, #888); width: 52px; flex-shrink: 0;';

            const exprInput = document.createElement('input');
            exprInput.type = 'text';
            exprInput.className = 'es-input es-input-string';
            exprInput.style.cssText = 'flex: 1; font-size: 11px; font-family: monospace;';
            exprInput.value = item.expression;
            exprInput.placeholder = '{key} or {a / b}';
            exprInput.addEventListener('change', () => {
                items[index].expression = exprInput.value;
                emitChange();
            });

            exprRow.appendChild(exprLabel);
            exprRow.appendChild(exprInput);

            row.appendChild(targetRow);
            row.appendChild(exprRow);
            listEl.appendChild(row);
        });
    }

    addBtn.addEventListener('click', () => {
        items.push({ target: '', expression: '' });
        emitChange();
        renderItems();
    });

    renderItems();
    wrapper.appendChild(listEl);
    wrapper.appendChild(addBtn);
    container.appendChild(wrapper);

    return {
        update(v: unknown) {
            items = parseBindings(v);
            renderItems();
        },
        dispose() {
            wrapper.remove();
        },
    };
}
