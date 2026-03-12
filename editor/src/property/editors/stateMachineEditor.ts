import type { PropertyEditorContext, PropertyEditorInstance } from '../PropertyEditor';

interface InputDef {
    name: string;
    type: 'bool' | 'number' | 'trigger';
    defaultValue?: boolean | number;
}

interface ListenerDef {
    event: 'pointerEnter' | 'pointerExit' | 'pointerDown' | 'pointerUp';
    inputName: string;
    action: 'set' | 'reset' | 'toggle';
    value?: boolean | number;
}

interface Condition {
    inputName: string;
    comparator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte';
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

interface LayerData {
    name: string;
    states: Record<string, StateNode>;
    initialState: string;
}

interface StateMachineData {
    states: Record<string, StateNode>;
    inputs: InputDef[];
    listeners: ListenerDef[];
    initialState: string;
    layers?: LayerData[];
}

const CHEVRON_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
const REMOVE_SVG = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

const EVENT_OPTIONS = ['pointerEnter', 'pointerExit', 'pointerDown', 'pointerUp'];
const ACTION_OPTIONS = ['set', 'reset', 'toggle'];
const INPUT_TYPE_OPTIONS = ['bool', 'number', 'trigger'];
const COMPARATOR_OPTIONS = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte'];
const EASING_OPTIONS = ['linear', 'easeInQuad', 'easeOutQuad', 'easeInOutQuad', 'easeInCubic', 'easeOutCubic', 'easeInOutCubic', 'easeInBack', 'easeOutBack', 'easeInOutBack', 'easeOutBounce'];

function cloneData(data: StateMachineData): StateMachineData {
    return JSON.parse(JSON.stringify(data));
}

function defaultData(): StateMachineData {
    return { states: {}, inputs: [], listeners: [], initialState: '' };
}

function createSelect(options: string[], value: string, cls?: string): HTMLSelectElement {
    const sel = document.createElement('select');
    sel.className = cls ?? 'es-input es-input-select es-sm-select';
    for (const opt of options) {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        sel.appendChild(o);
    }
    sel.value = value;
    return sel;
}

function createRemoveBtn(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'es-btn es-btn-icon es-btn-clear';
    btn.title = 'Remove';
    btn.innerHTML = REMOVE_SVG;
    return btn;
}

function createAddBtn(label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'es-btn es-btn-sm es-btn-add-item';
    btn.textContent = `+ ${label}`;
    return btn;
}

export function createStateMachineEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    let data = ctx.componentData
        ? cloneData(ctx.componentData as unknown as StateMachineData)
        : defaultData();
    let prevData = cloneData(data);

    const collapsedSections = new Set<string>();

    function createSection(title: string, expanded: boolean, sectionId?: string): { section: HTMLElement; content: HTMLElement } {
        const key = sectionId ?? title;
        const section = document.createElement('div');
        section.className = 'es-sm-section es-collapsible';
        if (!collapsedSections.has(key) && expanded) section.classList.add('es-expanded');
        if (sectionId) section.dataset.section = sectionId;

        const header = document.createElement('div');
        header.className = 'es-sm-section-header';
        const icon = document.createElement('span');
        icon.className = 'es-collapse-icon';
        icon.innerHTML = CHEVRON_SVG;
        const label = document.createElement('span');
        label.className = 'es-sm-section-title';
        label.textContent = title;
        header.appendChild(icon);
        header.appendChild(label);

        const content = document.createElement('div');
        content.className = 'es-collapsible-content es-sm-section-body';

        header.addEventListener('click', () => {
            section.classList.toggle('es-expanded');
            if (section.classList.contains('es-expanded')) {
                collapsedSections.delete(key);
            } else {
                collapsedSections.add(key);
            }
        });

        section.appendChild(header);
        section.appendChild(content);
        return { section, content };
    }

    const propertyRow = container.closest('.es-property-row');
    if (propertyRow) (propertyRow as HTMLElement).style.display = 'none';

    const root = document.createElement('div');
    root.className = 'es-sm-editor';
    const insertTarget = propertyRow?.parentElement ?? container;
    insertTarget.appendChild(root);

    function emit() {
        const changes: { property: string; oldValue: unknown; newValue: unknown }[] = [];
        for (const key of ['states', 'inputs', 'listeners', 'initialState'] as const) {
            const oldVal = prevData[key];
            const newVal = data[key];
            if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
                changes.push({ property: key, oldValue: cloneData(oldVal as any), newValue: cloneData(newVal as any) });
            }
        }
        if (changes.length > 0) {
            prevData = cloneData(data);
            ctx.onChange(changes);
        }
    }

    function getInputNames(): string[] {
        return data.inputs.map(i => i.name);
    }

    function getStateNames(): string[] {
        return Object.keys(data.states);
    }

    // =========================================================================
    // Initial State
    // =========================================================================
    function renderInitialState() {
        const row = document.createElement('div');
        row.className = 'es-property-row es-sm-initial-row';
        const label = document.createElement('label');
        label.className = 'es-property-label';
        label.textContent = 'Initial State';
        const sel = createSelect(getStateNames(), data.initialState);
        sel.addEventListener('change', () => { data.initialState = sel.value; emit(); });
        row.appendChild(label);
        row.appendChild(sel);
        return row;
    }

    // =========================================================================
    // Inputs
    // =========================================================================
    function renderInputs(): HTMLElement {
        const { section, content } = createSection(`Inputs (${data.inputs.length})`, true, 'inputs');

        function renderList() {
            content.innerHTML = '';
            data.inputs.forEach((inp, i) => {
                const row = document.createElement('div');
                row.className = 'es-sm-list-row';

                const nameInput = document.createElement('input');
                nameInput.type = 'text';
                nameInput.className = 'es-input es-input-string es-sm-name';
                nameInput.value = inp.name;
                nameInput.placeholder = 'name';
                nameInput.addEventListener('change', () => { data.inputs[i].name = nameInput.value; emit(); rebuild(); });

                const typeSel = createSelect(INPUT_TYPE_OPTIONS, inp.type);
                typeSel.addEventListener('change', () => {
                    data.inputs[i].type = typeSel.value as InputDef['type'];
                    data.inputs[i].defaultValue = typeSel.value === 'bool' ? false : 0;
                    emit(); renderList();
                });

                row.appendChild(nameInput);
                row.appendChild(typeSel);

                if (inp.type === 'bool') {
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.className = 'es-input es-input-checkbox';
                    cb.checked = !!inp.defaultValue;
                    cb.addEventListener('change', () => { data.inputs[i].defaultValue = cb.checked; emit(); });
                    row.appendChild(cb);
                } else if (inp.type === 'number') {
                    const numInput = document.createElement('input');
                    numInput.type = 'number';
                    numInput.className = 'es-input es-input-number es-sm-num';
                    numInput.value = String(inp.defaultValue ?? 0);
                    numInput.addEventListener('change', () => { data.inputs[i].defaultValue = parseFloat(numInput.value) || 0; emit(); });
                    row.appendChild(numInput);
                }

                const rm = createRemoveBtn();
                rm.addEventListener('click', () => { data.inputs.splice(i, 1); emit(); rebuild(); });
                row.appendChild(rm);

                content.appendChild(row);
            });

            const addBtn = createAddBtn('Input');
            addBtn.addEventListener('click', () => {
                data.inputs.push({ name: `input${data.inputs.length}`, type: 'bool', defaultValue: false });
                emit(); rebuild();
            });
            content.appendChild(addBtn);
        }

        renderList();
        return section;
    }

    // =========================================================================
    // Listeners
    // =========================================================================
    function renderListeners(): HTMLElement {
        const { section, content } = createSection(`Listeners (${data.listeners.length})`, true, 'listeners');

        function renderList() {
            content.innerHTML = '';
            data.listeners.forEach((lis, i) => {
                const row = document.createElement('div');
                row.className = 'es-sm-list-row';

                const eventSel = createSelect(EVENT_OPTIONS, lis.event);
                eventSel.addEventListener('change', () => { data.listeners[i].event = eventSel.value as ListenerDef['event']; emit(); });

                const inputSel = createSelect(getInputNames(), lis.inputName);
                inputSel.addEventListener('change', () => { data.listeners[i].inputName = inputSel.value; emit(); });

                const actionSel = createSelect(ACTION_OPTIONS, lis.action);
                actionSel.addEventListener('change', () => { data.listeners[i].action = actionSel.value as ListenerDef['action']; emit(); });

                const rm = createRemoveBtn();
                rm.addEventListener('click', () => { data.listeners.splice(i, 1); emit(); rebuild(); });

                row.appendChild(eventSel);
                row.appendChild(inputSel);
                row.appendChild(actionSel);
                row.appendChild(rm);
                content.appendChild(row);
            });

            const addBtn = createAddBtn('Listener');
            addBtn.addEventListener('click', () => {
                const names = getInputNames();
                data.listeners.push({ event: 'pointerDown', inputName: names[0] ?? '', action: 'set' });
                emit(); rebuild();
            });
            content.appendChild(addBtn);
        }

        renderList();
        return section;
    }

    // =========================================================================
    // States
    // =========================================================================
    function renderCondition(cond: Condition, onChange: () => void, onRemove: () => void): HTMLElement {
        const row = document.createElement('div');
        row.className = 'es-sm-condition-row';

        const inputSel = createSelect(getInputNames(), cond.inputName);
        inputSel.addEventListener('change', () => { cond.inputName = inputSel.value; onChange(); });

        const compSel = createSelect(COMPARATOR_OPTIONS, cond.comparator);
        compSel.addEventListener('change', () => { cond.comparator = compSel.value as Condition['comparator']; onChange(); });

        const valInput = document.createElement('input');
        valInput.className = 'es-input es-input-string es-sm-val';
        valInput.value = String(cond.value);
        valInput.addEventListener('change', () => {
            const v = valInput.value;
            cond.value = v === 'true' ? true : v === 'false' ? false : parseFloat(v) || 0;
            onChange();
        });

        const rm = createRemoveBtn();
        rm.addEventListener('click', onRemove);

        row.appendChild(inputSel);
        row.appendChild(compSel);
        row.appendChild(valInput);
        row.appendChild(rm);
        return row;
    }

    function renderTransition(trans: Transition, stateNames: string[], onChange: () => void, onRemove: () => void): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'es-sm-transition';

        const headerRow = document.createElement('div');
        headerRow.className = 'es-sm-list-row';

        const targetSel = createSelect(stateNames, trans.target);
        targetSel.addEventListener('change', () => { trans.target = targetSel.value; onChange(); });

        const durInput = document.createElement('input');
        durInput.type = 'number';
        durInput.className = 'es-input es-input-number es-sm-num';
        durInput.value = String(trans.duration);
        durInput.step = '0.05';
        durInput.min = '0';
        durInput.title = 'Duration (s)';
        durInput.addEventListener('change', () => { trans.duration = parseFloat(durInput.value) || 0; onChange(); });

        const easingSel = createSelect(EASING_OPTIONS, trans.easing ?? 'linear');
        easingSel.addEventListener('change', () => { trans.easing = easingSel.value; onChange(); });

        const rm = createRemoveBtn();
        rm.addEventListener('click', onRemove);

        const arrowLabel = document.createElement('span');
        arrowLabel.className = 'es-sm-arrow';
        arrowLabel.textContent = '→';

        headerRow.appendChild(arrowLabel);
        headerRow.appendChild(targetSel);
        headerRow.appendChild(durInput);
        headerRow.appendChild(easingSel);
        headerRow.appendChild(rm);
        wrap.appendChild(headerRow);

        const condBox = document.createElement('div');
        condBox.className = 'es-sm-conditions';
        const condLabel = document.createElement('span');
        condLabel.className = 'es-sm-sub-label';
        condLabel.textContent = 'Conditions';
        condBox.appendChild(condLabel);

        for (let ci = 0; ci < trans.conditions.length; ci++) {
            condBox.appendChild(renderCondition(trans.conditions[ci], onChange, () => {
                trans.conditions.splice(ci, 1);
                onChange();
                rebuild();
            }));
        }

        const addCond = createAddBtn('Condition');
        addCond.addEventListener('click', () => {
            const names = getInputNames();
            trans.conditions.push({ inputName: names[0] ?? '', comparator: 'eq', value: true });
            onChange();
            rebuild();
        });
        condBox.appendChild(addCond);
        wrap.appendChild(condBox);

        return wrap;
    }

    function renderStates(): HTMLElement {
        const { section, content } = createSection(`States (${Object.keys(data.states).length})`, true, 'states');

        function renderList() {
            content.innerHTML = '';
            const stateNames = getStateNames();

            for (const [name, state] of Object.entries(data.states)) {
                const stateKey = `state:${name}`;
                const stateSection = document.createElement('div');
                stateSection.className = 'es-sm-state es-collapsible';
                if (!collapsedSections.has(stateKey)) stateSection.classList.add('es-expanded');

                const stateHeader = document.createElement('div');
                stateHeader.className = 'es-sm-state-header';

                const icon = document.createElement('span');
                icon.className = 'es-collapse-icon';
                icon.innerHTML = CHEVRON_SVG;

                const nameInput = document.createElement('input');
                nameInput.type = 'text';
                nameInput.className = 'es-input es-input-string es-sm-state-name';
                nameInput.value = name;
                nameInput.addEventListener('click', (e) => e.stopPropagation());
                nameInput.addEventListener('change', () => {
                    const newName = nameInput.value.trim();
                    if (!newName || newName === name || data.states[newName]) return;
                    if (collapsedSections.has(stateKey)) {
                        collapsedSections.delete(stateKey);
                        collapsedSections.add(`state:${newName}`);
                    }
                    data.states[newName] = data.states[name];
                    delete data.states[name];
                    if (data.initialState === name) data.initialState = newName;
                    for (const s of Object.values(data.states)) {
                        for (const t of s.transitions) {
                            if (t.target === name) t.target = newName;
                        }
                    }
                    emit(); rebuild();
                });

                const rmState = createRemoveBtn();
                rmState.addEventListener('click', (e) => {
                    e.stopPropagation();
                    collapsedSections.delete(stateKey);
                    delete data.states[name];
                    if (data.initialState === name) data.initialState = getStateNames()[0] ?? '';
                    emit(); rebuild();
                });

                stateHeader.appendChild(icon);
                stateHeader.appendChild(nameInput);
                stateHeader.appendChild(rmState);
                stateHeader.addEventListener('click', () => {
                    stateSection.classList.toggle('es-expanded');
                    if (stateSection.classList.contains('es-expanded')) {
                        collapsedSections.delete(stateKey);
                    } else {
                        collapsedSections.add(stateKey);
                    }
                });

                const stateBody = document.createElement('div');
                stateBody.className = 'es-collapsible-content es-sm-state-body';

                // Timeline
                const tlRow = document.createElement('div');
                tlRow.className = 'es-sm-list-row';
                const tlLabel = document.createElement('span');
                tlLabel.className = 'es-sm-sub-label';
                tlLabel.textContent = 'Timeline';
                tlLabel.style.minWidth = '56px';
                const tlInput = document.createElement('input');
                tlInput.type = 'text';
                tlInput.className = 'es-input es-input-string';
                tlInput.placeholder = 'path/to/timeline.timeline';
                tlInput.value = state.timeline ?? '';
                tlInput.addEventListener('change', () => {
                    const v = tlInput.value.trim();
                    if (v) { state.timeline = v; } else { delete state.timeline; }
                    emit();
                });
                const wrapSel = createSelect(['once', 'loop'], state.timelineWrapMode ?? 'once');
                wrapSel.style.width = '64px';
                wrapSel.addEventListener('change', () => {
                    state.timelineWrapMode = wrapSel.value as 'once' | 'loop';
                    emit();
                });
                tlRow.appendChild(tlLabel);
                tlRow.appendChild(tlInput);
                tlRow.appendChild(wrapSel);
                stateBody.appendChild(tlRow);

                // Properties
                const propLabel = document.createElement('span');
                propLabel.className = 'es-sm-sub-label es-sm-label-props';
                propLabel.textContent = 'Properties';
                stateBody.appendChild(propLabel);

                const props = state.properties ?? {};
                for (const [pKey, pVal] of Object.entries(props)) {
                    const pRow = document.createElement('div');
                    pRow.className = 'es-sm-list-row';

                    const keyInput = document.createElement('input');
                    keyInput.type = 'text';
                    keyInput.className = 'es-input es-input-string es-sm-prop-key';
                    keyInput.value = pKey;
                    keyInput.placeholder = 'Component.field';

                    const valInput = document.createElement('input');
                    valInput.type = 'text';
                    valInput.className = 'es-input es-input-string es-sm-val';
                    valInput.value = String(pVal);

                    const commitProp = () => {
                        const newKey = keyInput.value.trim();
                        if (!newKey) return;
                        if (!state.properties) state.properties = {};
                        if (newKey !== pKey) delete state.properties[pKey];
                        const raw = valInput.value;
                        state.properties[newKey] = raw === 'true' ? true : raw === 'false' ? false : isNaN(Number(raw)) ? raw : Number(raw);
                        emit();
                    };
                    keyInput.addEventListener('change', commitProp);
                    valInput.addEventListener('change', commitProp);

                    const rmP = createRemoveBtn();
                    rmP.addEventListener('click', () => {
                        if (state.properties) delete state.properties[pKey];
                        emit(); rebuild();
                    });

                    pRow.appendChild(keyInput);
                    pRow.appendChild(valInput);
                    pRow.appendChild(rmP);
                    stateBody.appendChild(pRow);
                }

                const addProp = createAddBtn('Property');
                addProp.addEventListener('click', () => {
                    if (!state.properties) state.properties = {};
                    let idx = Object.keys(state.properties).length;
                    while (state.properties[`prop${idx}`] !== undefined) idx++;
                    state.properties[`prop${idx}`] = 0;
                    emit(); rebuild();
                });
                stateBody.appendChild(addProp);

                // Transitions
                const transLabel = document.createElement('span');
                transLabel.className = 'es-sm-sub-label es-sm-label-trans';
                transLabel.textContent = 'Transitions';
                stateBody.appendChild(transLabel);

                state.transitions.forEach((trans, ti) => {
                    stateBody.appendChild(renderTransition(trans, stateNames, () => emit(), () => {
                        state.transitions.splice(ti, 1);
                        emit(); rebuild();
                    }));
                });

                const addTrans = createAddBtn('Transition');
                addTrans.addEventListener('click', () => {
                    const targets = stateNames.filter(n => n !== name);
                    state.transitions.push({ target: targets[0] ?? '', conditions: [], duration: 0.1 });
                    emit(); rebuild();
                });
                stateBody.appendChild(addTrans);

                stateSection.appendChild(stateHeader);
                stateSection.appendChild(stateBody);
                content.appendChild(stateSection);
            }

            const addState = createAddBtn('State');
            addState.addEventListener('click', () => {
                let idx = Object.keys(data.states).length;
                while (data.states[`state${idx}`]) idx++;
                data.states[`state${idx}`] = { transitions: [], properties: {} };
                if (!data.initialState) data.initialState = `state${idx}`;
                emit(); rebuild();
            });
            content.appendChild(addState);
        }

        renderList();
        return section;
    }

    // =========================================================================
    // Build
    // =========================================================================
    function rebuild() {
        root.innerHTML = '';
        root.appendChild(renderInitialState());
        root.appendChild(renderInputs());
        root.appendChild(renderListeners());
        root.appendChild(renderStates());
    }

    rebuild();

    return {
        update(v: unknown) {
            if (v && typeof v === 'object') {
                data = cloneData(v as StateMachineData);
            } else {
                data = defaultData();
            }
            prevData = cloneData(data);
            rebuild();
        },
        dispose() {
            root.remove();
            if (propertyRow) (propertyRow as HTMLElement).style.display = '';
        },
    };
}
