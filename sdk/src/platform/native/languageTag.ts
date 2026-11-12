/**
 * @file    languageTag.ts
 * @brief   Reduce an OS locale to the language-region tag a browser reports.
 * @details Each native OS spells the device language its own way — Android and
 *          iOS say 'zh-Hans-CN', POSIX says 'zh_CN.UTF-8' — while a game written
 *          against `navigator.language` compares with 'zh-CN'. The hosts hand the
 *          OS string over raw and this is the one place it is reduced, so a
 *          project picks its language the same way on every target.
 */

/** Regions that write Chinese in the traditional script. */
const TRADITIONAL_REGIONS = new Set(['TW', 'HK', 'MO']);

/**
 * 'zh-Hans-CN' → 'zh-CN', 'zh_TW.UTF-8' → 'zh-TW', 'en' → 'en'. Null when the
 * host said nothing usable (an empty string, POSIX 'C'), and the caller keeps
 * its fallback.
 *
 * The script subtag is dropped, as browsers drop it — except that for Chinese
 * it decides the region when the two disagree or the region is missing, since
 * 'zh-Hant' with no region must not land on a Simplified table.
 */
export function browserLanguageTag(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const parts = raw.trim().split(/[.@]/)[0].split(/[-_]/).filter(Boolean);
    const language = parts[0]?.toLowerCase();
    if (!language || !/^[a-z]{2,3}$/.test(language) || language === 'posix') return null;

    let script = '';
    let region = '';
    for (const part of parts.slice(1)) {
        if (!script && !region && /^[A-Za-z]{4}$/.test(part)) script = part.toLowerCase();
        else if (!region && /^([A-Za-z]{2}|\d{3})$/.test(part)) region = part.toUpperCase();
        else break;   // variants and extensions say nothing a locale table is keyed on
    }

    if (language === 'zh' && script) {
        const traditional = script === 'hant';
        if (!region || TRADITIONAL_REGIONS.has(region) !== traditional) region = traditional ? 'TW' : 'CN';
    }
    return region ? `${language}-${region}` : language;
}
