/**
 * @file    presets.ts
 * @brief   Preset dialog functions
 */

import { Dialog } from './Dialog';
import type {
    DialogOptions,
    DialogResult,
    InputDialogOptions,
    ConfirmDialogOptions,
    AlertDialogOptions,
} from './types';

export function showDialog(options: DialogOptions): Promise<DialogResult> {
    const dialog = new Dialog(options);
    return dialog.open();
}

export function showInputDialog(options: InputDialogOptions): Promise<string | null> {
    return new Promise((resolve) => {
        let resolved = false;

        const content = document.createElement('div');

        const field = document.createElement('div');
        field.className = 'es-dialog-field';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'es-dialog-input';
        input.placeholder = options.placeholder ?? '';
        input.value = options.defaultValue ?? '';

        field.appendChild(input);
        content.appendChild(field);

        const errorEl = document.createElement('div');
        errorEl.className = 'es-dialog-error';
        errorEl.style.display = 'none';
        content.appendChild(errorEl);

        let dialog: Dialog;
        let inputValue: string | null = null;

        const validate = async (): Promise<boolean> => {
            if (options.validator) {
                const error = await options.validator(input.value.trim());
                if (error) {
                    errorEl.textContent = error;
                    errorEl.style.display = 'block';
                    return false;
                }
            }
            errorEl.style.display = 'none';
            return true;
        };

        const submit = async (): Promise<boolean> => {
            if (!await validate()) return false;
            inputValue = input.value.trim() || null;
            dialog.close({ action: 'confirm', data: inputValue });
            return true;
        };

        dialog = new Dialog({
            title: options.title,
            content,
            buttons: [
                { label: options.cancelText ?? 'Cancel', role: 'cancel' },
                { label: options.confirmText ?? 'Confirm', role: 'confirm', primary: true, onClick: () => submit() },
            ],
            closeOnEscape: true,
        });

        dialog.getElement().addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submit();
            }
        });

        dialog.open().then((result) => {
            if (resolved) return;
            resolved = true;
            if (result.action === 'confirm') {
                resolve(inputValue);
            } else {
                resolve(null);
            }
        }).catch(() => resolve(null));

        requestAnimationFrame(() => {
            input.focus();
            input.select();
        });
    });
}

export function showConfirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
    return new Promise((resolve) => {
        const dialog = new Dialog({
            title: options.title,
            content: options.message,
            className: options.danger ? 'es-dialog-danger' : undefined,
            buttons: [
                { label: options.cancelText ?? 'Cancel', role: 'cancel' },
                { label: options.confirmText ?? 'Confirm', role: 'confirm', primary: true },
            ],
        });

        dialog.open().then((result) => {
            resolve(result.action === 'confirm');
        }).catch(() => resolve(false));
    });
}

export interface ObjectDialogOptions {
    title: string;
    value: Record<string, unknown>;
    confirmText?: string;
    cancelText?: string;
}

export function showObjectDialog(options: ObjectDialogOptions): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
        const content = document.createElement('div');
        content.className = 'es-object-editor';

        const rows: { keyInput: HTMLInputElement; valueInput: HTMLInputElement; row: HTMLElement }[] = [];

        const addRow = (key = '', value = ''): void => {
            const row = document.createElement('div');
            row.className = 'es-object-editor-row';

            const keyInput = document.createElement('input');
            keyInput.type = 'text';
            keyInput.className = 'es-dialog-input es-object-editor-key';
            keyInput.placeholder = 'key';
            keyInput.value = key;

            const valueInput = document.createElement('input');
            valueInput.type = 'text';
            valueInput.className = 'es-dialog-input es-object-editor-value';
            valueInput.placeholder = 'value';
            valueInput.value = value;

            const removeBtn = document.createElement('button');
            removeBtn.className = 'es-object-editor-remove';
            removeBtn.textContent = '\u00d7';
            removeBtn.addEventListener('click', () => {
                row.remove();
                const idx = rows.findIndex(r => r.row === row);
                if (idx >= 0) rows.splice(idx, 1);
            });

            row.appendChild(keyInput);
            row.appendChild(valueInput);
            row.appendChild(removeBtn);
            listEl.appendChild(row);
            rows.push({ keyInput, valueInput, row });
        };

        const listEl = document.createElement('div');
        listEl.className = 'es-object-editor-list';
        content.appendChild(listEl);

        for (const [k, v] of Object.entries(options.value)) {
            addRow(k, typeof v === 'string' ? v : JSON.stringify(v));
        }

        const addBtn = document.createElement('button');
        addBtn.className = 'es-object-editor-add';
        addBtn.textContent = '+ Add Field';
        addBtn.addEventListener('click', () => addRow());
        content.appendChild(addBtn);

        const errorEl = document.createElement('div');
        errorEl.className = 'es-dialog-error';
        errorEl.style.display = 'none';
        content.appendChild(errorEl);

        let dialog: Dialog;

        const collect = (): Record<string, unknown> | null => {
            const result: Record<string, unknown> = {};
            for (const { keyInput, valueInput } of rows) {
                const k = keyInput.value.trim();
                if (!k) continue;
                const raw = valueInput.value.trim();
                try {
                    result[k] = JSON.parse(raw);
                } catch {
                    result[k] = raw;
                }
            }
            return result;
        };

        const submit = (): boolean => {
            const result = collect();
            dialog.close({ action: 'confirm', data: result });
            return true;
        };

        dialog = new Dialog({
            title: options.title,
            content,
            width: 420,
            buttons: [
                { label: options.cancelText ?? 'Cancel', role: 'cancel' },
                { label: options.confirmText ?? 'Confirm', role: 'confirm', primary: true, onClick: () => submit() },
            ],
            closeOnEscape: true,
        });

        let resultData: Record<string, unknown> | null = null;
        dialog.open().then((result) => {
            if (result.action === 'confirm') {
                resultData = result.data ?? collect();
                resolve(resultData);
            } else {
                resolve(null);
            }
        }).catch(() => resolve(null));
    });
}

export function showAlertDialog(options: AlertDialogOptions): Promise<void> {
    return new Promise((resolve) => {
        const typeClass = options.type ? `es-dialog-${options.type}` : undefined;

        const dialog = new Dialog({
            title: options.title,
            content: options.message,
            className: typeClass,
            buttons: [
                { label: options.buttonText ?? 'OK', role: 'confirm', primary: true },
            ],
        });

        dialog.open().then(() => {
            resolve();
        }).catch(() => resolve());
    });
}
