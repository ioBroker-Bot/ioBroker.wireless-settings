# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ioBroker adapter that configures Wi-Fi and Ethernet on Linux hosts (primarily Raspberry Pi) via `nmcli` / NetworkManager. The adapter itself runs in Node.js on the device; all networking work is delegated to `nmcli` shell-outs. Linux-only at runtime — development on Windows/macOS is fine, but the adapter only does anything useful on a Linux machine where `nmcli` exists and the `iobroker` user has sudo rights for it (see `wlan_rights.sh`).

## Commands

| Task | Command |
|------|---------|
| Build everything (TS adapter + React admin UI, copied into `admin/`) | `npm run build` |
| Compile only the TS adapter (skip admin UI) | `npm run tsc` |
| Lint (both root and `src-admin/`) | `npm run lint` |
| Run all tests (unit + package validation) | `npm test` |
| Unit tests only | `npm run test:unit` |
| Integration tests (spins up a real adapter) | `npm run test:integration` |
| Run a single mocha test file | `npx mocha path/to/file.test.js --exit` |
| Bump patch + release | `npm run release` (also `release-minor`, `release-major`) |
| Dev-run the React admin UI standalone | `cd src-admin && npm start` (Vite on :3000, proxies to ioBroker admin on :8082) |

`npm run build` runs `tsc -p tsconfig.build.json` (adapter → `build/`) then `node tasks`, which npm-installs in `src-admin/`, builds the React app with Vite, copies the output into `admin/`, patches the html, and renames `admin/index.html` to `admin/index_m.html` — the file ioBroker serves when `materialize: true` is set in `io-package.json`.

## Architecture

### Admin UI

The single admin UI lives in `src-admin/` — a React + MUI + Vite app built against `@iobroker/adapter-react-v5`'s `GenericApp`. Its build output (`admin/index_m.html` + `admin/assets/...`) is what ioBroker serves. The entry component is `src-admin/src/App.jsx`.

### Adapter ↔ UI protocol

`src/main.ts` (class `NetworkSettings`) handles these `sendTo` message commands, all invoked from the admin UI:

- `interfaces` → list network interfaces with live status + profile config (DHCP/static, IP, gateway, DNS)
- `wifi` → scan and return visible Wi-Fi networks (dedupes SSIDs, keeps strongest)
- `dns` → system DNS servers from Node's `dns.getServers()`
- `wifiConnection` → active connection name for an interface
- `wifiConnect` / `wifiDisconnect` → manage Wi-Fi associations
- `setInterfaceConfig` → change IPv4 settings on a profile (DHCP vs static, addresses, gateway, DNS)

If adding a command, wire it in both the `message` callback of the adapter constructor and the UI's `sendTo` caller.

### `nmcli` shell-out conventions in `main.ts`

- All shell execution goes through `execFileAsync()`. It uses `execFile` (not `exec`) with argv arrays — never concatenate user-supplied strings into a shell command. `sudo: true` prepends sudo; `logCommand` lets you log a sanitized form (e.g. `password ***`).
- `cmdRunning` is set while any command is in flight; `unload()` waits up to 4s for it to clear so we don't kill nmcli mid-reconfigure.
- `parseTable()` parses whitespace-aligned `nmcli` tabular output by column position (header-driven). `parseList()` / `firstNonEmptyLine()` handle `-g` single-field output.
- Applying a config change uses `scheduleConnectionApply()` — a deferred `nmcli device reapply`, falling back to `connection up ... ifname`. The defer exists because the reapply can kill the admin's own TCP connection.
- For Ethernet interfaces without a pre-existing profile, `ensureEthernetConnection()` creates `ioBroker-<iface>` on demand so static IPs can be assigned.

### Build layout

- `src/main.ts` → `build/main.js` (adapter entry, see `package.json` `main`).
- `src-admin/` is a self-contained npm project with its own `package.json`, `tsconfig.json`, and `eslint.config.mjs`. `tasks.js` runs its install + build. Root `tsconfig.json` explicitly excludes `src-admin/`.
- `tsconfig.json` is type-check-only (`noEmit: true`); `tsconfig.build.json` is the one that emits to `build/`.
- Only `admin/`, `build/`, `wlan_rights.sh`, `io-package.json`, `LICENSE` ship to npm (see `files` in `package.json`).

### Tests

`test/unit.js`, `test/integration.js`, `test/package.js` are thin wrappers around `@iobroker/testing`'s `tests.unit/integration/packageFiles(...)`. They test adapter lifecycle and package metadata, not the `nmcli` logic itself. Integration tests require a working Node environment but don't need `nmcli`.

## Runtime permissions

On the target device, `iobroker` must be able to run `nmcli` under sudo without a password. `wlan_rights.sh` writes the sudoers line. If adding new external commands, add them to that script too — otherwise they'll silently fail in prod.
