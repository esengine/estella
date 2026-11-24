---
section: Fixed
commits:
  - fix(ai): registerCondition takes a spec with what the check reads
---
**`registerCondition` accepts a condition spec.** The registry has taken `{ check, touches }` since conditions could
declare what they read, but the exported `registerCondition` only typed a bare predicate, so TypeScript refused a spec
the runtime would have stored. It now takes either form, like `registerAction`.
