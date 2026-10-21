# 20261017-0110-redesign-phone-control-web Redesign the phone control web page

- **status**: completed
- **priority**: P1
- **owner**: claude/session-tvbox-remote
- **createdAt**: 2026-10-17 01:10

## Description

Rebuild the LAN phone-control page (`assets/web/`) around a remote-first information architecture modelled on Apple TV Remote, Google TV, Plex and Jellyfin remotes:

- Remote tab (default): now-playing card with scrubber and transport, D-pad, back/menu, volume, text entry.
- Search tab: keyword or link in one field; results fetched from the TV's sites and shown on the phone; a detail sheet lists lines and episodes; tapping an episode plays it on the TV.
- Library tab: continue watching (history with progress) and favourites, playable from the phone.
- More tab: configs, sources, settings, server link, paired devices, files; no longer the landing page.

Server side: new catalog port and `/api/search` (results JSON, polled), `/api/detail`, `/api/play`, `/api/library`; the page drops jQuery.

Acceptance:

- Opening the page lands on the Remote tab; the QR code no longer selects the config tab.
- A keyword search returns per-site results on the phone within the existing search timeouts; an episode tapped on the phone starts playing on the TV.
- History and favourites of the active config are listed with progress; tapping resumes on the TV.
- Every existing function (configs, settings, enroll, devices, files, push, remote keys) still works from the More/Remote tabs.
- `npm test`, `npm run lint`, `npm run typecheck` pass; `src/lan/web/assets.generated.ts` is regenerated.

## ActiveForm

Redesigning the phone control web page

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: `docs/plan/20261017-0111-redesign-phone-control-web.md`.

- complete: Full suite (133 suites), typecheck and lint pass; page verified in Playwright against a mock server.
