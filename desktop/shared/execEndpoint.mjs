// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  execEndpoint.mjs — the loopback /exec seam every MCP host shares.
 *
 * One tiny HTTP server on 127.0.0.1: POST /exec with the host token executes one
 * marshalled call and returns `{ ok, hasResult, result }` (or `{ ok:false, error }`).
 * The MCP protocol layer lives in the plain-node front (editor-mcp.mjs); hosts —
 * the headless render host and the live editor app — differ only in how they
 * resolve a payload to a result, which they supply as `run(payload)`.
 *
 * Plain .mjs so both host flavors can use it: the headless host imports it
 * directly, the editor main process bundles it through esbuild.
 */
import http from 'node:http';

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

/**
 * Start the endpoint. `run(payload)` executes one call (payload is the parsed
 * request body — `{method, args, root?}`, `{js}`, or `{op, ...}`) and may return
 * any JSON-able value (undefined = void). Returns the http.Server, already
 * listening; read `.address().port`.
 */
export function createExecEndpoint({ token, run }) {
  const server = http.createServer(async (req, res) => {
    const reply = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST' || req.url !== '/exec') return reply(404, { ok: false, error: 'not found' });
    if (req.headers['x-estella-mcp-token'] !== token) return reply(403, { ok: false, error: 'bad token' });
    try {
      const result = await run(JSON.parse(await readBody(req)));
      reply(200, { ok: true, hasResult: result !== undefined, result: result === undefined ? null : result });
    } catch (e) {
      reply(200, { ok: false, error: String((e && e.message) || e) });
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}
