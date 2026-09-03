# Shared Browser

Shared Chromium instance exposed through a localhost-only native VNC server.

## Quick start

```bash
npm install
npx playwright install chromium
npm run link:local
shared-browser start
```

`shared-browser logs` returns JSON with the configured log path and lines. `--tail N` limits the
returned lines; `--follow` streams operational lines until interrupted. The log contains only
supervisor and child-process lifecycle/stderr output—not page text, form values, or control responses.

The log is reset on each new successful start and defaults to `./runtime/shared-browser.log`.
The supervisor PID defaults to `./runtime/shared-browser.pid`. Both paths can be overridden with
`LOG_FILE` and `PID_FILE` in `.env`.

The CLI loads the repository-root `.env`, not the `.env` in the directory where it is invoked. Relative
profile, socket, log, and PID paths are also anchored to the project root, so `shared-browser status`
and `shared-browser start` work from another directory.

The supervisor runs in the background. Start is idempotent and waits for readiness:

```bash
shared-browser start
# Local desktop mode: native headed Chromium, skip Xvfb/x11vnc
shared-browser start --local
shared-browser status
shared-browser logs --tail 50
shared-browser logs --follow
shared-browser list-tabs
shared-browser list-unbound-tabs
shared-browser open-url <tabId> https://example.com
shared-browser inspect <tabId>
shared-browser click <tabId> https://example.com '{"role":"button","name":"Show form"}'
shared-browser fill <tabId> https://example.com '[{"target":{"label":"Name"},"value":"Ada"}]'
shared-browser close-tab <tabId>
```

The browser-control API uses caller-supplied stable `tabId` values, normally the job-search opportunity ID, so independent forms remain isolated in separate tabs. Mutating operations require the expected origin and fail closed on mismatch. Restored pages remain unbound until explicitly re-associated after employer, role, origin, and form identity checks.

`BRING_TABS_TO_FRONT` defaults to `true`, preserving the existing behavior where `click` and `fill`
activate the browser window before acting. Set it to `false` (or `0`) in `.env` to keep the browser
window in the background while performing those actions. Restart the service after changing it.

The target object supports an optional explicit `frame` scope for `click` and `fill`:

```json
{"frame":{"url":"https://payments.example.com/checkout/","name":"payment-frame"},"role":"button","name":"Continue"}
```

Frame URLs must be absolute HTTP(S) URLs and match the exact scheme/origin plus a path prefix;
frame names match exactly. A frame selector never falls back to the top-level document. Missing and
ambiguous matches fail closed with `frame_not_found` or `ambiguous_frame` and include at most 20
candidate frame descriptors.

`inspect` retains the top-level `elements` field and adds bounded `frames` entries containing each
frame's URL, name, parent URL, nested path, and interactive element metadata. Input values are not
returned. Nested and cross-origin frames are supported through Playwright's frame abstraction.

The browser-control API never submits forms. It allows reviewed navigation clicks, field filling, and
explicit file uploads, but submit-like or ambiguous clicks are rejected.

`shared-browser start --local` launches native headed Chromium without forwarding `$DISPLAY` or
`$XAUTHORITY`. It skips Xvfb and x11vnc and opens Chromium through the device's native desktop
windowing system. Local status reports `mode: "local"` and `xvfb`/`x11vnc` as `not-used`. If the
service is already running, `start --local` is idempotent and returns the existing status without
switching modes; stop first to change modes.

The default display is `1680x945`. Change `SCREEN_WIDTH` and `SCREEN_HEIGHT` in the local `.env`
when using a different VNC display.

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
