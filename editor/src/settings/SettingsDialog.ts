import { Dialog } from '../ui/dialog/Dialog';
import {
    getAllSections,
    getSectionItems,
    getSettingsValue,
    setSettingsValue,
    onSettingsChange,
    type SettingsItemDescriptor,
} from './SettingsRegistry';

export function showSettingsDialog(): void {
    const sections = getAllSections();
    if (sections.length === 0) return;

    const body = document.createElement('div');
    body.className = 'es-settings-dialog-body';

    const nav = document.createElement('div');
    nav.className = 'es-settings-nav';

    const content = document.createElement('div');
    content.className = 'es-settings-content';

    body.appendChild(nav);
    body.appendChild(content);

    let activeSectionId = sections[0].id;
    const inputElements = new Map<string, HTMLInputElement | HTMLSelectElement>();

    function buildNav(): void {
        nav.innerHTML = '';
        for (const section of sections) {
            const btn = document.createElement('button');
            btn.className = 'es-settings-nav-item';
            if (section.id === activeSectionId) {
                btn.classList.add('es-active');
            }
            btn.textContent = section.title;
            btn.addEventListener('click', () => {
                activeSectionId = section.id;
                buildNav();
                buildContent();
            });
            nav.appendChild(btn);
        }
    }

    function buildContent(): void {
        content.innerHTML = '';
        const items = getSectionItems(activeSectionId);
        const section = sections.find(s => s.id === activeSectionId);

        if (section) {
            const heading = document.createElement('h3');
            heading.className = 'es-settings-section-title';
            heading.textContent = section.title;
            content.appendChild(heading);
        }

        for (const item of items) {
            const row = document.createElement('div');
            row.className = 'es-settings-item';
            content.appendChild(row);
            renderItem(row, item);
        }
    }

    function renderItem(container: HTMLElement, item: SettingsItemDescriptor): void {
        const value = getSettingsValue(item.id);

        switch (item.type) {
            case 'boolean': {
                const label = document.createElement('label');
                label.className = 'es-settings-checkbox-row';
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = value as boolean;
                input.addEventListener('change', () => {
                    setSettingsValue(item.id, input.checked);
                });
                const span = document.createElement('span');
                span.textContent = item.label;
                label.appendChild(input);
                label.appendChild(span);
                container.appendChild(label);
                inputElements.set(item.id, input);
                break;
            }
            case 'number': {
                const label = document.createElement('label');
                label.className = 'es-settings-label';
                label.textContent = item.label;
                container.appendChild(label);
                const input = document.createElement('input');
                input.type = 'number';
                input.className = 'es-settings-input';
                input.value = String(value ?? '');
                if (item.min !== undefined) input.min = String(item.min);
                if (item.max !== undefined) input.max = String(item.max);
                if (item.step !== undefined) input.step = String(item.step);
                input.addEventListener('input', () => {
                    const val = parseFloat(input.value);
                    if (!isNaN(val)) {
                        setSettingsValue(item.id, val);
                    }
                });
                container.appendChild(input);
                inputElements.set(item.id, input);
                break;
            }
            case 'string': {
                const label = document.createElement('label');
                label.className = 'es-settings-label';
                label.textContent = item.label;
                container.appendChild(label);
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'es-settings-input';
                input.value = (value as string) ?? '';
                input.addEventListener('change', () => {
                    setSettingsValue(item.id, input.value);
                });
                container.appendChild(input);
                inputElements.set(item.id, input);
                break;
            }
            case 'color': {
                const row = document.createElement('div');
                row.className = 'es-settings-color-row';
                const label = document.createElement('label');
                label.className = 'es-settings-label';
                label.textContent = item.label;
                row.appendChild(label);
                const input = document.createElement('input');
                input.type = 'color';
                input.className = 'es-color-input';
                input.value = (value as string) ?? '#000000';
                input.addEventListener('input', () => {
                    setSettingsValue(item.id, input.value);
                });
                row.appendChild(input);
                container.appendChild(row);
                inputElements.set(item.id, input);
                break;
            }
            case 'select': {
                const label = document.createElement('label');
                label.className = 'es-settings-label';
                label.textContent = item.label;
                container.appendChild(label);
                const select = document.createElement('select');
                select.className = 'es-settings-select';
                for (const opt of item.options ?? []) {
                    const option = document.createElement('option');
                    option.value = opt.value;
                    option.textContent = opt.label;
                    if (opt.value === value) option.selected = true;
                    select.appendChild(option);
                }
                select.addEventListener('change', () => {
                    setSettingsValue(item.id, select.value);
                });
                container.appendChild(select);
                inputElements.set(item.id, select);
                break;
            }
            case 'range': {
                const row = document.createElement('div');
                row.className = 'es-settings-range-row';
                const label = document.createElement('label');
                label.className = 'es-settings-label';
                label.textContent = item.label;
                row.appendChild(label);
                const valueDisplay = document.createElement('span');
                valueDisplay.className = 'es-settings-range-value';
                valueDisplay.textContent = String(value ?? 0);
                row.appendChild(valueDisplay);
                container.appendChild(row);
                const input = document.createElement('input');
                input.type = 'range';
                input.className = 'es-slider-input';
                input.value = String(value ?? 0);
                if (item.min !== undefined) input.min = String(item.min);
                if (item.max !== undefined) input.max = String(item.max);
                if (item.step !== undefined) input.step = String(item.step);
                input.addEventListener('input', () => {
                    const val = parseFloat(input.value);
                    valueDisplay.textContent = String(val);
                    setSettingsValue(item.id, val);
                });
                container.appendChild(input);
                inputElements.set(item.id, input);
                break;
            }
        }
    }

    buildNav();
    buildContent();

    const unsubscribe = onSettingsChange((id, value) => {
        const el = inputElements.get(id);
        if (!el) return;
        if (el instanceof HTMLSelectElement) {
            el.value = String(value);
        } else if (el.type === 'checkbox') {
            (el as HTMLInputElement).checked = value as boolean;
        } else {
            el.value = String(value);
        }
    });

    const dialog = new Dialog({
        title: 'Settings',
        content: body,
        width: 640,
        showCloseButton: true,
        closeOnOverlay: true,
        closeOnEscape: true,
        className: 'es-settings-dialog',
    });

    dialog.open().then(() => {
        unsubscribe();
    });
}
