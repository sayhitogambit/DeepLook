# Security

Report suspected vulnerabilities privately to **support@getdeeplook.dev**. Include the affected revision, a minimal reproduction with synthetic data, expected and actual behavior, and relevant redacted logs. Do not post API keys, SMTP passwords, private page contents or an exploit against someone else's system in a public issue.

The project is an early release. Public-destination checks and Chrome's sandbox are application defenses, not a substitute for network isolation, operating-system patches and resource limits. See [the technical reference](docs/reference.md) for the current boundaries.

Local operation needs no project-owner account or API key. A self-hosted API must use credentials generated and managed by its operator. Never reuse example placeholders or send the administrator token to a browser client.
