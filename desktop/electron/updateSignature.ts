// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  updateSignature.ts — can a Windows update from this pipeline install here?
 *
 * electron-updater checks a downloaded installer's Authenticode signature ONLY
 * when the INSTALLED app-update.yml names a `publisherName`, and it then demands
 * a status of Valid — a matching name is not enough. Both conditions come from
 * the running install, so both can be read before anything is downloaded, which
 * is the point: the refusal otherwise lands after the whole installer is on disk.
 *
 * That is not hypothetical. A release signed the Windows installer with the
 * project's macOS Developer ID certificate (electron-builder's CSC_LINK is
 * platform-neutral and the Windows CI leg saw it), so those installs carry a
 * publisherName Windows can never report Valid — no certificate chain to a
 * trusted root. They can never update in place again and must be reinstalled
 * once; what this decides is whether the editor says so before or after a
 * hundred-megabyte download.
 *
 * The rules mirror electron-updater's own verifier exactly, including its
 * forgiving edges — no publisher pinned passes, and a probe that could not run
 * passes — so this never refuses an update the updater would have accepted.
 *
 * Pure (parsing + comparison only) → unit-testable; the fs/PowerShell half lives
 * in autoUpdate.ts.
 */

/** The subset of `Get-AuthenticodeSignature | ConvertTo-Json` this needs. */
export interface AuthenticodeProbe {
  /** 0 is `Valid`; every other value is a reason Windows will not vouch for it. */
  Status?: number;
  StatusMessage?: string;
  SignerCertificate?: { Subject?: string } | null;
}

/**
 * The `publisherName` an installed `app-update.yml` pins, or null when it pins
 * none (an unsigned build — nothing to verify, so nothing to fail).
 *
 * Read with a line scan rather than a YAML parser: this runs in the main process
 * on the update path, the file is machine-written by electron-builder, and the one
 * key needed is a plain scalar. A list-valued `publisherName` (electron-builder
 * allows several) yields its first entry — enough to answer "is verification on".
 */
export function publisherNameIn(appUpdateYml: string): string | null {
  const lines = appUpdateYml.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^publisherName:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const inline = unquote(m[1]);
    if (inline) return inline;
    // `publisherName:` followed by a `- name` block.
    const item = /^\s*-\s*(.+)$/.exec(lines[i + 1] ?? '');
    return item ? unquote(item[1]) || null : null;
  }
  return null;
}

function unquote(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2 && ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"')))) {
    return s.slice(1, -1);
  }
  return s;
}

/** `CN=a, O=b` → Map. Mirrors builder-util-runtime's parseDn (used by the verifier). */
function parseDn(seq: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of seq.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    out.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return out;
}

/**
 * Whether an update signed like `probe` would satisfy a `publisher` pin.
 *
 * - No pin ⇒ true. electron-updater skips verification entirely.
 * - No probe ⇒ true. Its verifier treats a PowerShell failure as "no objection",
 *   and this must never be stricter than the check it stands in for.
 * - Otherwise the status must be Valid AND the subject must match, the same two
 *   tests, in the same order, as windowsExecutableCodeSignatureVerifier.
 */
export function signatureSatisfies(publisher: string | null, probe: AuthenticodeProbe | null): boolean {
  if (publisher === null) return true;
  if (probe === null) return true;
  if (probe.Status !== 0) return false;
  const subject = parseDn(probe.SignerCertificate?.Subject ?? '');
  const pinned = parseDn(publisher);
  // A full DN pin compares every field it names; a bare name is a common-name pin.
  return pinned.size > 0
    ? [...pinned.keys()].every((k) => pinned.get(k) === subject.get(k))
    : subject.get('CN') === publisher;
}
