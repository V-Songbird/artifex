---
type: knowledge
summary: "Explains how to report Artifex vulnerabilities privately, the supported code, and the trust boundaries when running pieces and tools."
related_files: ["package.json", "core/piece.js", "tools/build-page.js", ".github/workflows/check.yml", ".github/dependabot.yml"]
---

# Security policy

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/V-Songbird/artifex/security/advisories/new).
If that form is unavailable, email the maintainer at the address in [plugin metadata](../plugin.json).
Do not put vulnerabilities, credentials, or private reproduction data in public issues or pull requests.

Include the affected commit, runtime or browser version, reproduction steps, impact, and a minimal example when possible.
Remove real credentials and unrelated personal data. Response and remediation depend on maintainer availability; no response-time guarantee is offered.

## Supported code

Security fixes target the current `main` branch. Older commits and generated files are not maintained as separate release lines.
Regenerate exported pages after updating the source; existing exports do not update themselves.

## Trust boundaries

Artifex pieces are executable JavaScript. Node tools load example modules, and generated pages execute bundled drawing code in the browser.
Only run pieces and plugins you trust, or use an isolated environment with appropriate operating-system restrictions.
Contract validation checks structure and declared capabilities; it is not a sandbox for untrusted code.

The library needs no account, service token, or network dependency. Never embed credentials or private input data in source, examples, or exported files.
Replay metadata identifies inputs and requires matching source and data; inspect it before sharing an export.

## Repository checks

[CI](../.github/workflows/check.yml) runs lint, tests, page generation, and a tracked-ignore check on Linux and Windows.
Its token is read-only, checkout credentials are not persisted, and third-party Actions are pinned to full commit hashes.
[Dependabot](../.github/dependabot.yml) proposes updates to those Action pins.

Automated checks and code scanning cover selected properties. They do not prove arbitrary artwork code is safe or replace review of exported content.
