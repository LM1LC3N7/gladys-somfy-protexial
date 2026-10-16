# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Somfy Protexial, Protexiom (incl. 5000 and 600) and Protexial IO alarm
  panels through their local web page: the four known web interfaces and the
  language of the interface (`/fr/`, `/de/`, `/gb/`…) detected by themselves,
  or the model chosen by hand.
- One login / read / logout session per read, none kept open: the Somfy web
  page stays usable between two reads. Another session open is left alone
  for five reads, then taken over.
- The authentication card: imported from the panel in two clicks of
  "Import the card" (the code of the cell asked, then the 30 codes read on
  the card page), or typed by hand.
- An alarm device: mode select (disarmed, one zone, two zones, total), one
  switch per zone, alarm triggered, intrusion detected, doors and windows
  closed, box tamper, low battery, radio link, and GSM link, signal and
  operator and camera link when the panel reports them.
- Arming from Gladys (allowed by default) and disarming (off by default, an
  option of the configuration); every arm and disarm logged.
- A shutters device (open, close, stop) and a lights device (on, off).
- Scene triggers "Somfy alarm triggered", "Somfy zone armed", "Somfy zone
  disarmed" (with a zone filter and whether Gladys asked for it), "Somfy
  intrusion or tamper" and "Somfy low battery"; scene action and button
  "Clear the fault memory".
- Reads every 60 s while armed and every 5 minutes otherwise (the panel runs
  on batteries), backoff after errors, "Read the panel now" and "Test the
  connection" buttons.
- Logins stop after a refused user code or two refused card codes in a row,
  before the panel locks itself, until the configuration changes or the test
  button is clicked.
- Device, feature and mode names in French or English.

[Unreleased]: https://github.com/LM1LC3N7/gladys-somfy-protexial/commits/main
