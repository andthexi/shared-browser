# Shared Browser

Shared Chromium instance exposed through a localhost-only Xpra display session.

## Quick start

```bash
npm install
npx playwright install chromium
npm run link:local
shared-browser start
```

The default display is `1920x1080`. For smaller phone viewing, use Xpra HTML5's client-side width
override without changing the server display:

```text
https://<tailscale-hostname>:<tailnet-port>/?override_width=1280
```


```bash
tailscale serve --http=<tailnet-port> http://127.0.0.1:<xpra-port>
```

Open the forwarded Tailscale URL in a browser for Xpra's HTML5 client. Tailscale remains external and
is not configured by this application.

```bash
shared-browser status
shared-browser open-url https://example.com
shared-browser inspect
shared-browser stop
```

The browser-control API never submits forms. It allows reviewed navigation clicks, field filling, and
explicit file uploads, but submit-like or ambiguous clicks are rejected.

## Runtime architecture

```text
Xpra desktop display :99
   ↓
Playwright-managed Chromium
   ↓
Xpra HTML5 / native client endpoint on 127.0.0.1:14500
   ↓
Tailscale Serve (external operator-managed layer)
   ↓
Browser or native Xpra client
```

The application binds Xpra to localhost only and never invokes or modifies Tailscale configuration.
Tailscale Serve is configured separately by the operator.

## Required runtime binaries

| Binary | Required for | Notes |
|---|---|---|
| `node` | Application runtime | Node.js 22 or newer |
| `npm` | Dependency installation and project commands | npm 10 or newer |
| Playwright-managed Chromium | Browser runtime | Install explicitly with `npx playwright install chromium` |
| `xpra` | Persistent remote display server | Starts the virtual display, exposes HTML5/native Xpra access, and listens on localhost only |

## External deployment binary

| Binary | Required for | Ownership |
|---|---|---|
| `tailscale` | Optional tailnet access to the localhost Xpra endpoint | Installed and managed separately from this application |

Example external forwarding command:

```bash
tailscale serve --http=<tailnet-port> http://127.0.0.1:<xpra-port>
```

Do not use `tailscale funnel`; that would expose the service beyond the tailnet.

## Development/deployment utilities

These are not needed by the running browser service:

- `git` — clone and update the project
- `gh` — create or manage the GitHub repository
- `bash` and standard Unix utilities — process startup and health checks

## Install Xpra manually on Ubuntu

The Ubuntu 24.04 archive may provide an outdated Xpra build and may not include the HTML5 client.
Use Xpra's official Noble repository:

```bash
sudo apt update
sudo apt install -y apt-transport-https software-properties-common ca-certificates wget
sudo wget -O /usr/share/keyrings/xpra.asc https://xpra.org/xpra.asc
sudo wget -O /etc/apt/sources.list.d/xpra.sources \
  https://raw.githubusercontent.com/Xpra-org/xpra/master/packaging/repos/noble/xpra.sources
sudo apt update
sudo apt install -y xpra
```

Verify the installation:

```bash
xpra --version
```

## Security boundary

- Xpra must bind to `127.0.0.1`, never `0.0.0.0`.
- Tailscale Serve remains a separate command/service boundary.
- The application must never submit forms automatically; form submission remains manual.

## Hermes skill

The reusable Hermes skill lives in the separate shared configuration repository at
`agents-config/.agents/skills/shared-browser/SKILL.md` and is loaded through Hermes's configured
external skill directory.
