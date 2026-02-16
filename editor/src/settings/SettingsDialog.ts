import { Dialog } from '../ui/dialog/Dialog';
import {
    getAllSections,
    getSectionItems,
    getSettingsValue,
    setSettingsValue,
    onSettingsChange,
    type SettingsItemDescriptor,
} from './SettingsRegistry';

let lastActiveSectionId_: string | null = null;

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

    let activeSectionId = lastActiveSectionId_ && sections.find(s => s.id === lastActiveSectionId_)
        ? lastActiveSectionId_
        : sections[0].id;
    const inputElements = new Map<string, HTMLInputElement | HTMLSelectElement>();
    const itemRows = new Map<string, HTMLElement>();

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
                lastActiveSectionId_ = section.id;
                buildNav();
                buildContent();
            });
            nav.appendChild(btn);
        }
    }

    function isItemVisible(item: SettingsItemDescriptor): boolean {
        if (!item.visibleWhen) return true;
        const depValue = getSettingsValue(item.visibleWhen.settingId);
        return depValue === item.visibleWhen.value;
    }

    function updateVisibility(): void {
        for (const [id, row] of itemRows) {
            const items = getSectionItems(activeSectionId);
            const item = items.find(i => i.id === id);
            if (item) {
                row.style.display = isItemVisible(item) ? '' : 'none';
            }
        }
    }

    function buildContent(): void {
        content.innerHTML = '';
        itemRows.clear();
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
            if (!isItemVisible(item)) {
                row.style.display = 'none';
            }
            itemRows.set(item.id, row);
            content.appendChild(row);
            renderItem(row, item);
        }
    }

    function addDescription(container: HTMLElement, item: SettingsItemDescriptor): void {
        if (!item.description) return;
        const desc = document.createElement('div');
        desc.className = 'es-settings-description';
        desc.textContent = item.description;
        container.appendChild(desc);
    }

    function addResetButton(container: HTMLElement, item: SettingsItemDescriptor): void {
        const value = getSettingsValue(item.id);
        if (value === item.defaultValue) return;
        const btn = document.createElement('button');
        btn.className = 'es-settings-reset-btn';
        btn.title = `Reset to default (${String(item.defaultValue)})`;
        btn.textContent = '\u21BA';
        btn.addEventListener('click', () => {
            setSettingsValue(item.id, item.defaultValue);
            buildContent();
        });
        container.appendChild(btn);
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
                    updateVisibility();
                });
                const span = document.createElement('span');
                span.textContent = item.label;
                label.appendChild(input);
                label.appendChild(span);
                addResetButton(label, item);
                container.appendChild(label);
                addDescription(container, item);
                inputElements.set(item.id, input);
                break;
            }
            case 'number': {
                const header = document.createElement('div');
                header.className = 'es-settings-item-header';
                const label = document.createElement('label');
                label.className = 'es-settings-label';
                label.textContent = item.label;
                header.appendChild(label);
                addResetButton(header, item);
                container.appendChild(header);
                addDescription(container, item);
                const input = document.createElement('input');
                input.type = 'number';
                input.className = 'es-settings-input';
                input.value = String(value ?? '');
                if (item.min !== undefined) input.min = String(item.min);
                if (item.max !== undefined) input.max = String(item.max);
                if (item.step !== undefined) input.step = String(item.step);
                input.addEventListener('input', () => {
                    let val = parseFloat(input.value);
                    if (!isNaN(val)) {
                        val = Math.max(item.min ?? -Infinity, Math.min(item.max ?? Infinity, val));
                        setSettingsValue(item.id, val);
                    }
                });
                container.appendChild(input);
                inputElements.set(item.id, input);
                break;
            }
            case 'string': {
                const header = document.createElement('div');
                header.className = 'es-settings-item-header';
                const label = document.createElement('label');
                label.className = 'es-settings-label';
                label.textContent = item.label;
                header.appendChild(label);
                addResetButton(header, item);
                container.appendChild(header);
                addDescription(container, item);
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
                addResetButton(row, item);
                const input = document.createElement('input');
                input.type = 'color';
                input.className = 'es-color-input';
                input.value = (value as string) ?? '#000000';
                input.addEventListener('input', () => {
                    setSettingsValue(item.id, input.value);
                });
                row.appendChild(input);
                container.appendChild(row);
                addDescription(container, item);
                inputElements.set(item.id, input);
                break;
            }
            case 'select': {
                const header = document.createElement('div');
                header.className = 'es-settings-item-header';
                const label = document.createElement('label');
                label.className = 'es-settings-label';
                label.textContent = item.label;
                header.appendChild(label);
                addResetButton(header, item);
                container.appendChild(header);
                addDescription(container, item);
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
                    updateVisibility();
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
                addResetButton(row, item);
                const valueDisplay = document.createElement('span');
                valueDisplay.className = 'es-settings-range-value';
                valueDisplay.textContent = String(value ?? 0);
                row.appendChild(valueDisplay);
                container.appendChild(row);
                addDescription(container, item);
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
        updateVisibility();
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
