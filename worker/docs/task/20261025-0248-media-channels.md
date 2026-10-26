# 20261025-0248-media-channels Show media titles per device channel

- **status**: closed
- **priority**: P1
- **owner**: claude/session-8665717e
- **createdAt**: 2026-10-25 02:48

## Description

The user wants media titles visible per device channel. Each device belongs to one channel, created in the console, and a title can be limited to some channels; an unrestricted title is visible everywhere. With channels in place, `media_published` is dropped and `publish_state` alone decides what is live, so a test channel replaces the publish gate for previews.

Acceptance:

- restricted titles are hidden from devices on other channels, and from devices without a channel, across `/media/v1/*` and `/media/cms`;
- devices on one channel share cache entries;
- edits show without a publish;
- `bun run check` and `bun run test:workers` pass.

## ActiveForm

Showing media titles per device channel

## Dependencies

- **blocked by**: 20261025-0124-media-serve-from-source
- **blocks**: (none)

## Notes

Plan: docs/plan/20261025-0248-media-channels.md

- close: superseded by 20261025-2028-media-clients: the media library becomes standalone instead of per tvbox device
