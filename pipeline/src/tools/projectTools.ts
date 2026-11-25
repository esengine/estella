// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  projectTools.ts — what a project says about the optional tools it uses.
 *
 * A tool is OFF unless the project switches it on. Off, the engine does not look for it, does not
 * mention it and never downloads it. On, the engine checks it is installed and, when it is not, puts
 * what it would fetch in front of the person (see externalTools.ts).
 */

/**
 * One thing Luban builds from the tables: a target of `luban.conf` (client, server, …) as code and data, each in its own
 * folder. A game with a client and a server builds each from the same tables, the server's with the tables only it reads.
 */
export interface LubanOutput {
  /** The target in `luban.conf` to build. */
  target: string;
  codeTarget: string;
  dataTarget: string;
  /** Where the generated code is written, project-relative. */
  codeDir: string;
  /** Where the generated data is written, project-relative. */
  dataDir: string;
}

/** Luban turns the Excel tables a game's designers keep into JSON and the TypeScript that reads it. */
export interface LubanSetting {
  enabled: boolean;
  /** Luban's own `luban.conf`, project-relative. */
  conf: string;
  /** What is built from it, one run of Luban each. At least one. */
  outputs: LubanOutput[];
}

export interface ProtobufSetting {
  enabled: boolean;
  /** The folder the .proto files are in, project-relative. */
  protoDir: string;
  /** Where the generated TypeScript is written, project-relative. */
  outDir: string;
}

export interface ProjectTools {
  luban?: LubanSetting;
  protobuf?: ProtobufSetting;
}

export const PROTOBUF_DEFAULTS: Omit<ProtobufSetting, 'enabled'> = {
  protoDir: 'proto',
  outDir: 'src/proto',
};

export const LUBAN_OUTPUT_DEFAULTS: LubanOutput = {
  target: 'client',
  codeTarget: 'typescript-json',
  dataTarget: 'json',
  codeDir: 'src/gen',
  dataDir: 'assets/data',
};

export const LUBAN_DEFAULTS: Omit<LubanSetting, 'enabled'> = {
  conf: 'config/luban/luban.conf',
  outputs: [{ ...LUBAN_OUTPUT_DEFAULTS }],
};

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/** A project-relative path with `/` separators that cannot leave the project. */
export function projectRelativePath(value: string, what: string, tool = 'luban'): string {
  const clean = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!clean || clean.startsWith('/') || /^[A-Za-z]:/.test(clean) || clean.split('/').some((part) => part === '..' || part === '')) {
    throw new Error(`tools.${tool}.${what} must be a path inside the project, not "${value}"`);
  }
  return clean;
}

function text(raw: Record<string, unknown>, key: string, fallback: string, isPath: boolean, where = key): string {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new Error(`tools.luban.${where} must be text`);
  if (isPath) return projectRelativePath(value, where);
  if (!NAME.test(value)) throw new Error(`tools.luban.${where} "${value}" must be a name made of letters, digits, "-", "_" and "."`);
  return value;
}

function lubanOutput(raw: Record<string, unknown>, where: string): LubanOutput {
  const d = LUBAN_OUTPUT_DEFAULTS;
  return {
    target: text(raw, 'target', d.target, false, `${where}target`),
    codeTarget: text(raw, 'codeTarget', d.codeTarget, false, `${where}codeTarget`),
    dataTarget: text(raw, 'dataTarget', d.dataTarget, false, `${where}dataTarget`),
    codeDir: text(raw, 'codeDir', d.codeDir, true, `${where}codeDir`),
    dataDir: text(raw, 'dataDir', d.dataDir, true, `${where}dataDir`),
  };
}

/** Whether one folder is the other or holds it. */
const overlaps = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

/**
 * The outputs of a `luban` section. A project written before there could be several names one output in the section
 * itself (`target`, `codeDir`, …); it is read as the only one. Two outputs may not build the same target, and no two
 * folders they write may hold one another: each run replaces what is in its folders.
 */
function lubanOutputs(l: Record<string, unknown>): LubanOutput[] {
  if (l.outputs === undefined) return [lubanOutput(l, '')];
  if (!Array.isArray(l.outputs) || l.outputs.length === 0) throw new Error('tools.luban.outputs must be a list of at least one output');
  const outputs = l.outputs.map((o, i) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error(`tools.luban.outputs[${i}] must be an object`);
    return lubanOutput(o as Record<string, unknown>, `outputs[${i}].`);
  });
  const dirs: Array<{ dir: string; what: string; owner: number }> = [];
  outputs.forEach((o, i) => {
    if (outputs.findIndex((x) => x.target === o.target) !== i) throw new Error(`tools.luban.outputs builds the target "${o.target}" twice`);
    for (const [dir, what] of [[o.codeDir, 'code'], [o.dataDir, 'data']] as const) {
      // One output may put its code and its data together; two outputs may not share.
      const clash = dirs.find((d) => d.owner !== i && overlaps(d.dir, dir));
      if (clash) throw new Error(`tools.luban.outputs: the ${what} folder of "${o.target}" (${dir}) and ${clash.what} (${clash.dir}) are the same folder or one holds the other; give each its own`);
      dirs.push({ dir, what: `the ${what} folder of "${o.target}"`, owner: i });
    }
  });
  return outputs;
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
      conf: text(l, 'conf', LUBAN_DEFAULTS.conf, true),
      outputs: lubanOutputs(l),
    };
  }
  const protobuf = (raw as Record<string, unknown>).protobuf;
  if (protobuf && typeof protobuf === 'object' && !Array.isArray(protobuf)) {
    const p = protobuf as Record<string, unknown>;
    if (p.enabled !== undefined && typeof p.enabled !== 'boolean') throw new Error('tools.protobuf.enabled must be true or false');
    const dir = (key: keyof typeof PROTOBUF_DEFAULTS): string => {
      const value = p[key];
      if (value === undefined) return PROTOBUF_DEFAULTS[key];
      if (typeof value !== 'string') throw new Error(`tools.protobuf.${key} must be text`);
      return projectRelativePath(value, key, 'protobuf');
    };
    tools.protobuf = { enabled: p.enabled === true, protoDir: dir('protoDir'), outDir: dir('outDir') };
  }
  return Object.keys(tools).length > 0 ? tools : undefined;
}
