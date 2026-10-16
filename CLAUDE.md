# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15), its only
runtime dependency (HTTP goes through `node:http`). It drives the older Somfy
alarm panels (Protexial, Protexiom, Protexial IO) through their local web
page: one login / read / logout session per read, the alarm zones, shutters
and lights, faults and scene events. Unofficial, not affiliated with Somfy.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js          SDK bootstrap only
src/handlers.js   every SDK handler -> the app (shared with the tests)
src/app.js        ProtexialApp: poll timer, lockout guard, busy panel, devices,
                  states, scene events, alarm / shutter / light commands with
                  the arm / disarm permissions, card import, buttons
src/panel.js      PanelClient: detection, one session per operation (login,
                  work, logout), error pages, control forms, card import
src/http.js       the only network access (node:http), the per-session
                  browser (cookies, redirections), ISO-8859-15 / UTF-8 forms
src/models.js     the 4 web interfaces: page paths, selectors, forms, encoding
src/parse.js      login cell, error code, footer year, status.xml, card page
src/html.js       small HTML reader + the CSS selectors the reference uses
src/card.js       the authentication card (30 codes)
src/devices.js    -> Gladys devices and states (pure)
src/events.js     two readings -> scene events, triggered state (pure)
src/config.js     config_schema normalized, session key
src/constants.js  manifest keys, Gladys values, Somfy error codes, limits, timings
src/i18n.js       names (fr/en) and status / action messages
test/fixtures/    pages of the 4 interfaces, shaped after the reference
test/helpers/     a fake panel (in memory or HTTP server); Gladys is the SDK's fake
```

## Rules

- **External ids are forever**: devices `alarm:panel`, `shutters:panel`,
  `lights:panel`; features `mode`, `zone-a`, `zone-b`, `zone-c`, `triggered`,
  `motion`, `opening`, `tamper`, `battery-low`, `radio-link`, `gsm-link`,
  `gsm-signal`, `gsm-operator`, `camera-link`, `shutters`, `lights`. Never
  change how they are built.
- Manifest keys (config keys, actions, scene triggers and their fields and
  variables, the scene action) and the mode values (`off`, `a` … `abc`) are
  frozen: users store them in devices and scenes.
- **Safety**: disarming from Gladys stays opt-in (`allow_disarm` false by
  default); a refused command sends nothing to the panel; every arm and
  disarm is logged. Never log or put in a message the user code, the card or
  a cell code.
- **Never lock the panel**: never log in again by itself after a refused
  user code or two refused card codes; never repeat a command POST by
  itself; take over another session only after `LIMITS.busyBeforeReset`
  reads in a row.
- **One session at a time**: every panel access goes through
  `ProtexialApp.exclusive` and a `PanelClient.session` (login, work, logout).
  Never keep a session open between two operations.
- Value conventions: the Somfy side is status.xml's (`on`/`off`, `ok` or a
  fault); the Gladys side the enums of the core `server/utils/constants.js`
  (opening-sensor 1 = closed, shutter 1/0/-1, binary 1 = on), copied in
  `src/constants.js` (the SDK does not export them).
- Container limits: 256 MB RAM, 0.5 CPU, read-only rootfs, only `/data`
  writable (unused: the card lives in the config), bridge network (the panel
  is reached by unicast HTTP). Gladys rate limits: 300 states/min, 300 scene
  events/min.
- Tests never touch the network: the transport is injected (the loopback
  tests run the fake panel on 127.0.0.1).
- Code, comments, README in English; `docs/fr.md` and `docs/en.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.
