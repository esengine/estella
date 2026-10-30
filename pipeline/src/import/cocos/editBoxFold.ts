// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    editBoxFold.ts
 * @brief   A Cocos edit box becomes the engine's `TextInput`, and the two labels it was built from are folded into it.
 *
 * In Cocos an edit box is a node with a component and two children, a label for the typed text and one for the hint, which the
 * component keeps in step. The engine's field draws its own text and hint, caret and selection, so what those two labels said — the
 * font, the size, the colours, the alignment, where the text starts inside the box — is the field's own style, and the two nodes are not
 * written: there is nothing for them to be.
 *
 * Done after the references between nodes are resolved, because the labels are named by the component as nodes of the document.
 */
import type { ComponentData } from './components';

type Raw = Record<string, unknown>;

/** The part of a converted entity this needs: what it carries and who it holds. */
export interface FoldEntity {
    components: ComponentData[];
    children: Array<string | number>;
}

const COCOS_EDIT_BOX = 'Cocos.EditBox';

/** Cocos's `InputMode`: ANY, EMAIL, NUMERIC, PHONE_NUMBER, URL, DECIMAL, SINGLE_LINE. */
const NUMERIC = 2, PHONE_NUMBER = 3, DECIMAL = 5, ANY = 0;
/** The engine's `TextInputFilter`. */
const FILTER = { none: 0, digits: 1, decimal: 2, phone: 3 };
const PASSWORD = 0;

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const part = (e: FoldEntity, type: string): Raw | null => (e.components.find((c) => c.type === type)?.data as Raw | undefined) ?? null;

/** Where the label's text starts inside the box, measured from the box's left edge: the field's padding. */
function paddingOf(box: FoldEntity, label: FoldEntity | null): number {
    if (!label) return 0;
    const boxRect = part(box, 'ContentRect');
    const labelRect = part(label, 'ContentRect');
    const labelAt = part(label, 'Transform');
    if (!boxRect || !labelRect || !labelAt) return 0;
    const size = (r: Raw): { x: number; y: number } => (isObj(r.size) ? { x: num(r.size.x, 0), y: num(r.size.y, 0) } : { x: 0, y: 0 });
    const pivot = (r: Raw): { x: number; y: number } => (isObj(r.pivot) ? { x: num(r.pivot.x, 0.5), y: num(r.pivot.y, 0.5) } : { x: 0.5, y: 0.5 });
    const position = isObj(labelAt.position) ? num(labelAt.position.x, 0) : 0;
    const boxLeft = -pivot(boxRect).x * size(boxRect).x;
    const labelLeft = position - pivot(labelRect).x * size(labelRect).x;
    return Math.max(0, Math.round((labelLeft - boxLeft) * 100) / 100);
}

/**
 * Replace each edit box component by a `TextInput` carrying the style of its labels, and drop the labels' entities (with whatever is
 * under them) from @p entities. @p idOf names an entity the way the component's references do. Entities that are not edit boxes, and
 * those a reference could not be resolved for, are left as they are.
 */
export function foldEditBoxes<E extends FoldEntity>(entities: E[], idOf: (e: E) => string | number): E[] {
    const byId = new Map<string | number, E>(entities.map((e) => [idOf(e), e]));
    const dropped = new Set<string | number>();
    const dropWithDescendants = (id: string | number): void => {
        if (dropped.has(id)) return;
        dropped.add(id);
        for (const child of byId.get(id)?.children ?? []) dropWithDescendants(child);
    };

    for (const entity of entities) {
        const index = entity.components.findIndex((c) => c.type === COCOS_EDIT_BOX);
        if (index < 0) continue;
        const box = entity.components[index]!.data as Raw;
        const textId = box.textLabel as string | number | undefined;
        const hintId = box.placeholderLabel as string | number | undefined;
        const textEntity = textId !== undefined && textId !== '' && textId !== 0 ? byId.get(textId) ?? null : null;
        const hintEntity = hintId !== undefined && hintId !== '' && hintId !== 0 ? byId.get(hintId) ?? null : null;
        const text = textEntity ? part(textEntity, 'Text') : null;
        const hint = hintEntity ? part(hintEntity, 'Text') : null;
        // the typed text's style leads; a box that has only the hint takes the size and the font from it
        const style = text ?? hint ?? {};

        const mode = num(box.inputMode, ANY);
        const inputFilter = mode === NUMERIC ? FILTER.digits : mode === DECIMAL ? FILTER.decimal : mode === PHONE_NUMBER ? FILTER.phone : FILTER.none;
        const data: Raw = {
            value: typeof box.string_ === 'string' ? box.string_ : '',
            placeholder: hint && typeof hint.content === 'string' ? hint.content : '',
            maxLength: num(box.maxLength, 0) > 0 ? num(box.maxLength, 0) : 0,
            inputFilter,
            multiline: mode === ANY,
            password: num(box.inputFlag, 5) === PASSWORD,
            readOnly: box.enabled === false,
            fontSize: num(style.fontSize, 16),
            padding: paddingOf(entity, textEntity ?? hintEntity),
            textAlign: num(style.align, 0),
            renderMode: num(style.renderMode, 0),
        };
        if (isObj(text?.color)) data.color = text!.color;
        if (isObj(hint?.color)) data.placeholderColor = hint!.color;
        if (typeof style.fontFamily === 'string' && style.fontFamily !== '') data.fontFamily = style.fontFamily;
        if (typeof style.font === 'string' || (typeof style.font === 'number' && style.font !== 0)) data.font = style.font;
        entity.components[index] = { type: 'TextInput', data };

        for (const labelId of [textId, hintId]) {
            if (labelId === undefined || !byId.has(labelId)) continue;
            dropWithDescendants(labelId);
            entity.children = entity.children.filter((c) => c !== labelId);
        }
    }
    return dropped.size === 0 ? entities : entities.filter((e) => !dropped.has(idOf(e)));
}
