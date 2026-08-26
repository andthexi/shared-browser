# Shared Browser

Shared Chromium instance exposed through a localhost-only native VNC server.

## Quick start

```bash
npm install
npx playwright install chromium
npm run link:local
shared-browser start
```

All CLI commands emit JSON. The supervisor remains in the foreground; use another shell for control
commands:

```bash
shared-browser status
shared-browser open-url https://example.com
shared-browser inspect
shared-browser stop
```

The browser-control API never submits forms. It allows reviewed navigation clicks, field filling, and
explicit file uploads, but submit-like or ambiguous clicks are rejected.

## Planned runtime architecture

```text
Chromium
   ↓
Xvfb virtual display
   ↓
x11vnc bound to 127.0.0.1
   ↓
Tailscale Serve TCP forwarding (external operator-managed layer)
   ↓
Native VNC client
```

The application will never bind VNC to public or LAN interfaces and will not invoke or modify
Tailscale configuration. Tailscale Serve is configured separately by the operator.

## Required runtime binaries

| Binary | Required for | Notes |
|---|---|---|
| `node` | Application runtime | Node.js 22 or newer |
| `npm` | Dependency installation and project commands | npm 10 or newer |
| `Xvfb` | Headless X11 display | Provides the virtual display Chromium uses |
| Playwright-managed Chromium | Browser runtime | Install explicitly with `npx playwright install chromium` |
| `x11vnc` | Native VNC server | Attaches to the Xvfb display and listens on localhost only |

## External deployment binary

| Binary | Required for | Ownership |
|---|---|---|
| `tailscale` | Optional tailnet access to the localhost VNC port | Installed and managed separately from this application |

Example external forwarding command:

```bash
tailscale serve --tcp=<tailnet-port> tcp://127.0.0.1:<local-vnc-port>
```

Do not use `tailscale funnel`; that would expose the service beyond the tailnet.

## Development/deployment utilities

These are not needed by the running browser service:

- `git` — clone and update the project
- `gh` — create or manage the GitHub repository
- `bash` and standard Unix utilities — process startup and health checks

## Install x11vnc manually on Ubuntu

Run on the target VPS:

```bash
sudo apt update
sudo apt install -y x11vnc
```

Verify the installation:

```bash
x11vnc -version
```

## Security boundary

- VNC must bind to `127.0.0.1`, never `0.0.0.0`.
- Tailscale Serve remains a separate command/service boundary.
- The application must never submit forms automatically; form submission remains manual.

## Hermes skill

The reusable Hermes skill lives in the separate shared configuration repository at
`agents-config/.agents/skills/shared-browser/SKILL.md` and is loaded through Hermes's configured
external skill directory.
