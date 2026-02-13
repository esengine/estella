/**
 * @file    uiRectEditor.ts
 * @brief   Custom UIRect editor with anchor preset grid and smart property display
 */

import type { PropertyEditorContext, PropertyEditorInstance } from './PropertyEditor';
import { setupDragLabel } from './editors';

// =============================================================================
// Types
// =============================================================================

interface Vec2 {
    x: number;
    y: number;
}

interface UIRectData {
    anchorMin: Vec2;
    anchorMax: Vec2;
    offsetMin: Vec2;
    offsetMax: Vec2;
    size: Vec2;
    pivot: Vec2;
}

interface PropertyChange {
    property: string;
    oldValue: unknown;
    newValue: unknown;
}

type OnChange = (changes: PropertyChange[]) => void;

interface FieldEditor {
    update(data: UIRectData): void;
    dispose(): void;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULTS: UIRectData = {
    anchorMin: { x: 0.5, y: 0.5 },
    anchorMax: { x: 0.5, y: 0.5 },
    offsetMin: { x: 0, y: 0 },
    offsetMax: { x: 0, y: 0 },
    size: { x: 100, y: 100 },
    pivot: { x: 0.5, y: 0.5 },
};

interface AnchorPreset {
    name: string;
    label: string;
    anchorMin: Vec2;
    anchorMax: Vec2;
    svg: string;
}

const FRAME = '<rect x="1" y="1" width="18" height="18" rx="1" stroke="currentColor" stroke-dasharray="2 2" opacity="0.25" fill="none"/>';

function pointSvg(cx: number, cy: number): string {
    return FRAME +
        `<line x1="1" y1="${cy}" x2="19" y2="${cy}" stroke="currentColor" opacity="0.2"/>` +
        `<line x1="${cx}" y1="1" x2="${cx}" y2="19" stroke="currentColor" opacity="0.2"/>` +
        `<circle cx="${cx}" cy="${cy}" r="2.5" fill="currentColor"/>`;
}

const POINT_PRESETS: AnchorPreset[] = [
    { name: 'top-left',      label: 'Top Left',      anchorMin: { x: 0, y: 1 },     anchorMax: { x: 0, y: 1 },     svg: pointSvg(3, 3) },
    { name: 'top-center',    label: 'Top Center',    anchorMin: { x: 0.5, y: 1 },   anchorMax: { x: 0.5, y: 1 },   svg: pointSvg(10, 3) },
    { name: 'top-right',     label: 'Top Right',     anchorMin: { x: 1, y: 1 },     anchorMax: { x: 1, y: 1 },     svg: pointSvg(17, 3) },
    { name: 'middle-left',   label: 'Middle Left',   anchorMin: { x: 0, y: 0.5 },   anchorMax: { x: 0, y: 0.5 },   svg: pointSvg(3, 10) },
    { name: 'center',        label: 'Center',        anchorMin: { x: 0.5, y: 0.5 }, anchorMax: { x: 0.5, y: 0.5 }, svg: pointSvg(10, 10) },
    { name: 'middle-right',  label: 'Middle Right',  anchorMin: { x: 1, y: 0.5 },   anchorMax: { x: 1, y: 0.5 },   svg: pointSvg(17, 10) },
    { name: 'bottom-left',   label: 'Bottom Left',   anchorMin: { x: 0, y: 0 },     anchorMax: { x: 0, y: 0 },     svg: pointSvg(3, 17) },
    { name: 'bottom-center', label: 'Bottom Center', anchorMin: { x: 0.5, y: 0 },   anchorMax: { x: 0.5, y: 0 },   svg: pointSvg(10, 17) },
    { name: 'bottom-right',  label: 'Bottom Right',  anchorMin: { x: 1, y: 0 },     anchorMax: { x: 1, y: 0 },     svg: pointSvg(17, 17) },
];

const STRETCH_H_SVG = FRAME +
    '<line x1="4" y1="10" x2="16" y2="10" stroke="currentColor" stroke-width="1.5"/>' +
    '<path d="M6 8L4 10L6 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
    '<path d="M14 8L16 10L14 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>';

const STRETCH_V_SVG = FRAME +
    '<line x1="10" y1="4" x2="10" y2="16" stroke="currentColor" stroke-width="1.5"/>' +
    '<path d="M8 6L10 4L12 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
    '<path d="M8 14L10 16L12 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>';

const STRETCH_BOTH_SVG = FRAME +
    '<line x1="4" y1="10" x2="16" y2="10" stroke="currentColor" stroke-width="1.2"/>' +
    '<path d="M6 8L4 10L6 12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' +
    '<path d="M14 8L16 10L14 12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' +
    '<line x1="10" y1="4" x2="10" y2="16" stroke="currentColor" stroke-width="1.2"/>' +
    '<path d="M8 6L10 4L12 6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' +
    '<path d="M8 14L10 16L12 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>';

const STRETCH_PRESETS: AnchorPreset[] = [
    { name: 'stretch-h',    label: 'Stretch Horizontal', anchorMin: { x: 0, y: 0.5 }, anchorMax: { x: 1, y: 0.5 }, svg: STRETCH_H_SVG },
    { name: 'stretch-v',    label: 'Stretch Vertical',   anchorMin: { x: 0.5, y: 0 }, anchorMax: { x: 0.5, y: 1 }, svg: STRETCH_V_SVG },
    { name: 'stretch-both', label: 'Stretch Both',       anchorMin: { x: 0, y: 0 },   anchorMax: { x: 1, y: 1 },   svg: STRETCH_BOTH_SVG },
];

const ALL_PRESETS = [...POINT_PRESETS, ...STRETCH_PRESETS];

// =============================================================================
// Helpers
// =============================================================================

function mergeDefaults(value: unknown): UIRectData {
    const obj = (value && typeof value === 'object') ? value as Record<string, unknown> : {};
    return {
        anchorMin: (obj.anchorMin as Vec2) ?? { ...DEFAULTS.anchorMin },
        anchorMax: (obj.anchorMax as Vec2) ?? { ...DEFAULTS.anchorMax },
        offsetMin: (obj.offsetMin as Vec2) ?? { ...DEFAULTS.offsetMin },
        offsetMax: (obj.offsetMax as Vec2) ?? { ...DEFAULTS.offsetMax },
        size: (obj.size as Vec2) ?? { ...DEFAULTS.size },
        pivot: (obj.pivot as Vec2) ?? { ...DEFAULTS.pivot },
    };
}

function vec2Eq(a: Vec2, b: Vec2): boolean {
    return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}

function isPointMode(data: UIRectData): boolean {
    return data.anchorMin.x === data.anchorMax.x && data.anchorMin.y === data.anchorMax.y;
}

function findMatchingPreset(data: UIRectData): AnchorPreset | null {
    for (const p of ALL_PRESETS) {
        if (vec2Eq(data.anchorMin, p.anchorMin) && vec2Eq(data.anchorMax, p.anchorMax)) {
            return p;
        }
    }
    return null;
}

function makeSvg(inner: string): string {
    return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="none">${inner}</svg>`;
}

// =============================================================================
// Field Builders
// =============================================================================

function createVec2Row(
    container: HTMLElement,
    labelText: string,
    value: Vec2,
    onInput: (v: Vec2) => void
): { update(v: Vec2): void; dispose(): void } {
    const row = document.createElement('div');
    row.className = 'es-uirect-row';

    const label = document.createElement('span');
    label.className = 'es-uirect-label';
    label.textContent = labelText;

    const wrapper = document.createElement('div');
    wrapper.className = 'es-vec-editor es-vec2-editor';

    const inputs: HTMLInputElement[] = [];
    const keys: (keyof Vec2)[] = ['x', 'y'];
    const labelTexts = ['X', 'Y'];
    const colorClasses = ['es-vec-x', 'es-vec-y'];
    let current = { ...value };

    keys.forEach((key, i) => {
        const group = document.createElement('div');
        group.className = `es-vec-field ${colorClasses[i]}`;

        const lbl = document.createElement('span');
        lbl.className = 'es-vec-label';
        lbl.textContent = labelTexts[i];

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'es-input es-input-number';
        input.step = '0.01';
        input.value = String(current[key]);

        const commit = () => {
            current = { ...current, [key]: parseFloat(input.value) || 0 };
            onInput(current);
        };

        input.addEventListener('change', commit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { input.blur(); commit(); }
        });

        setupDragLabel(lbl, input, (v) => {
            current = { ...current, [key]: v };
            onInput(current);
        });

        group.appendChild(lbl);
        group.appendChild(input);
        wrapper.appendChild(group);
        inputs.push(input);
    });

    row.appendChild(label);
    row.appendChild(wrapper);
    container.appendChild(row);

    return {
        update(v: Vec2) {
            current = { ...v };
            inputs[0].value = String(v.x);
            inputs[1].value = String(v.y);
        },
        dispose() { row.remove(); },
    };
}

function createNumberPairRow(
    container: HTMLElement,
    labelText: string,
    label1: string,
    label2: string,
    value1: number,
    value2: number,
    onInput: (v1: number, v2: number) => void
): { update(v1: number, v2: number): void; dispose(): void } {
    const row = document.createElement('div');
    row.className = 'es-uirect-row';

    const label = document.createElement('span');
    label.className = 'es-uirect-label';
    label.textContent = labelText;

    const pair = document.createElement('div');
    pair.className = 'es-uirect-pair';

    let cur1 = value1;
    let cur2 = value2;

    const inputs: HTMLInputElement[] = [];
    [{ l: label1, v: value1 }, { l: label2, v: value2 }].forEach((item, i) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'es-uirect-pair-item';

        const lbl = document.createElement('span');
        lbl.className = 'es-uirect-pair-label';
        lbl.textContent = item.l;

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'es-input es-input-number';
        input.step = '1';
        input.value = String(item.v);

        const commit = () => {
            const val = parseFloat(input.value) || 0;
            if (i === 0) cur1 = val; else cur2 = val;
            onInput(cur1, cur2);
        };

        input.addEventListener('change', commit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { input.blur(); commit(); }
        });

        setupDragLabel(lbl, input, (v) => {
            if (i === 0) cur1 = v; else cur2 = v;
            onInput(cur1, cur2);
        }, 1);

        itemDiv.appendChild(lbl);
        itemDiv.appendChild(input);
        pair.appendChild(itemDiv);
        inputs.push(input);
    });

    row.appendChild(label);
    row.appendChild(pair);
    container.appendChild(row);

    return {
        update(v1: number, v2: number) {
            cur1 = v1; cur2 = v2;
            inputs[0].value = String(v1);
            inputs[1].value = String(v2);
        },
        dispose() { row.remove(); },
    };
}

// =============================================================================
// Mode Builders
// =============================================================================

function buildPointModeFields(
    container: HTMLElement,
    data: UIRectData,
    onChange: OnChange
): FieldEditor[] {
    const editors: FieldEditor[] = [];

    const anchorRow = createVec2Row(container, 'Anchor', data.anchorMin, (v) => {
        const oldMin = data.anchorMin;
        const oldMax = data.anchorMax;
        onChange([
            { property: 'anchorMin', oldValue: oldMin, newValue: { ...v } },
            { property: 'anchorMax', oldValue: oldMax, newValue: { ...v } },
        ]);
    });
    editors.push({
        update(d) { anchorRow.update(d.anchorMin); },
        dispose() { anchorRow.dispose(); },
    });

    const posRow = createVec2Row(container, 'Position', data.offsetMin, (v) => {
        onChange([{ property: 'offsetMin', oldValue: data.offsetMin, newValue: { ...v } }]);
    });
    editors.push({
        update(d) { posRow.update(d.offsetMin); },
        dispose() { posRow.dispose(); },
    });

    const sizeRow = createVec2Row(container, 'Size', data.size, (v) => {
        onChange([{ property: 'size', oldValue: data.size, newValue: { ...v } }]);
    });
    editors.push({
        update(d) { sizeRow.update(d.size); },
        dispose() { sizeRow.dispose(); },
    });

    const pivotRow = createVec2Row(container, 'Pivot', data.pivot, (v) => {
        onChange([{ property: 'pivot', oldValue: data.pivot, newValue: { ...v } }]);
    });
    editors.push({
        update(d) { pivotRow.update(d.pivot); },
        dispose() { pivotRow.dispose(); },
    });

    return editors;
}

function buildStretchModeFields(
    container: HTMLElement,
    data: UIRectData,
    onChange: OnChange
): FieldEditor[] {
    const editors: FieldEditor[] = [];

    const anchorMinRow = createVec2Row(container, 'Anchor Min', data.anchorMin, (v) => {
        onChange([{ property: 'anchorMin', oldValue: data.anchorMin, newValue: { ...v } }]);
    });
    editors.push({
        update(d) { anchorMinRow.update(d.anchorMin); },
        dispose() { anchorMinRow.dispose(); },
    });

    const anchorMaxRow = createVec2Row(container, 'Anchor Max', data.anchorMax, (v) => {
        onChange([{ property: 'anchorMax', oldValue: data.anchorMax, newValue: { ...v } }]);
    });
    editors.push({
        update(d) { anchorMaxRow.update(d.anchorMax); },
        dispose() { anchorMaxRow.dispose(); },
    });

    const lrRow = createNumberPairRow(
        container, 'Left / Right', 'L', 'R',
        data.offsetMin.x, data.offsetMax.x,
        (l, r) => {
            onChange([
                { property: 'offsetMin', oldValue: data.offsetMin, newValue: { x: l, y: data.offsetMin.y } },
                { property: 'offsetMax', oldValue: data.offsetMax, newValue: { x: r, y: data.offsetMax.y } },
            ]);
        }
    );
    editors.push({
        update(d) { lrRow.update(d.offsetMin.x, d.offsetMax.x); },
        dispose() { lrRow.dispose(); },
    });

    const btRow = createNumberPairRow(
        container, 'Bottom / Top', 'B', 'T',
        data.offsetMin.y, data.offsetMax.y,
        (b, t) => {
            onChange([
                { property: 'offsetMin', oldValue: data.offsetMin, newValue: { x: data.offsetMin.x, y: b } },
                { property: 'offsetMax', oldValue: data.offsetMax, newValue: { x: data.offsetMax.x, y: t } },
            ]);
        }
    );
    editors.push({
        update(d) { btRow.update(d.offsetMin.y, d.offsetMax.y); },
        dispose() { btRow.dispose(); },
    });

    const pivotRow = createVec2Row(container, 'Pivot', data.pivot, (v) => {
        onChange([{ property: 'pivot', oldValue: data.pivot, newValue: { ...v } }]);
    });
    editors.push({
        update(d) { pivotRow.update(d.pivot); },
        dispose() { pivotRow.dispose(); },
    });

    return editors;
}

// =============================================================================
// Main Editor
// =============================================================================

export function createUIRectEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    let data = mergeDefaults(ctx.value);
    let prevPointMode = isPointMode(data);
    const onChange = ctx.onChange as unknown as OnChange;

    const root = document.createElement('div');
    root.className = 'es-uirect-editor';

    // --- Anchor Preset Section ---
    const presetSection = document.createElement('div');
    presetSection.className = 'es-anchor-section';

    const title = document.createElement('div');
    title.className = 'es-anchor-title';
    title.textContent = 'Anchor Presets';
    presetSection.appendChild(title);

    const presetsWrap = document.createElement('div');
    presetsWrap.className = 'es-anchor-presets';

    const gridGroup = document.createElement('div');
    gridGroup.className = 'es-anchor-group';
    const grid = document.createElement('div');
    grid.className = 'es-anchor-grid';
    const gridCaption = document.createElement('div');
    gridCaption.className = 'es-anchor-caption';
    gridCaption.textContent = 'Position';
    gridGroup.appendChild(grid);
    gridGroup.appendChild(gridCaption);

    const stretchGroup = document.createElement('div');
    stretchGroup.className = 'es-anchor-group';
    const stretchCol = document.createElement('div');
    stretchCol.className = 'es-anchor-stretch';
    const stretchCaption = document.createElement('div');
    stretchCaption.className = 'es-anchor-caption';
    stretchCaption.textContent = 'Stretch';
    stretchGroup.appendChild(stretchCol);
    stretchGroup.appendChild(stretchCaption);

    const presetCells: { el: HTMLButtonElement; preset: AnchorPreset }[] = [];

    const modeLabel = document.createElement('div');
    modeLabel.className = 'es-anchor-mode-label';
    let hoveredPreset: AnchorPreset | null = null;

    function refreshModeLabel(): void {
        if (hoveredPreset) {
            modeLabel.textContent = hoveredPreset.label;
            return;
        }
        const match = findMatchingPreset(data);
        modeLabel.textContent = match ? match.label : 'Custom';
    }

    function createCell(preset: AnchorPreset, parent: HTMLElement): void {
        const btn = document.createElement('button');
        btn.className = 'es-anchor-cell';
        btn.title = preset.label;
        btn.innerHTML = makeSvg(preset.svg);

        btn.addEventListener('mouseenter', () => {
            hoveredPreset = preset;
            refreshModeLabel();
        });
        btn.addEventListener('mouseleave', () => {
            hoveredPreset = null;
            refreshModeLabel();
        });

        btn.addEventListener('click', () => {
            const changes: PropertyChange[] = [
                { property: 'anchorMin', oldValue: data.anchorMin, newValue: { ...preset.anchorMin } },
                { property: 'anchorMax', oldValue: data.anchorMax, newValue: { ...preset.anchorMax } },
                { property: 'offsetMin', oldValue: data.offsetMin, newValue: { x: 0, y: 0 } },
            ];
            const isStretch = !vec2Eq(preset.anchorMin, preset.anchorMax);
            if (isStretch) {
                changes.push({ property: 'offsetMax', oldValue: data.offsetMax, newValue: { x: 0, y: 0 } });
            }
            onChange(changes);
        });

        presetCells.push({ el: btn, preset });
        parent.appendChild(btn);
    }

    for (const p of POINT_PRESETS) createCell(p, grid);
    for (const p of STRETCH_PRESETS) createCell(p, stretchCol);

    presetsWrap.appendChild(gridGroup);
    presetsWrap.appendChild(stretchGroup);
    presetSection.appendChild(presetsWrap);
    presetSection.appendChild(modeLabel);

    root.appendChild(presetSection);

    // --- Fields Container ---
    const fieldsContainer = document.createElement('div');
    fieldsContainer.className = 'es-uirect-fields';
    root.appendChild(fieldsContainer);

    container.appendChild(root);

    // --- State ---
    let fieldEditors: FieldEditor[] = [];

    function updatePresetHighlight(): void {
        const match = findMatchingPreset(data);
        for (const cell of presetCells) {
            cell.el.classList.toggle('es-active', match !== null && cell.preset.name === match.name);
        }
        refreshModeLabel();
    }

    function disposeFields(): void {
        for (const fe of fieldEditors) fe.dispose();
        fieldEditors = [];
    }

    function rebuild(): void {
        disposeFields();
        prevPointMode = isPointMode(data);
        fieldEditors = prevPointMode
            ? buildPointModeFields(fieldsContainer, data, onChange)
            : buildStretchModeFields(fieldsContainer, data, onChange);
        updatePresetHighlight();
    }

    rebuild();

    return {
        update(value: unknown) {
            data = mergeDefaults(value);
            updatePresetHighlight();
            const currentPointMode = isPointMode(data);
            if (currentPointMode !== prevPointMode) {
                rebuild();
            } else {
                for (const fe of fieldEditors) fe.update(data);
            }
        },
        dispose() {
            disposeFields();
            root.remove();
        },
    };
}
