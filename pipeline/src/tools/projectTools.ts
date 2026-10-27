// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  projectTools.ts — what a project says about the optional tools it uses.
 *
 * A tool is OFF unless the project switches it on. Off, the engine does not look for it, does not
 * mention it and never downloads it. On, the engine checks it is installed and, when it is not, puts
 * what it would fetch in front of the person (see externalTools.ts).
 */

/** Luban turns the Excel tables a game's designers keep into JSON and the TypeScript that reads it. */
export interface LubanSetting {
  enabled: boolean;
  /** Luban's own `luban.conf`, project-relative. */
  conf: string;
  /** The target in that file to build. */
  target: string;
  codeTarget: string;
  dataTarget: string;
  /** Where the generated TypeScript is written, project-relative. */
  codeDir: string;
  /** Where the generated JSON is written, project-relative. */
  dataDir: string;
}

export interface ProjectTools {
  luban?: LubanSetting;
}

export const LUBAN_DEFAULTS: Omit<LubanSetting, 'enabled'> = {
  conf: 'config/luban/luban.conf',
  target: 'client',
  codeTarget: 'typescript-json',
  dataTarget: 'json',
  codeDir: 'src/gen',
  dataDir: 'assets/data',
};

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/** A project-relative path with `/` separators that cannot leave the project. */
export function projectRelativePath(value: string, what: string): string {
  const clean = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!clean || clean.startsWith('/') || /^[A-Za-z]:/.test(clean) || clean.split('/').some((part) => part === '..' || part === '')) {
    throw new Error(`tools.luban.${what} must be a path inside the project, not "${value}"`);
  }
  return clean;
}

function text(raw: Record<string, unknown>, key: keyof typeof LUBAN_DEFAULTS, isPath: boolean): string {
  const value = raw[key];
  if (value === undefined) return LUBAN_DEFAULTS[key];
  if (typeof value !== 'string') throw new Error(`tools.luban.${key} must be text`);
  if (isPath) return projectRelativePath(value, key);
  if (!NAME.test(value)) throw new Error(`tools.luban.${key} "${value}" must be a name made of letters, digits, "-", "_" and "."`);
  return value;
}

/** Read the `tools` section of a project. Undefined when it names nothing; throws on a value that cannot be used. */
export function parseProjectTools(raw: unknown): ProjectTools | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const tools: ProjectTools = {};
  const luban = (raw as Record<string, unknown>).luban;
  if (luban && typeof luban === 'object' && !Array.isArray(luban)) {
    const l = luban as Record<string, unknown>;
    if (l.enabled !== undefined && typeof l.enabled !== 'boolean') throw new Error('tools.luban.enabled must be true or false');
    tools.luban = {
      enabled: l.enabled === true,
      conf: text(l, 'conf', true),
      target: text(l, 'target', false),
      codeTarget: text(l, 'codeTarget', false),
      dataTarget: text(l, 'dataTarget', false),
      codeDir: text(l, 'codeDir', true),
      dataDir: text(l, 'dataDir', true),
    };
  }
  return Object.keys(tools).length > 0 ? tools : undefined;
}
