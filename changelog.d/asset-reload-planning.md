---
section: Fixed
commits:
  - perf(assets): plan shared hot reloads from live dependency receipts
---
**Shared maps and materials reload in dependency order when several files change together.** Estella computes the affected assets once per batch and can follow deep dependency chains without exhausting the call stack. Assets held by a UUID reference and by their address now share the same published update.
