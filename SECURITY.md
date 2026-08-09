# Security Policy

## Supported Versions

Before 1.0, fixes land on the current minor series only. There are no backports:
upgrading to the latest release is the supported path to a fix.

| Version | Supported |
|---------|-----------|
| 0.47.x  | Yes       |
| < 0.47  | No        |

`tools/check-release-metadata.mjs` fails the build if this table stops matching
the version being shipped, so it cannot quietly fall behind again.

## Reporting a Vulnerability

If you discover a security vulnerability in Estella, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please use one of the following methods:

1. **GitHub Security Advisories**: [Report a vulnerability](https://github.com/esengine/estella/security/advisories/new)
2. **Email**: Send details to **esengine@outlook.com**

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix release**: Depends on severity, typically within 2 weeks for critical issues

We appreciate your help in keeping Estella secure.
