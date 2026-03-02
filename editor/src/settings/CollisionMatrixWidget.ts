import { getSettingsValue, setSettingsValue, onSettingsChange } from './SettingsRegistry';
import { getNamedLayers, MAX_COLLISION_LAYERS } from './collisionLayers';

export function renderCollisionMatrix(container: HTMLElement): (() => void) | void {
    let unsubscribe: (() => void) | null = null;

    function rebuild(): void {
        container.innerHTML = '';
        const layers = getNamedLayers();

        if (layers.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'es-collision-matrix-empty';
            empty.textContent = 'No named collision layers. Add layer names above.';
            container.appendChild(empty);
            return;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'es-collision-matrix';

        const n = layers.length;
        const grid = document.createElement('div');
        grid.className = 'es-collision-matrix-grid';
        grid.style.gridTemplateColumns = `120px repeat(${n}, 32px)`;
        grid.style.gridTemplateRows = `48px repeat(${n}, 32px)`;

        const cornerCell = document.createElement('div');
        cornerCell.className = 'es-collision-matrix-corner';
        grid.appendChild(cornerCell);

        for (let col = 0; col < n; col++) {
            const header = document.createElement('div');
            header.className = 'es-collision-matrix-header';
            const span = document.createElement('span');
            span.textContent = layers[col].name;
            header.appendChild(span);
            grid.appendChild(header);
        }

        for (let row = 0; row < n; row++) {
            const rowLabel = document.createElement('div');
            rowLabel.className = 'es-collision-matrix-row-label';
            rowLabel.textContent = layers[row].name;
            grid.appendChild(rowLabel);

            for (let col = 0; col < n; col++) {
                const cell = document.createElement('div');
                cell.className = 'es-collision-matrix-cell';

                if (col > row) {
                    grid.appendChild(cell);
                    continue;
                }

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                const rowIdx = layers[row].index;
                const colIdx = layers[col].index;
                const rowMask = getSettingsValue<number>(`physics.layerMask${rowIdx}`) ?? 0xFFFF;
                checkbox.checked = (rowMask & (1 << colIdx)) !== 0;

                checkbox.addEventListener('change', () => {
                    const checked = checkbox.checked;
                    toggleMask(rowIdx, colIdx, checked);
                    if (rowIdx !== colIdx) {
                        toggleMask(colIdx, rowIdx, checked);
                    }
                });

                cell.appendChild(checkbox);
                grid.appendChild(cell);
            }
        }

        wrapper.appendChild(grid);
        container.appendChild(wrapper);
    }

    function toggleMask(layerA: number, layerB: number, enabled: boolean): void {
        const key = `physics.layerMask${layerA}`;
        let mask = getSettingsValue<number>(key) ?? 0xFFFF;
        if (enabled) {
            mask |= (1 << layerB);
        } else {
            mask &= ~(1 << layerB);
        }
        setSettingsValue(key, mask);
    }

    rebuild();

    unsubscribe = onSettingsChange((id) => {
        if (id.startsWith('physics.layerName') || id.startsWith('physics.layerMask')) {
            rebuild();
        }
    });

    return () => {
        unsubscribe?.();
    };
}
