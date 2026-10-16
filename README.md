# gladys-somfy-protexial

[Gladys Assistant](https://gladysassistant.com) external integration for the
older **Somfy alarm panels**: Protexial, Protexiom (incl. 5000 and 600) and
Protexial IO, through the panel's **local web interface**, without the Somfy
cloud. The zones A, B and C (state, arming, disarming as an opt-in), the
shutters and lights driven by the panel, the faults (batteries, tamper, radio
link, GSM, doors and windows, intrusion) and scene triggers (alarm triggered,
zone armed / disarmed, intrusion or tamper, low battery). Unofficial, not
affiliated with Somfy.

User documentation: [docs/fr.md](docs/fr.md) · [docs/en.md](docs/en.md).

> **Work in progress (0.1, not published to the store yet).** Tested against a
> simulated panel of each web interface (pages shaped after the reference
> integration), not yet on a real panel. Feedback and bug reports are welcome
> in the [GitHub issues](https://github.com/LM1LC3N7/gladys-somfy-protexial/issues).

For the newer Somfy Protect range (Home Alarm, Somfy One, Link), use
[prohand/gladys-somfyprotect](https://github.com/prohand/gladys-somfyprotect)
instead (see [TODO.md](TODO.md), Decisions).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (ProtexialApp) ⇄ src/panel.js ⇄ src/http.js ⇄ panel web page (HTTP, LAN)
                                   ├─ src/models.js   the 4 web interfaces: paths, selectors, forms, encoding
                                   ├─ src/parse.js    login cell, error codes, status.xml, card page (pure)
                                   ├─ src/html.js     small HTML reader + the reference's CSS selectors
                                   ├─ src/card.js     the authentication card (30 codes)
                                   ├─ src/devices.js  -> Gladys devices and states (pure)
                                   └─ src/events.js   two readings -> scene events (pure)
```

- **One session per operation**: the panel accepts a single session. Each
  read is GET the login page (the cell asked, e.g. `B1`), POST `login=u`,
  the user code and the card code of that cell, GET `/status.xml`, GET
  `/logout.htm`. A command posts its forms to the control page
  (`u_pilotage.htm`) in such a session, after reading the zones, then reads
  the status again. No session is kept open between two reads.
- **Detection**: the root page's redirection gives the interface language
  (`/fr/`, `/de/`…); then `/cfg/vers` and the login page of each interface
  are tried in the reference's order (Protexial IO, Protexial, Protexiom,
  Protexiom ALT) until its selector finds the cell asked. Forms are encoded
  in ISO-8859-15, or UTF-8 for the Protexial IO.
- **Errors**: the panel redirects to its error page with a code
  (`(0x0B00)` wrong card code, `(0x0812)` wrong user code, `(0x0904)` too
  many attempts, `(0x0902)` session already open, `(0x0811)` access rights,
  retried once after 5 s as the reference does). A refused user code stops the
  logins; two refused card codes in a row too (before the panel locks
  itself). Another session open is left alone for 5 reads, then taken over.
- **Card**: typed by hand (30 codes row by row, or `A1=1234 …`) or imported
  from the panel in two clicks of a configuration action: the first reads the
  cell asked, the second logs in with its code and reads the card print page
  (`u_print.htm`, `u_challenge.htm` or `a_print.htm` with the administrator
  account on the ALT Protexiom), then saves it with `setConfig`.
- **Devices**: `ext:<selector>:alarm:panel` (mode `text`/`select` with the
  zone combinations, one `switch` per zone, `siren` triggered, `motion-sensor`,
  `opening-sensor`, `tamper`, `battery-low`, `input` links, GSM `signal` and
  operator `text`), `ext:<selector>:shutters:panel` (`shutter`/`state`
  1/0/-1) and `ext:<selector>:lights:panel` (`light`/`binary`, the last
  command). The ids do not depend on the panel address.
- **Safety**: arming allowed by default, disarming opt-in (off by default);
  the panel only disarms the three zones together. Every arm and disarm,
  asked from Gladys or seen on the panel, is logged.
- **Polling**: 60 s while a zone is armed, 5 min otherwise (the panel runs on
  batteries), backoff 1/2/5/10/15 min after errors.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/pages.js` holds the pages of the four interfaces, shaped after
the selectors, forms and screenshots of the reference integration (made-up
codes); `test/helpers/fakePanel.js` serves them like a panel (redirections,
session cookie, one session at a time, a new cell at each login, lock after
wrong codes), in memory or on a real HTTP server for the loopback tests.

## Credits

No JavaScript client of these panels exists on npm (see [TODO.md](TODO.md),
Decisions): the client is our own, written from the behaviour documented by
these projects, read as protocol documentation:

- [AuroreVgn/somfy-protexial](https://github.com/AuroreVgn/somfy-protexial)
  (MIT, © 2021 the8tre), the maintained Home Assistant integration (2.2.1,
  2026-10-12): page paths, selectors, form fields and encodings of the four
  interfaces, error codes, status.xml tags, detection order, card print page,
  session workarounds, panel battery advice;
- its upstream [the8tre/somfy-protexial](https://github.com/the8tre/somfy-protexial)
  (MIT, no longer maintained);
- [pdecat/HASS-Somfy-Protexiom](https://github.com/pdecat/HASS-Somfy-Protexiom)
  (Protexiom 600, 2009): error codes and the elements page.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic is added at the first real release only.

## License

Apache-2.0. Somfy, Protexial and Protexiom are trademarks of Somfy; this
project is not affiliated with Somfy.
