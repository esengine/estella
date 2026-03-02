import { Dialog } from '../ui/dialog/Dialog';
import { icon, type IconName } from '../utils/icons';
import {
    getAllSections,
    getSectionItems,
    getSectionGroups,
    getGroupItems,
    getUngroupedSectionItems,
    getSettingsValue,
    setSettingsValue,
    onSettingsChange,
    searchSettings,
    sectionHasModifiedValues,
    resetSection,
    type SettingsItemDescriptor,
    type SettingsGroupDescriptor,
} from './SettingsRegistry';

let lastActiveSectionId_: string | null = null;

export function showSettingsDialog(): void {
    const sections = getAllSections();
    if (sections.length === 0) return;

    const body = document.createElement('div');
    body.className = 'es-settings-dialog-body';

    const searchContainer = document.createElement('div');
    searchContainer.className = 'es-settings-search';

    const searchInput = document.createElement('input');
    searchInput.className = 'es-settings-search-input';
    searchInput.type = 'text';
    searchInput.placeholder = 'Search settings...';

    const searchClear = document.createElement('button');
    searchClear.className = 'es-settings-search-clear';
    searchClear.textContent = '\u00D7';
    searchClear.style.display = 'none';

    searchContainer.appendChild(searchInput);
    searchContainer.appendChild(searchClear);

    const mainContainer = document.createElement('div');
    mainContainer.className = 'es-settings-main';

    const nav = document.createElement('div');
    nav.className = 'es-settings-nav';

    const content = document.createElement('div');
    content.className = 'es-settings-content';

    mainContainer.appendChild(nav);
    mainContainer.appendChild(content);

    body.appendChild(searchContainer);
    body.appendChild(mainContainer);

    let activeSectionId = lastActiveSectionId_ && sections.find(s => s.id === lastActiveSectionId_)
        ? lastActiveSectionId_
        : sections[0].id;
    let searchMode = false;
    const inputElements = new Map<string, HTMLInputElement | HTMLSelectElement>();
    const itemRows = new Map<string, HTMLElement>();
    const collapsedGroups = new Set<string>();

    for (const section of sections) {
        for (const group of getSectionGroups(section.id)) {
            if (group.collapsed) {
                collapsedGroups.add(group.id);
            }
        }
    }

    function buildNav(): void {
        nav.innerHTML = '';
        for (const section of sections) {
            const btn = document.createElement('button');
            btn.className = 'es-settings-nav-item';
            if (section.id === activeSectionId) {
                btn.classList.add('es-active');
            }

            if (section.icon) {
                const iconSpan = document.createElement('span');
                iconSpan.className = 'es-settings-nav-icon';
                iconSpan.innerHTML = icon(section.icon as IconName, 14);
                btn.appendChild(iconSpan);
            }

            const textSpan = document.createElement('span');
            textSpan.textContent = section.title;
            btn.appendChild(textSpan);

            if (sectionHasModifiedValues(section.id)) {
                const dot = document.createElement('span');
                dot.className = 'es-settings-modified-dot';
                btn.appendChild(dot);
            }

            btn.addEventListener('click', () => {
                activeSectionId = section.id;
                lastActiveSectionId_ = section.id;
                searchInput.value = '';
                searchClear.style.display = 'none';
                searchMode = false;
                nav.style.display = '';
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
            const allItems = searchMode ? searchSettings(searchInput.value) : getSectionItems(activeSectionId);
            const item = allItems.find(i => i.id === id);
            if (item) {
                row.style.display = isItemVisible(item) ? '' : 'none';
            }
        }
    }

    function buildContent(): void {
        content.innerHTML = '';
        itemRows.clear();
        inputElements.clear();

        const sectionDesc = sections.find(s => s.id === activeSectionId);
        if (sectionDesc) {
            const heading = document.createElement('h3');
            heading.className = 'es-settings-section-title';
            heading.textContent = sectionDesc.title;
            content.appendChild(heading);
        }

        const ungrouped = getUngroupedSectionItems(activeSectionId);
        for (const item of ungrouped) {
            const row = document.createElement('div');
            row.className = 'es-settings-item';
            if (!isItemVisible(item)) row.style.display = 'none';
            itemRows.set(item.id, row);
            content.appendChild(row);
            renderItem(row, item);
        }

        const groups = getSectionGroups(activeSectionId);
        for (const group of groups) {
            renderGroup(group);
        }

        const resetBtn = document.createElement('button');
        resetBtn.className = 'es-settings-reset-section';
        resetBtn.textContent = 'Reset Section';
        resetBtn.addEventListener('click', () => {
            resetSection(activeSectionId);
            buildNav();
            buildContent();
        });
        content.appendChild(resetBtn);
    }

    function renderGroup(group: SettingsGroupDescriptor): void {
        const groupItems = getGroupItems(group.id);
        if (groupItems.length === 0) return;

        const isCollapsed = collapsedGroups.has(group.id);

        const header = document.createElement('div');
        header.className = 'es-settings-group-header';
        if (isCollapsed) header.classList.add('es-collapsed');

        const chevron = document.createElement('span');
        chevron.className = 'es-settings-group-chevron';
        chevron.innerHTML = isCollapsed ? '&#9654;' : '&#9660;';
        header.appendChild(chevron);

        const label = document.createElement('span');
        label.textContent = group.label;
        header.appendChild(label);

        header.addEventListener('click', () => {
            if (collapsedGroups.has(group.id)) {
                collapsedGroups.delete(group.id);
            } else {
                collapsedGroups.add(group.id);
            }
            buildContent();
        });

        content.appendChild(header);

        if (!isCollapsed) {
            const groupBody = document.createElement('div');
            groupBody.className = 'es-settings-group-body';

            for (const item of groupItems) {
                const row = document.createElement('div');
                row.className = 'es-settings-item';
                if (!isItemVisible(item)) row.style.display = 'none';
                itemRows.set(item.id, row);
                groupBody.appendChild(row);
                renderItem(row, item);
            }

            content.appendChild(groupBody);
        }
    }

    function buildSearchResults(query: string): void {
        content.innerHTML = '';
        itemRows.clear();
        inputElements.clear();

        const results = searchSettings(query);

        if (results.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'es-settings-search-empty';
            empty.textContent = 'No settings found';
            content.appendChild(empty);
            return;
        }

        const grouped = new Map<string, SettingsItemDescriptor[]>();
        for (const item of results) {
            const list = grouped.get(item.section) || [];
            list.push(item);
            grouped.set(item.section, list);
        }

        for (const [sectionId, items] of grouped) {
            const sectionDesc = sections.find(s => s.id === sectionId);
            const sectionLabel = document.createElement('div');
            sectionLabel.className = 'es-settings-search-result-section';
            sectionLabel.textContent = sectionDesc?.title ?? sectionId;
            content.appendChild(sectionLabel);

            for (const item of items) {
                const row = document.createElement('div');
                row.className = 'es-settings-item';
                if (!isItemVisible(item)) row.style.display = 'none';
                itemRows.set(item.id, row);
                content.appendChild(row);
                renderItem(row, item);
            }
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
            buildNav();
            if (searchMode) {
                buildSearchResults(searchInput.value);
            } else {
                buildContent();
            }
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

    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim();
        searchClear.style.display = query ? '' : 'none';

        if (query.length > 0) {
            searchMode = true;
            nav.style.display = 'none';
            buildSearchResults(query);
        } else {
            searchMode = false;
            nav.style.display = '';
            buildNav();
            buildContent();
        }
    });

    searchClear.addEventListener('click', () => {
        searchInput.value = '';
        searchClear.style.display = 'none';
        searchMode = false;
        nav.style.display = '';
        buildNav();
        buildContent();
    });

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
        width: 880,
        showCloseButton: true,
        closeOnOverlay: true,
        closeOnEscape: true,
        className: 'es-settings-dialog',
    });

    dialog.open().then(() => {
        unsubscribe();
    });
}
