// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

/** Preview settings; never modify a catalog or interpolated parameter. @experimental */
export interface PseudoLocalizationOptions {
    /** Extra visible characters as a fraction of source length. Default 0.35. */
    expansion?: number;
    accents?: boolean;
}

const plain = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const accented = 'áƀçďéƒğĥíĵķľṁñóṕɋŕšţúṽŵẋýžÁƁÇĎÉƑĞĤÍĴĶĽṀÑÓṔɊŔŠŢÚṼŴẊÝŽ';

/** Length stress preview preserving placeholders, rich-text tags and newlines. @experimental */
export function pseudoLocalize(template: string, options: PseudoLocalizationOptions = {}): string {
    const expansion = Math.min(3, Math.max(0, Number.isFinite(options.expansion ?? 0.35) ? options.expansion ?? 0.35 : 0.35));
    return template.split('\n').map((line) => {
        if (!line) return line;
        let length = 0;
        const result = line.split(/(\{\w+\}|<[^>]*>|\[[^\]]*\])/g).map((part, index) => {
            if (index % 2) return part;
            length += [...part].length;
            return options.accents === false ? part : part.replace(/[a-z]/gi, (ch) => accented[plain.indexOf(ch)]);
        }).join('');
        return `⟦${result}${'~'.repeat(Math.ceil(length * expansion))}⟧`;
    }).join('\n');
}
