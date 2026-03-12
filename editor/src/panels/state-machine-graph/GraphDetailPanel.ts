const CHEVRON_RIGHT_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 6 15 12 9 18"></polyline></svg>`;
const CHEVRON_DOWN_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
const CLOSE_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 6 9 12 15 18"></polyline></svg>`;
const REMOVE_SVG = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

const EASING_OPTIONS = ['linear', 'easeInQuad', 'easeOutQuad', 'easeInOutQuad', 'easeInCubic', 'easeOutCubic', 'easeInOutCubic', 'easeInBack', 'easeOutBack', 'easeInOutBack', 'easeOutBounce'];
const COMPARATOR_OPTIONS = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte'];
const COMPARATOR_LABELS: Record<string, string> = { eq: '=', neq: '\u2260', gt: '>', lt: '<', gte: '\u2265', lte: '\u2264' };
const WRAP_MODE_OPTIONS = ['loop', 'once'];
const STATE_TYPE_OPTIONS = ['standard', 'blend1d', 'blendDirect'];

const DETAIL_WIDTH = 260;
const COLLAPSED_WIDTH = 24;

interface Condition {
    inputName: string;
    comparator: string;
    value: boolean | number;
}

interface Transition {
    target: string;
    conditions: Condition[];
    duration: number;
    exitTime?: number;
    easing?: string;
}

interface BlendEntry {
    timeline?: string;
    timelineWrapMode?: 'once' | 'loop';
    properties?: Record<string, unknown>;
    threshold?: number;
    mixValue?: number;
    mixInput?: string;
}

interface StateNode {
    timeline?: string;
    timelineWrapMode?: 'once' | 'loop';
    properties?: Record<string, unknown>;
    transitions: Transition[];
    type?: 'standard' | 'blend1d' | 'blendDirect';
    blendInput?: string;
    blendStates?: BlendEntry[];
}

interface InputDef {
    name: string;
    type: 'bool' | 'number' | 'trigger';
    defaultValue?: boolean | number;
}

export interface DetailPanelCallbacks {
    onStateChanged(stateName: string, field: string, value: unknown): void;
    onTransitionChanged(fromState: string, transitionIndex: number, field: string, value: unknown): void;
    onSelectTransition(fromState: string, index: number): void;
    onAddTransitionCondition(fromState: string, transitionIndex: number): void;
    onRemoveTransitionCondition(fromState: string, transitionIndex: number, conditionIndex: number): void;
    onAddProperty(stateName: string, key: string): void;
    onRemoveProperty(stateName: string, key: string): void;
    onRenameProperty(stateName: string, oldKey: string, newKey: string): void;
    onPropertyValueChanged(stateName: string, key: string, value: unknown): void;
    onAddBlendEntry?(stateName: string): void;
    onRemoveBlendEntry?(stateName: string, index: number): void;
    onUpdateBlendEntry?(stateName: string, index: number, field: string, value: unknown): void;
}

export class GraphDetailPanel {
    private el_: HTMLElement;
    private expandedContent_: HTMLElement;
    private collapsedBar_: HTMLElement;
    private callbacks_: DetailPanelCallbacks;
    private visible_ = false;
    private collapsed_ = false;
    private collapsedSections_ = new Set<string>();

    private pendingState_: { name: string; state: StateNode; inputs: InputDef[] } | null = null;
    private pendingTransition_: { from: string; target: string; index: number; transition: Transition; inputs: InputDef[] } | null = null;

    constructor(parent: HTMLElement, callbacks: DetailPanelCallbacks) {
        this.callbacks_ = callbacks;

        this.el_ = document.createElement('div');
        this.el_.className = 'es-graph-detail';
        this.el_.style.cssText = 'display:none;height:100%;flex-shrink:0;';
        parent.appendChild(this.el_);

        this.collapsedBar_ = document.createElement('div');
        this.collapsedBar_.style.cssText = `display:none;flex-direction:column;align-items:center;width:${COLLAPSED_WIDTH}px;height:100%;background:var(--es-bg-secondary, #252526);border-left:1px solid var(--es-border, #333);cursor:pointer;font-size:11px;color:var(--es-text-muted, #888);padding:6px 0;box-sizing:border-box;user-select:none;overflow:hidden;`;
        this.collapsedBar_.addEventListener('click', () => this.setCollapsed(false));
        this.el_.appendChild(this.collapsedBar_);

        this.expandedContent_ = document.createElement('div');
        this.expandedContent_.style.cssText = `display:flex;flex-direction:column;width:${DETAIL_WIDTH}px;height:100%;background:var(--es-bg-secondary, #252526);border-left:1px solid var(--es-border, #333);overflow:hidden;`;
        this.el_.appendChild(this.expandedContent_);
    }

    get visible(): boolean {
        return this.visible_;
    }

    hide(): void {
        if (!this.visible_) return;
        this.visible_ = false;
        this.el_.style.display = 'none';
        this.pendingState_ = null;
        this.pendingTransition_ = null;
    }

    showState(name: string, state: StateNode, inputs: InputDef[]): void {
        this.visible_ = true;
        this.el_.style.display = 'flex';
        this.pendingState_ = { name, state, inputs };
        this.pendingTransition_ = null;
        this.renderCurrent();
    }

    showTransition(fromState: string, targetState: string, index: number, transition: Transition, inputs: InputDef[]): void {
        this.visible_ = true;
        this.el_.style.display = 'flex';
        this.pendingState_ = null;
        this.pendingTransition_ = { from: fromState, target: targetState, index, transition, inputs };
        this.renderCurrent();
    }

    dispose(): void {
        this.el_.remove();
    }

    private setCollapsed(collapsed: boolean): void {
        this.collapsed_ = collapsed;
        this.renderCurrent();
    }

    private renderCurrent(): void {
        if (this.collapsed_) {
            this.collapsedBar_.style.display = 'flex';
            this.expandedContent_.style.display = 'none';
            let label = 'Details';
            if (this.pendingState_) label = this.pendingState_.name;
            else if (this.pendingTransition_) label = `${this.pendingTransition_.from} \u2192 ${this.pendingTransition_.target}`;
            this.collapsedBar_.innerHTML = '';
            const chevron = document.createElement('span');
            chevron.innerHTML = CHEVRON_RIGHT_SVG;
            chevron.style.cssText = 'display:flex;align-items:center;justify-content:center;flex-shrink:0;transform:rotate(180deg);margin-bottom:4px;';
            this.collapsedBar_.appendChild(chevron);
            const text = document.createElement('span');
            text.textContent = label;
            text.style.cssText = 'writing-mode:vertical-rl;text-orientation:mixed;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-height:calc(100% - 24px);';
            this.collapsedBar_.appendChild(text);
            return;
        }

        this.collapsedBar_.style.display = 'none';
        this.expandedContent_.style.display = 'flex';
        this.expandedContent_.innerHTML = '';

        this.renderToolbar();

        const body = document.createElement('div');
        body.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;padding:10px 12px;';
        this.expandedContent_.appendChild(body);

        if (this.pendingState_) {
            this.renderStateView(body, this.pendingState_.name, this.pendingState_.state, this.pendingState_.inputs);
        } else if (this.pendingTransition_) {
            const p = this.pendingTransition_;
            this.renderTransitionView(body, p.from, p.target, p.index, p.transition, p.inputs);
        }
    }

    private renderToolbar(): void {
        const bar = document.createElement('div');
        bar.style.cssText = 'display:flex;align-items:center;height:28px;min-height:28px;padding:0 4px 0 10px;background:var(--es-bg-tertiary, #2d2d2d);border-bottom:1px solid var(--es-border, #333);gap:4px;';

        const title = document.createElement('span');
        title.style.cssText = 'flex:1;font-size:11px;font-weight:600;color:var(--es-text-secondary, #ccc);text-transform:uppercase;letter-spacing:0.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        if (this.pendingState_) title.textContent = this.pendingState_.name;
        else if (this.pendingTransition_) title.textContent = `${this.pendingTransition_.from} \u2192 ${this.pendingTransition_.target}`;
        bar.appendChild(title);

        const collapseBtn = document.createElement('button');
        collapseBtn.className = 'es-btn es-btn-icon es-btn-clear';
        collapseBtn.style.cssText = 'width:22px;height:22px;padding:0;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
        collapseBtn.title = 'Collapse panel';
        collapseBtn.innerHTML = CLOSE_SVG;
        collapseBtn.addEventListener('click', () => this.setCollapsed(true));
        bar.appendChild(collapseBtn);

        this.expandedContent_.appendChild(bar);
    }

    // =========================================================================
    // State View
    // =========================================================================

    private renderStateView(container: HTMLElement, name: string, state: StateNode, inputs: InputDef[]): void {
        const stateType = state.type ?? 'standard';

        this.appendFieldRow(container, 'Type', () => {
            return this.createSelect(STATE_TYPE_OPTIONS, stateType, (val) => {
                this.callbacks_.onStateChanged(name, 'type', val === 'standard' ? undefined : val);
            });
        });

        if (stateType === 'standard') {
            this.appendFieldRow(container, 'Timeline', () => {
                const input = this.createTextInput(state.timeline ?? '', (val) => {
                    this.callbacks_.onStateChanged(name, 'timeline', val || undefined);
                });
                input.placeholder = 'path/to/timeline';
                return input;
            });

            this.appendFieldRow(container, 'Wrap Mode', () => {
                return this.createSelect(WRAP_MODE_OPTIONS, state.timelineWrapMode ?? 'loop', (val) => {
                    this.callbacks_.onStateChanged(name, 'timelineWrapMode', val);
                });
            });

            this.renderCollapsibleSection(container, 'properties', 'Properties', state.properties ? Object.keys(state.properties).length : 0, (body) => {
                this.renderPropertiesContent(body, name, state.properties ?? {});
            }, () => {
                const existing = state.properties ?? {};
                let key = 'newProperty';
                let i = 1;
                while (key in existing) { key = `newProperty${i++}`; }
                this.callbacks_.onAddProperty(name, key);
            });
        } else if (stateType === 'blend1d') {
            const numberInputs = inputs.filter(i => i.type === 'number');
            this.appendFieldRow(container, 'Blend Input', () => {
                const options = numberInputs.map(i => i.name);
                if (options.length === 0) options.push('');
                return this.createSelect(options, state.blendInput ?? options[0] ?? '', (val) => {
                    this.callbacks_.onStateChanged(name, 'blendInput', val || undefined);
                });
            });

            this.renderCollapsibleSection(container, 'blendStates', 'Blend Entries', state.blendStates?.length ?? 0, (body) => {
                this.renderBlend1DContent(body, name, state.blendStates ?? []);
            }, () => {
                this.callbacks_.onAddBlendEntry?.(name);
            });
        } else if (stateType === 'blendDirect') {
            this.renderCollapsibleSection(container, 'blendStates', 'Blend Entries', state.blendStates?.length ?? 0, (body) => {
                this.renderBlendDirectContent(body, name, state.blendStates ?? [], inputs);
            }, () => {
                this.callbacks_.onAddBlendEntry?.(name);
            });
        }

        this.renderCollapsibleSection(container, 'transitions', 'Transitions', state.transitions?.length ?? 0, (body) => {
            this.renderTransitionsListContent(body, name, state.transitions ?? []);
        });
    }

    private renderPropertiesContent(container: HTMLElement, stateName: string, properties: Record<string, unknown>): void {
        for (const [key, value] of Object.entries(properties)) {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:4px;padding:2px 0;';

            const keyInput = document.createElement('input');
            keyInput.className = 'es-input';
            keyInput.style.cssText = 'flex:1;min-width:0;font-size:11px;padding:2px 4px;height:20px;';
            keyInput.value = key;
            keyInput.addEventListener('change', () => {
                const newKey = keyInput.value.trim();
                if (newKey && newKey !== key && !(newKey in properties)) {
                    this.callbacks_.onRenameProperty(stateName, key, newKey);
                } else {
                    keyInput.value = key;
                }
            });

            const valInput = document.createElement('input');
            valInput.className = 'es-input';
            valInput.style.cssText = 'width:64px;flex-shrink:0;font-size:11px;padding:2px 4px;height:20px;';
            valInput.value = String(value ?? '');
            valInput.addEventListener('change', () => {
                this.callbacks_.onPropertyValueChanged(stateName, key, parsePropertyValue(valInput.value));
            });

            const removeBtn = this.createRemoveBtn();
            removeBtn.addEventListener('click', () => {
                this.callbacks_.onRemoveProperty(stateName, key);
            });

            row.appendChild(keyInput);
            row.appendChild(valInput);
            row.appendChild(removeBtn);
            container.appendChild(row);
        }

        if (Object.keys(properties).length === 0) {
            this.appendEmptyHint(container, 'No properties');
        }
    }

    private renderBlend1DContent(container: HTMLElement, stateName: string, entries: BlendEntry[]): void {
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const row = document.createElement('div');
            row.style.cssText = 'padding:4px 0;border-bottom:1px solid var(--es-border, #333);';

            const headerRow = document.createElement('div');
            headerRow.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:4px;';

            const threshLabel = document.createElement('span');
            threshLabel.style.cssText = 'font-size:10px;color:var(--es-text-muted, #888);width:50px;flex-shrink:0;';
            threshLabel.textContent = 'Threshold';

            const threshInput = document.createElement('input');
            threshInput.className = 'es-input es-input-number';
            threshInput.type = 'number';
            threshInput.step = '0.1';
            threshInput.style.cssText = 'font-size:11px;padding:2px 4px;height:20px;flex:1;min-width:0;';
            threshInput.value = String(entry.threshold ?? 0);
            const idx = i;
            threshInput.addEventListener('change', () => {
                this.callbacks_.onUpdateBlendEntry?.(stateName, idx, 'threshold', parseFloat(threshInput.value) || 0);
            });

            const removeBtn = this.createRemoveBtn();
            removeBtn.addEventListener('click', () => {
                this.callbacks_.onRemoveBlendEntry?.(stateName, idx);
            });

            headerRow.appendChild(threshLabel);
            headerRow.appendChild(threshInput);
            headerRow.appendChild(removeBtn);
            row.appendChild(headerRow);

            this.renderBlendEntryProperties(row, stateName, i, entry);
            container.appendChild(row);
        }

        if (entries.length === 0) {
            this.appendEmptyHint(container, 'No blend entries');
        }
    }

    private renderBlendDirectContent(container: HTMLElement, stateName: string, entries: BlendEntry[], inputs: InputDef[]): void {
        const numberInputs = inputs.filter(inp => inp.type === 'number');

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const row = document.createElement('div');
            row.style.cssText = 'padding:4px 0;border-bottom:1px solid var(--es-border, #333);';

            const headerRow = document.createElement('div');
            headerRow.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:4px;';

            const mixLabel = document.createElement('span');
            mixLabel.style.cssText = 'font-size:10px;color:var(--es-text-muted, #888);width:24px;flex-shrink:0;';
            mixLabel.textContent = 'Mix';

            const idx = i;

            if (entry.mixInput) {
                const options = numberInputs.map(inp => inp.name);
                if (options.length === 0) options.push('');
                const sel = this.createMiniSelect(options, entry.mixInput);
                sel.style.cssText += 'flex:1;min-width:0;';
                sel.addEventListener('change', () => {
                    this.callbacks_.onUpdateBlendEntry?.(stateName, idx, 'mixInput', sel.value || undefined);
                });
                headerRow.appendChild(mixLabel);
                headerRow.appendChild(sel);
            } else {
                const mixInput = document.createElement('input');
                mixInput.className = 'es-input es-input-number';
                mixInput.type = 'number';
                mixInput.step = '0.1';
                mixInput.min = '0';
                mixInput.max = '1';
                mixInput.style.cssText = 'font-size:11px;padding:2px 4px;height:20px;flex:1;min-width:0;';
                mixInput.value = String(entry.mixValue ?? 1);
                mixInput.addEventListener('change', () => {
                    this.callbacks_.onUpdateBlendEntry?.(stateName, idx, 'mixValue', parseFloat(mixInput.value) || 0);
                });
                headerRow.appendChild(mixLabel);
                headerRow.appendChild(mixInput);
            }

            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'es-btn es-btn-icon es-btn-clear';
            toggleBtn.style.cssText = 'font-size:9px;width:18px;height:18px;padding:0;flex-shrink:0;';
            toggleBtn.title = entry.mixInput ? 'Switch to static value' : 'Switch to input-driven';
            toggleBtn.textContent = entry.mixInput ? 'V' : 'I';
            toggleBtn.addEventListener('click', () => {
                if (entry.mixInput) {
                    this.callbacks_.onUpdateBlendEntry?.(stateName, idx, 'mixInput', undefined);
                    this.callbacks_.onUpdateBlendEntry?.(stateName, idx, 'mixValue', 1);
                } else {
                    const firstNum = numberInputs[0]?.name ?? '';
                    this.callbacks_.onUpdateBlendEntry?.(stateName, idx, 'mixValue', undefined);
                    this.callbacks_.onUpdateBlendEntry?.(stateName, idx, 'mixInput', firstNum);
                }
            });

            const removeBtn = this.createRemoveBtn();
            removeBtn.addEventListener('click', () => {
                this.callbacks_.onRemoveBlendEntry?.(stateName, idx);
            });

            headerRow.appendChild(toggleBtn);
            headerRow.appendChild(removeBtn);
            row.appendChild(headerRow);

            this.renderBlendEntryProperties(row, stateName, i, entry);
            container.appendChild(row);
        }

        if (entries.length === 0) {
            this.appendEmptyHint(container, 'No blend entries');
        }
    }

    private renderBlendEntryProperties(container: HTMLElement, stateName: string, entryIndex: number, entry: BlendEntry): void {
        const props = entry.properties ?? {};
        for (const [key, value] of Object.entries(props)) {
            const propRow = document.createElement('div');
            propRow.style.cssText = 'display:flex;align-items:center;gap:4px;padding:1px 0 1px 8px;';

            const keyEl = document.createElement('span');
            keyEl.style.cssText = 'flex:1;min-width:0;font-size:10px;color:var(--es-text-secondary, #aaa);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            keyEl.textContent = key;

            const valInput = document.createElement('input');
            valInput.className = 'es-input';
            valInput.style.cssText = 'width:50px;flex-shrink:0;font-size:10px;padding:1px 4px;height:18px;';
            valInput.value = String(value ?? '');
            valInput.addEventListener('change', () => {
                const newProps = { ...(entry.properties ?? {}), [key]: parsePropertyValue(valInput.value) };
                this.callbacks_.onUpdateBlendEntry?.(stateName, entryIndex, 'properties', newProps);
            });

            propRow.appendChild(keyEl);
            propRow.appendChild(valInput);
            container.appendChild(propRow);
        }
    }

    private renderTransitionsListContent(container: HTMLElement, stateName: string, transitions: Transition[]): void {
        for (let i = 0; i < transitions.length; i++) {
            const t = transitions[i];
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:4px;padding:3px 4px;border-radius:3px;cursor:pointer;font-size:11px;color:var(--es-text-primary, #ddd);';
            row.addEventListener('mouseenter', () => { row.style.background = 'var(--es-bg-hover, #333)'; });
            row.addEventListener('mouseleave', () => { row.style.background = ''; });

            const arrow = document.createElement('span');
            arrow.style.cssText = 'color:var(--es-text-muted, #888);flex-shrink:0;';
            arrow.textContent = '\u2192';

            const label = document.createElement('span');
            label.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            const parts = [t.target];
            if (t.duration > 0) parts.push(`${t.duration}s`);
            if (t.conditions?.length > 0) parts.push(`${t.conditions.length} cond`);
            label.textContent = parts.join('  ');

            row.appendChild(arrow);
            row.appendChild(label);

            const idx = i;
            row.addEventListener('click', () => this.callbacks_.onSelectTransition(stateName, idx));
            container.appendChild(row);
        }

        if (transitions.length === 0) {
            this.appendEmptyHint(container, 'No transitions');
        }
    }

    // =========================================================================
    // Transition View
    // =========================================================================

    private renderTransitionView(container: HTMLElement, fromState: string, targetState: string, index: number, transition: Transition, inputs: InputDef[]): void {
        this.appendFieldRow(container, 'Duration', () => {
            return this.createNumberInput(transition.duration, (val) => {
                this.callbacks_.onTransitionChanged(fromState, index, 'duration', val);
            }, 's');
        });

        this.appendFieldRow(container, 'Exit Time', () => {
            return this.createNumberInput(transition.exitTime ?? 0, (val) => {
                this.callbacks_.onTransitionChanged(fromState, index, 'exitTime', val > 0 ? val : undefined);
            }, 'none');
        });

        this.appendFieldRow(container, 'Easing', () => {
            return this.createSelect(EASING_OPTIONS, transition.easing ?? 'linear', (val) => {
                this.callbacks_.onTransitionChanged(fromState, index, 'easing', val === 'linear' ? undefined : val);
            });
        });

        this.renderCollapsibleSection(container, 'conditions', 'Conditions', transition.conditions?.length ?? 0, (body) => {
            this.renderConditionsContent(body, fromState, index, transition.conditions ?? [], inputs);
        }, () => {
            this.callbacks_.onAddTransitionCondition(fromState, index);
        });
    }

    private renderConditionsContent(container: HTMLElement, fromState: string, transitionIndex: number, conditions: Condition[], inputs: InputDef[]): void {
        const inputNames = inputs.map(i => i.name);

        for (let i = 0; i < conditions.length; i++) {
            const c = conditions[i];
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:3px;padding:2px 0;';

            const nameSelect = this.createMiniSelect(
                inputNames.length > 0 ? inputNames : [c.inputName || ''],
                c.inputName || '',
            );
            nameSelect.style.cssText += 'flex:1;min-width:0;';
            nameSelect.addEventListener('change', () => {
                this.callbacks_.onTransitionChanged(fromState, transitionIndex, `conditions.${i}.inputName`, nameSelect.value);
            });

            const compSelect = this.createMiniSelect(
                COMPARATOR_OPTIONS,
                c.comparator || 'eq',
                COMPARATOR_LABELS,
            );
            compSelect.style.cssText += 'width:40px;flex-shrink:0;text-align:center;';
            compSelect.addEventListener('change', () => {
                this.callbacks_.onTransitionChanged(fromState, transitionIndex, `conditions.${i}.comparator`, compSelect.value);
            });

            const valInput = document.createElement('input');
            valInput.className = 'es-input';
            valInput.style.cssText = 'width:40px;flex-shrink:0;font-size:11px;padding:2px 4px;height:20px;';
            valInput.value = String(c.value ?? '');
            valInput.addEventListener('change', () => {
                this.callbacks_.onTransitionChanged(fromState, transitionIndex, `conditions.${i}.value`, parsePropertyValue(valInput.value));
            });

            const removeBtn = this.createRemoveBtn();
            const ci = i;
            removeBtn.addEventListener('click', () => {
                this.callbacks_.onRemoveTransitionCondition(fromState, transitionIndex, ci);
            });

            row.appendChild(nameSelect);
            row.appendChild(compSelect);
            row.appendChild(valInput);
            row.appendChild(removeBtn);
            container.appendChild(row);
        }

        if (conditions.length === 0) {
            this.appendEmptyHint(container, 'No conditions (always fires)');
        }
    }

    // =========================================================================
    // Reusable Layout Components
    // =========================================================================

    private appendFieldRow(container: HTMLElement, label: string, createControl: () => HTMLElement): void {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';

        const labelEl = document.createElement('span');
        labelEl.style.cssText = 'width:72px;flex-shrink:0;font-size:11px;color:var(--es-text-secondary, #aaa);';
        labelEl.textContent = label;

        const control = createControl();
        control.style.cssText += ';flex:1;min-width:0;';

        row.appendChild(labelEl);
        row.appendChild(control);
        container.appendChild(row);
    }

    private renderCollapsibleSection(
        container: HTMLElement,
        id: string,
        title: string,
        count: number,
        renderBody: (body: HTMLElement) => void,
        onAdd?: () => void,
    ): void {
        const expanded = !this.collapsedSections_.has(id);

        const section = document.createElement('div');
        section.style.cssText = 'margin-top:8px;';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;gap:4px;padding:4px 0;cursor:pointer;user-select:none;';
        header.addEventListener('mouseenter', () => { header.style.background = 'var(--es-bg-hover, #333)'; });
        header.addEventListener('mouseleave', () => { header.style.background = ''; });

        const chevron = document.createElement('span');
        chevron.style.cssText = `display:flex;align-items:center;transition:transform 0.15s;transform:rotate(${expanded ? '90deg' : '0deg'});color:var(--es-text-muted, #888);`;
        chevron.innerHTML = CHEVRON_RIGHT_SVG;

        const labelEl = document.createElement('span');
        labelEl.style.cssText = 'flex:1;font-size:11px;font-weight:600;color:var(--es-text-secondary, #ccc);';
        labelEl.textContent = title;

        const badge = document.createElement('span');
        badge.style.cssText = 'font-size:10px;color:var(--es-text-muted, #888);margin-right:2px;';
        badge.textContent = count > 0 ? String(count) : '';

        header.appendChild(chevron);
        header.appendChild(labelEl);
        header.appendChild(badge);

        if (onAdd) {
            const addBtn = document.createElement('button');
            addBtn.className = 'es-btn es-btn-icon es-btn-clear';
            addBtn.style.cssText = 'font-size:13px;width:18px;height:18px;line-height:18px;padding:0;flex-shrink:0;';
            addBtn.textContent = '+';
            addBtn.title = `Add`;
            addBtn.addEventListener('click', (e) => { e.stopPropagation(); onAdd(); });
            header.appendChild(addBtn);
        }

        const body = document.createElement('div');
        body.style.cssText = `padding:2px 0 2px 18px;${expanded ? '' : 'display:none;'}`;

        header.addEventListener('click', () => {
            const isExpanded = body.style.display !== 'none';
            body.style.display = isExpanded ? 'none' : 'block';
            chevron.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(90deg)';
            if (isExpanded) this.collapsedSections_.add(id);
            else this.collapsedSections_.delete(id);
        });

        renderBody(body);

        section.appendChild(header);
        section.appendChild(body);
        container.appendChild(section);
    }

    // =========================================================================
    // DOM Helpers
    // =========================================================================

    private appendEmptyHint(container: HTMLElement, text: string): void {
        const el = document.createElement('div');
        el.style.cssText = 'color:var(--es-text-muted, #666);font-size:10px;font-style:italic;padding:2px 0;';
        el.textContent = text;
        container.appendChild(el);
    }

    private createTextInput(value: string, onChange: (val: string) => void): HTMLInputElement {
        const input = document.createElement('input');
        input.className = 'es-input';
        input.style.cssText = 'font-size:11px;padding:2px 6px;height:22px;box-sizing:border-box;';
        input.value = value;
        input.addEventListener('change', () => onChange(input.value));
        return input;
    }

    private createNumberInput(value: number, onChange: (val: number) => void, suffix?: string): HTMLElement {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;align-items:center;gap:4px;';

        const input = document.createElement('input');
        input.className = 'es-input es-input-number';
        input.type = 'number';
        input.step = '0.01';
        input.style.cssText = 'font-size:11px;padding:2px 6px;height:22px;box-sizing:border-box;flex:1;min-width:0;';
        input.value = value ? String(value) : '';
        if (suffix === 'none') input.placeholder = 'none';
        input.addEventListener('change', () => onChange(parseFloat(input.value) || 0));
        wrap.appendChild(input);

        if (suffix && suffix !== 'none') {
            const s = document.createElement('span');
            s.style.cssText = 'font-size:10px;color:var(--es-text-muted, #888);flex-shrink:0;';
            s.textContent = suffix;
            wrap.appendChild(s);
        }

        return wrap;
    }

    private createSelect(options: string[], value: string, onChange: (val: string) => void): HTMLSelectElement {
        const sel = document.createElement('select');
        sel.className = 'es-input es-input-select';
        sel.style.cssText = 'font-size:11px;padding:2px 4px;height:22px;box-sizing:border-box;';
        for (const opt of options) {
            const o = document.createElement('option');
            o.value = opt;
            o.textContent = opt;
            sel.appendChild(o);
        }
        sel.value = value;
        sel.addEventListener('change', () => onChange(sel.value));
        return sel;
    }

    private createMiniSelect(options: string[], value: string, labels?: Record<string, string>): HTMLSelectElement {
        const sel = document.createElement('select');
        sel.className = 'es-input es-input-select';
        sel.style.cssText = 'font-size:11px;padding:1px 2px;height:20px;box-sizing:border-box;';
        for (const opt of options) {
            const o = document.createElement('option');
            o.value = opt;
            o.textContent = labels?.[opt] ?? opt;
            sel.appendChild(o);
        }
        sel.value = value;
        return sel;
    }

    private createRemoveBtn(): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.className = 'es-btn es-btn-icon es-btn-clear';
        btn.title = 'Remove';
        btn.innerHTML = REMOVE_SVG;
        btn.style.cssText = 'flex-shrink:0;width:16px;height:16px;padding:0;';
        return btn;
    }
}

function parsePropertyValue(raw: string): unknown {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    const num = Number(raw);
    if (!isNaN(num) && raw.trim() !== '') return num;
    return raw;
}
