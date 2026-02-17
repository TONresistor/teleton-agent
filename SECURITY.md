# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.5.x   | Yes       |
| < 0.5   | No        |

Only the latest minor release receives security patches. We recommend always running the latest version.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please report vulnerabilities through one of these channels:

- **GitHub Security Advisories**: [Report a vulnerability](https://github.com/TONresistor/teleton-agent/security/advisories/new)
- **Telegram**: dm t.me/zkproof

### What to Expect

- **Acknowledgment** within 72 hours of your report
- **Assessment** within 7 days with severity classification
- **Fix timeline** based on severity:
  - Critical: patch release within 7 days
  - High: patch release within 14 days
  - Medium/Low: included in the next scheduled release
- **Coordinated disclosure** after 90 days or when a fix is available, whichever comes first

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Suggested fix (if any)

## Security Architecture

Teleton Agent implements multiple layers of defense:

### Prompt Injection Defense

- `sanitizeForPrompt()` strips control characters, invisible Unicode, markdown headers, and HTML/XML tags from user-controlled fields
- `sanitizeForContext()` provides lighter sanitization for RAG results and knowledge chunks
- User messages are wrapped in tagged envelopes to prevent role confusion

### Plugin Isolation

- Plugin SDK objects are frozen (immutable) at creation
- Plugins receive sanitized configuration (no API keys or sensitive fields)
- Each plugin gets an isolated SQLite database
- Manifest validation enforces SDK version compatibility
- Tool definitions are validated before registration

### Wallet Security

- Wallet files are stored with `0600` permissions (owner read/write only)
- Key derivation (PBKDF2) results are cached to avoid repeated computation
- Financial tools (`ton_send`, `jetton_send`, `stonfi_swap`) are restricted to DM-only scope

### Workspace Sandboxing

- `validateReadPath()` and `validateWritePath()` prevent path traversal attacks
- File operations are restricted to `~/.teleton/workspace/`
- Allowed file extensions are explicitly whitelisted
- File size limits are enforced per media type

### URL Sanitization

- Blocks `javascript:`, `data:`, `vbscript:`, and `file:` protocol URLs in tool outputs

### Network Security

- WebUI binds to `localhost` by default
- Bearer token authentication for all WebUI API endpoints
- CORS restricted to configured origins
- Telegram flood wait handling respects server-provided backoff timers

## Responsible Use

Teleton Agent operates as a Telegram userbot. Users are responsible for:

- Complying with [Telegram's Terms of Service](https://telegram.org/tos)
- Securing their API credentials and wallet mnemonics
- Configuring appropriate access policies (admin IDs, DM/group policies)
- Monitoring agent behavior in group chats
