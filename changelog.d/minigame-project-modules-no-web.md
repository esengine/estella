---
section: Fixed
commits:
  - fix(export): a mini-game vendor never ships a project module's web build
---
**A mini-game export no longer ships a project module's web build.** For a mini-game host other than WeChat, a
project's native module was looked up in a directory named for the vendor, then `wechat/`, then `web/` — and the web
glue expects WebAssembly, which a mini-game host does not have, so the package failed on the device. The web build is
no longer a fallback for any mini-game host; with neither a vendor nor a `wechat/` build the module is reported as
unavailable.
