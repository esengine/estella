// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    credits.ts
 * @brief   The project's `CREDITS.md`: one row per file that is someone else's work, with where it came from, under
 *          what licence, and what was done to it.
 *
 * Markdown rather than data: a person reads it and a game shows it, and a JSON file in a project is shipped and has
 * every path in it followed. Only the row of the file being written is touched; anything else in the file, a person's
 * own words included, is left as it is.
 */

/** One file's credit. Empty fields are kept from a row already there. */
export interface CreditRow {
    file: string;
    title?: string;
    author?: string;
    source?: string;
    licence?: string;
    changes?: string;
}

const HEADER = '| File | Title | Author | Source | Licence | Changes |';
const RULE = '| --- | --- | --- | --- | --- | --- |';
const SECTION = '## Audio';

const NEW_FILE = `# Credits

Third-party material in this project and what was done to it. \`sound_conform\` keeps the rows of the files it makes;
edit them freely, one row per file.

${SECTION}

${HEADER}
${RULE}
`;

const cell = (text: string | undefined): string => (text ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
const fileCell = (file: string): string => `\`${file}\``;

/** The cells of a table row, with escaped bars kept inside their cell. */
function cellsOf(line: string): string[] {
    const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    return inner.split(/(?<!\\)\|/).map((c) => c.trim());
}

/** The row @p row would read as, keeping whatever @p old says where @p row says nothing. */
function rowText(row: CreditRow, old: string[] | null): string {
    const keep = (i: number, value: string | undefined): string => (value !== undefined && value.trim() !== '' ? cell(value) : old?.[i] ?? '');
    return `| ${fileCell(row.file)} | ${keep(1, row.title)} | ${keep(2, row.author)} | ${keep(3, row.source)} | ${keep(4, row.licence)} | ${keep(5, row.changes)} |`;
}

/** The row for @p file in @p markdown, as cells, or null. */
export function creditOf(markdown: string | null, file: string): string[] | null {
    if (!markdown) return null;
    for (const line of markdown.split(/\r?\n/)) {
        if (!line.trim().startsWith('|')) continue;
        const cells = cellsOf(line);
        if (cells[0] === fileCell(file)) return cells;
    }
    return null;
}

/**
 * @p markdown (null for no file yet) with @p row written into its audio table: the file's row replaced in place, or added
 * at the end of the table. A file with no audio table gets one at its end.
 */
export function upsertCredit(markdown: string | null, row: CreditRow): string {
    const eol = markdown?.includes('\r\n') ? '\r\n' : '\n';
    const lines = (markdown ?? NEW_FILE).split(/\r?\n/);
    const at = lines.findIndex((l) => l.trim().startsWith('|') && cellsOf(l)[0] === fileCell(row.file));
    if (at >= 0) {
        lines[at] = rowText(row, cellsOf(lines[at]!));
        return lines.join(eol);
    }
    const header = lines.findIndex((l, i) => l.trim() === HEADER && lines.slice(0, i).some((h) => h.trim() === SECTION));
    if (header < 0) {
        while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop();
        lines.push('', SECTION, '', HEADER, RULE, rowText(row, null), '');
        return lines.join(eol);
    }
    let end = header + 1;
    while (end < lines.length && lines[end]!.trim().startsWith('|')) end++;
    lines.splice(end, 0, rowText(row, null));
    return lines.join(eol);
}

/**
 * What a licence named on a credit says about using an edited recording in a game, as warnings: one that forbids
 * changes, or commercial use, or that needs the credit shown.
 */
export function licenceWarnings(licence: string | undefined): string[] {
    const text = (licence ?? '').toUpperCase();
    if (!text) return ['no licence is recorded: a recording you did not make needs its licence and author on the credit, or it cannot ship'];
    const warnings: string[] = [];
    if (/\bND\b|NO ?DERIV/.test(text)) warnings.push(`${licence} forbids changed versions, and this one is changed (cut, levelled or looped): use the recording as it is or find another`);
    if (/\bNC\b|NON-?COMMERCIAL/.test(text)) warnings.push(`${licence} forbids commercial use: a game that is sold, or carries ads, cannot use it`);
    if (/\bBY\b/.test(text)) warnings.push(`${licence} needs the author credited where players can see it (a credits screen), not only in CREDITS.md`);
    return warnings;
}
