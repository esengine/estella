// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  moduleImports.mjs — does this line make the file depend on another module?
 *
 * The plugin typings ship as TEXT, copied verbatim into an author's project, so
 * being import-free is load-bearing rather than a style preference. Two checks
 * enforce it — the push gate and the editor's unit suite — and each carrying its
 * own regex is how one of them ends up accepting what the other refuses.
 */

/**
 * True for a module import or re-export: `import x`, `import{x}`, `import*`,
 * `import'side-effect'`, `export * from`, `export {…} from`.
 *
 * NOT for a method named `import(`, which an importer contribution declares and
 * which pulls in nothing.
 */
export const importsAnotherModule = (line) =>
  /^\s*(import\s*(?![(])|export\s+(\*|\{[^}]*\})\s+from\b)/.test(line);
