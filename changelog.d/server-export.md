---
section: Added
commits:
  - feat(export): a game's server exports and deploys with its page
---
**A game's server exports with its page, ready to deploy.** A project names its server in `project.esproject` (`server`:
its entry, the WebSocket path, the port and how it is started), and `estella export --platform server` bundles it into one
file Node 20 runs with nothing installed, beside the game's web export, the engine when the server runs it, and the files
that put both behind one address: Docker Compose with Caddy fetching the certificate, or a systemd unit with a Caddyfile.
In `esengine/session`, `serverAddress({ path })` gives a web client the page's own host at that path (`?server=` overrides
it), and `TokenBook` signs players in by a token each from a list the server keeps, with `newToken()` to make them.
