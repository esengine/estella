---
section: Added
commits:
  - feat(export): a page served apart from its game server dials the address the project names
---
**A game's page can be served apart from its server.** `server.url` in `project.esproject` (or `--server-url` on the
export) names the server's WebSocket address; the web and desktop exports write it into the page and allow its origin
in the page's Content-Security-Policy, and `serverAddress` in `esengine/session` dials it, after `?server=` and before
the page's own host. The page can then be on GitHub Pages or a CDN while the server runs elsewhere, and the server
export's Caddy and Compose files answer at that address.
