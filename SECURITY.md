# Security

## Reporting

This repository is public, so please do not describe a vulnerability in a
public issue. Use *Report a vulnerability* under the repository's Security
tab, which opens a private advisory only the maintainer can read. If that
option is unavailable, open an issue titled `security:` that names the impact
(what an attacker gains, against which asset) without exploit details, and the
maintainer will move the conversation somewhere private. There is no bounty
and no SLA; reports are read by one person, and answered as soon as that
person has understood them.

## Scope

In scope is the WebSocket server in `packages/server` and the engine's
hidden-information redaction — hands, decks, life cards and the RNG state —
as defined by `docs/threat-model.md`, which names the actors, the assets and
the mitigations one by one. A way for a socket to crash the process, hijack a
seat, corrupt a match, or learn anything `playerView` and `redactEvent` keep
off the wire is a report. Out of scope, as the threat model's declared gaps
already say: distributed denial of service (an infrastructure concern — the
proxy, the host), TLS (terminated at the proxy in front of the process; the
code does not defend the network in between), and anything to do with
accounts, of which there are none.
