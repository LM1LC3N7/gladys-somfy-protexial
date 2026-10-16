# TODO — Somfy Protexial / Protexiom v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm run audit`, then update README, `docs/fr.md`, `docs/en.md`,
  `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).
- No forum topic of its own, ever, and no forum post from a module session:
  the module was claimed in /t/10385 (post #214); the main session posts one
  recap there, with a link to the repo, once published.

## Status

- [x] **Milestone 1 — core** (2026-10-16): own client on `node:http` for the
      four web interfaces of the reference integration (Protexial, Protexial
      IO, Protexiom, Protexiom ALT), detection of the interface and of its
      language prefix, one login / read / logout session per operation,
      error page codes, 0x0811 retried once, 0x0902 left alone for five reads
      then taken over; authentication card typed (30 codes or `A1=…`) or
      imported in two clicks of a configuration action; alarm device (mode
      select, zone switches, triggered, intrusion, doors and windows, tamper,
      batteries, radio, GSM, camera), shutters and lights devices; arming
      allowed / disarming opt-in, every arm and disarm logged; scene
      triggers `alarm_triggered`, `alarm_armed`, `alarm_disarmed`,
      `intrusion_or_tamper`, `battery_low`; scene action and button
      `reset_faults`; "Test the connection", "Read the panel now"; reads every
      60 s armed / 5 min disarmed, backoff; logins stopped after a refused
      user code or two refused card codes; fr/en names; docs fr/en. Tested
      against a simulated panel of each interface only (102 tests in memory
      and over loopback HTTP; the Docker image read-only under 256 MB /
      0.5 CPU detects, reads, arms, disarms and clears faults on the
      simulated panel of each interface over a Docker network, RSS 68 MB:
      `~/gladys-integrations/e2e/protexial-image-check.sh <model>`).
- [ ] **Milestone 2 — real panel**: run against real panels (one Protexial,
      one Protexial IO, one Protexiom at least) and fix what differs (see
      "To check on a real panel"); turn real pages (anonymized: no card
      codes) into fixtures.
- [ ] **Milestone 3 — more**: one device per element of the panel from the
      elements page (`u_listelmt.htm`: door contacts open/closed, detectors,
      sirens, keypads, remotes with battery, radio link, tamper — the
      reference's `item_label`, `elt_*` arrays), read only when status.xml
      changed or a door is open (the reference's rule); the event journal
      (`journal.htm`, the last 10 events) as a text feature and a scene
      trigger; GSM text in the other interface languages.
- [ ] **Milestone 4 — first release**: cover image, Docker image build check,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic, GHCR package public.

## To check on a real panel

- The login: does a GET of the login page change the cell asked (the import
  relies on it NOT changing until the next POST)? Does the panel set a
  session cookie before the login (kept anyway)? Where does a successful
  login land (`u_pilotage.htm`, `default.htm`)?
- The logout: does `/logout.htm` free the session at once on every
  interface, so that a browser can log in right after a read?
- `(0x0902)` with a browser logged in: does "OK" on the error page (taken
  over after five reads) close the browser's session, or only acknowledge?
  How long does an abandoned session last?
- The lock after wrong codes: how many tries (`lockAfter` is 3 in the fake),
  how long, and whether a wrong card code and a wrong user code count the
  same.
- status.xml values: `defaut*` when not ok (`nok`? `nok_int`?), the GSM text
  of a panel without GSM or out of network, `recgsm` range, `camera` values,
  the German / English texts. The empty status.xml bug: how often with one
  session per read (the reference saw it with long sessions).
- Arming: does `Marche A` while B is armed keep B? Does arming an armed zone
  answer an error? Does the zone show `on` right after the POST (exit delay)?
  Same for the Protexiom `zone` field and the Protexial IO button values.
- Disarm then arm in one session (mode change that drops a zone): is the 1 s
  pause between the forms enough?
- The card page of each interface: exactly 30 `td` without class, row by row
  (`u_print.htm`, `u_challenge.htm`, `a_print.htm`), and the code lengths.
- `reset_faults`: which page accepts the "Effacer" forms on each interface
  (`/fr/u_listelmt.htm` first, `/u_listelmt.htm` on a 404).
- Battery: the effect of the 5-minute disarmed interval on the panel's
  batteries compared with the reference's 60 s.
- Protexiom 600 (2009): pdecat/HASS-Somfy-Protexiom uses the mobile pages
  (`m_login.htm`, `mu_pilotage.htm`, `mu_etat.htm`): check that the desktop
  pages (`login.htm`, `status.xml`) exist on it too, or add a fifth model.

## Decisions

- **Not a duplicate** (checked 2026-10-16): the Gladys core master
  (165e0d9, after 5.2.1, 39 services) has nothing for these panels
  (`git grep -i protexi` empty in `server/` and `front/`). The main session
  checked the store index (474 entries), GitHub and the forum on the same
  day: no Protexial / Protexiom integration, no claim but ours (/t/10385
  post #214). Neighbours, for different hardware:
  - [prohand/gladys-somfyprotect](https://github.com/prohand/gladys-somfyprotect)
    (1.0.1, 2026-10-14): **Somfy Protect**, the newer range (Home Alarm,
    Somfy One / One+, Link), through the Somfy Protect cloud. Protexial /
    Protexiom panels are not Somfy Protect devices: they have no account
    there. Users of the newer range use it; users of these panels use ours.
  - [cicoub13/gladys-overkiz](https://github.com/cicoub13/gladys-overkiz)
    (1.6.2, 2026-10-13): TaHoma / Connexoon through the Overkiz cloud. A
    Protexial IO can be paired with a TaHoma, but its README lists `Alarm`
    as "not mapped yet": TaHoma users keep it for their shutters and use
    ours for the alarm. If Overkiz maps the alarm one day, a Protexial IO
    behind a TaHoma could use either; the docs say which to pick.
- **Own client, no dependency** (Louis's rule: reuse maintained work, rewrite
  dead or debt-heavy code). npm has no client of these panels (searches
  `protexial`, `protexiom`, `somfy alarm`, 2026-10-16: only TaHoma and Somfy
  Protect packages). The references are Python Home Assistant integrations:
  - [AuroreVgn/somfy-protexial](https://github.com/AuroreVgn/somfy-protexial)
    (MIT, 2.2.1 of 2026-10-12, active fork, commits on 2026-10-16): the
    protocol documentation of this client (page paths, selectors, forms,
    encodings, error codes, detection order, card page, status.xml,
    workarounds). It ships no test pages: our fixtures are shaped after its
    selectors and screenshots, credited in `test/fixtures/pages.js`.
  - [the8tre/somfy-protexial](https://github.com/the8tre/somfy-protexial)
    (MIT, archived): its upstream.
  - [pdecat/HASS-Somfy-Protexiom](https://github.com/pdecat/HASS-Somfy-Protexiom)
    (no licence, 2021, Protexiom 600 mobile pages): read for the error codes
    only, nothing copied.
    About 1,200 lines on `node:http` (HTTP and the per-session browser
    ~250, an HTML reader for the reference's CSS selectors ~270, the models,
    parsers and panel client). Runtime dependencies: the SDK only;
    `npm audit` clean.
- **One session per operation** (the brief, and the reference's FAQ: the
  panel serves one session; a session kept open blocks the Somfy web page):
  login, work, logout every time. Costs a login per read; the reference
  keeps its session open and re-logs on errors. Commands read the zones in
  the same session before deciding (a mode change is planned on the real
  state, not on the last poll), then read them again.
- **Never repeat a command by itself**: a failed POST is reported to Gladys,
  not retried (the reference's "retry once with a fresh login" is kept for
  reads only, as "next read"). 0x0811 at login is retried once after 5 s, as
  the reference does; 0x0902 is never taken over at once (it may be the user
  in a browser), only after five reads in a row.
- **Lockout guard**: a refused user code (0x0812 / 0x0901 / 0x0810) or
  0x0904 stops the logins; a refused card code (0x0B00 / 0x1101 / 0x1100)
  is reported with its cell and two in a row stop; a cell missing from the
  card is reported without a login. Resumed by a configuration change or
  "Test the connection" (the surepetcare / toshiba-ac rule).
- **The card**: the reference never asks for the grid. It asks the code of
  the cell the panel shows, logs in with it and reads the card print page.
  Gladys has no multi-step form, so the import is a configuration action in
  two clicks (the first reads the cell and pauses the reads for 5 minutes so
  the cell stays the same, the second posts the code without reloading the
  login page), saving the 30 codes with `setConfig` in the `auth_card` secret
  field. The hand-typed grid stays possible (lost access to the panel page,
  or a card page this client does not read). Stored as `A1=1234 B1=…`.
  The import's code fields are `secret` action fields; the administrator
  code of the ALT Protexiom is used once and not stored.
- **Alarm mode = `text`/`select`** with the zone combinations (`off`, `a`,
  `b`, `c`, `ab`, `ac`, `bc`, `abc`, frozen): Gladys has no alarm-panel
  feature (its alarm modes belong to the house), as gladys-somfyprotect did.
  Plus one `switch`/`binary` per zone for scenes and dashboards. The panel
  only disarms the three zones together ("Arrêt A B C"): a mode that drops a
  zone disarms, then re-arms the zones asked; a zone switch turned off
  disarms the three (documented).
- **Disarming opt-in, arming allowed** (like DoorBird / UniFi Access door
  opening): `allow_disarm` false by default, `allow_arm` true; checked before
  any login on the last reading, and again on the fresh one. Every arm and
  disarm (asked, refused or seen on the panel) is logged at info / warn.
- **Triggered**: the reference reports TRIGGERED when a zone is armed and
  `defaut3` is not ok. The flag is latched until cleared, so arming over an
  old detection would read as triggered: here a flag latched before the
  arming does not count (it needs to appear while armed, or between the two
  readings that saw the arming); after a restart the reference's rule
  applies.
- **Faults as Gladys categories**: `defaut0` batteries -> `battery-low`,
  `defaut1` radio -> `input` (1 = link OK, the core has no connectivity
  category), `defaut2` -> `opening-sensor` (1 closed, the core convention),
  `defaut3` -> `motion-sensor` "intrusion detected", `defaut4` -> `tamper`;
  GSM -> `input`, `signal` 0-5 and operator `text`; camera -> `input`. The
  optional ones only when status.xml has the tag.
- **Shutters `shutter`/`state`** 1 open / -1 close / 0 stop, no position
  (the panel has none); **lights `light`/`binary`**, state = the last
  command (the panel does not report it), as the reference does.
- **Polling**: the panel runs on batteries (the mains only feeds its
  Ethernet module, reference wiki): 60 s while armed (30–3600), 5 min while
  disarmed (30–86400), the reference's advice of a variable interval. Own
  timer, not the Gladys `onPoll` (1 min at most, one interval).
- **One panel per integration, ids without the address**:
  `alarm:panel`, `shutters:panel`, `lights:panel`; a new DHCP lease keeps
  the devices. The panel has no serial in its pages.
- **Scene events**: one per transition between two readings, none on the
  first reading; `by_gladys` tells a change Gladys asked for (5 minutes).
  Events go through `publishSceneEvent` (a handful per day: no queue).
- **Element list and event journal** left for milestone 3: the reference
  reads them conditionally (elements only when status.xml changed or a door
  is open, the journal every 5 minutes) and they need real pages to map the
  element labels in every language.
