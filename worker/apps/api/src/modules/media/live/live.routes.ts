import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { jsonCreated, jsonOk, validator } from "@/shared/lib/openapi";
import { requireMediaDb } from "../db";
import { doc, httpUrl, idParam, nameText, nullableText, record, reorderBody } from "../shared/http";
import {
  createChannel,
  createGroup,
  deleteChannel,
  deleteGroup,
  exportM3u,
  getEpg,
  importM3u,
  listChannels,
  listGroups,
  reorderChannels,
  reorderGroups,
  setEpg,
  updateChannel,
  updateGroup,
} from "./live.service";

const groupSchema = z.object({
  id: z.string(),
  name: z.string(),
  sort: z.number(),
  channelCount: z.number().optional(),
});

const liveStreamSchema = z.object({
  id: z.string(),
  url: z.string(),
  label: z.string().nullable(),
  userAgent: z.string().nullable(),
  referer: z.string().nullable(),
  sort: z.number(),
});

const channelSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  number: z.number().nullable(),
  name: z.string(),
  tvgId: z.string().nullable(),
  logo: z.string().nullable(),
  enabled: z.boolean(),
  sort: z.number(),
  streams: z.array(liveStreamSchema),
});

// Live streams come over more than http: multicast, RTMP, RTSP.
const liveUrl = z.string().trim().max(2000).regex(/^(?:https?|rtmp|rtsp|rtp|udp|p2p):\/\/\S+$/i, "must be a stream URL");

const channelFields = z.object({
  groupId: z.string().max(64),
  name: nameText,
  number: z.number().int().positive().nullable().optional(),
  tvgId: nullableText(100).optional(),
  logo: httpUrl.nullable().optional(),
  enabled: z.boolean().optional(),
  streams: z.array(z.object({
    url: liveUrl,
    label: nullableText(50).optional(),
    userAgent: nullableText(500).optional(),
    referer: httpUrl.nullable().optional(),
  })).max(50).optional(),
});

const importResultSchema = z.object({
  groups: z.number(),
  channels: z.number(),
  streams: z.number(),
  skipped: z.number(),
});

export function liveRoutes() {
  const router = new Hono<AppEnv>();

  router.get("/media/live/groups", doc("List live channel groups", jsonOk(z.array(groupSchema))), async c =>
    c.json({ success: true, data: await listGroups(requireMediaDb()) }));

  router.post("/media/live/groups", doc("Add a live channel group", jsonCreated(groupSchema)), validator("json", z.object({ name: nameText })), async (c) => {
    const row = await createGroup(requireMediaDb(), c.req.valid("json").name);
    await record(c, "media.live.group.created", { type: "media_live_group", id: row.id, name: row.name });
    return c.json({ success: true, data: row }, 201);
  });

  router.post("/media/live/groups/reorder", doc("Reorder live channel groups", jsonOk(z.object({
    count: z.number(),
  }))), validator("json", reorderBody), async (c) => {
    const { ids } = c.req.valid("json");
    await reorderGroups(requireMediaDb(), ids);
    return c.json({
      success: true,
      data: { count: ids.length },
    });
  });

  router.patch("/media/live/groups/:id", doc("Rename a live channel group", jsonOk(groupSchema)), validator("param", idParam), validator("json", z.object({ name: nameText })), async (c) => {
    const row = await updateGroup(requireMediaDb(), c.req.valid("param").id, c.req.valid("json").name);
    await record(c, "media.live.group.updated", { type: "media_live_group", id: row.id, name: row.name });
    return c.json({ success: true, data: row });
  });

  router.delete("/media/live/groups/:id", doc("Delete a live channel group with its channels", jsonOk(groupSchema)), validator("param", idParam), async (c) => {
    const row = await deleteGroup(requireMediaDb(), c.req.valid("param").id);
    await record(c, "media.live.group.deleted", { type: "media_live_group", id: row.id, name: row.name });
    return c.json({ success: true, data: row });
  });

  router.get("/media/live/groups/:id/channels", doc("A group's channels with their streams", jsonOk(z.array(channelSchema))), validator("param", idParam), async c =>
    c.json({ success: true, data: await listChannels(requireMediaDb(), c.req.valid("param").id) }));

  router.post("/media/live/channels", doc("Add a live channel", jsonCreated(channelSchema)), validator("json", channelFields), async (c) => {
    const row = await createChannel(requireMediaDb(), c.req.valid("json"));
    await record(c, "media.live.channel.created", { type: "media_live_channel", id: row.id, name: row.name });
    return c.json({ success: true, data: row }, 201);
  });

  router.post("/media/live/channels/reorder", doc("Reorder live channels", jsonOk(z.object({
    count: z.number(),
  }))), validator("json", reorderBody), async (c) => {
    const { ids } = c.req.valid("json");
    await reorderChannels(requireMediaDb(), ids);
    return c.json({
      success: true,
      data: { count: ids.length },
    });
  });

  router.patch("/media/live/channels/:id", doc("Update a live channel; `streams` replaces its streams", jsonOk(channelSchema)), validator("param", idParam), validator("json", channelFields.partial()), async (c) => {
    const row = await updateChannel(requireMediaDb(), c.req.valid("param").id, c.req.valid("json"));
    await record(c, "media.live.channel.updated", { type: "media_live_channel", id: row.id, name: row.name });
    return c.json({ success: true, data: row });
  });

  router.delete("/media/live/channels/:id", doc("Delete a live channel", jsonOk(channelSchema)), validator("param", idParam), async (c) => {
    const row = await deleteChannel(requireMediaDb(), c.req.valid("param").id);
    await record(c, "media.live.channel.deleted", { type: "media_live_channel", id: row.id, name: row.name });
    return c.json({ success: true, data: row });
  });

  router.post(
    "/media/live/import",
    doc("Copy an M3U or TVBox txt playlist into the channels (dryRun previews; replace clears them first)", jsonOk(importResultSchema)),
    validator("json", z.object({
      text: z.string().min(1).max(2_000_000),
      replace: z.boolean().optional(),
      dryRun: z.boolean().optional(),
    })),
    async (c) => {
      const { text, ...options } = c.req.valid("json");
      const result = await importM3u(requireMediaDb(), text, options);
      if (!options.dryRun)
        await record(c, "media.live.imported", { type: "media_live", id: "playlist", name: `${result.channels} channels` }, { ...result, replace: options.replace ?? false });
      return c.json({ success: true, data: result });
    },
  );

  router.get("/media/live/export", doc("The enabled channels as M3U", jsonOk(z.object({
    text: z.string(),
  }))), async c =>
    c.json({
      success: true,
      data: { text: await exportM3u(requireMediaDb()) },
    }));

  router.get("/media/live/epg", doc("EPG (XMLTV) urls passed on to players", jsonOk(z.array(z.string()))), async c =>
    c.json({ success: true, data: await getEpg(requireMediaDb()) }));

  router.put("/media/live/epg", doc("Set the EPG (XMLTV) urls", jsonOk(z.array(z.string()))), validator("json", z.object({
    urls: z.array(httpUrl).max(10),
  })), async (c) => {
    const urls = await setEpg(requireMediaDb(), c.req.valid("json").urls);
    await record(c, "media.live.epg.updated", { type: "media_live", id: "epg", name: "EPG" }, { urls });
    return c.json({ success: true, data: urls });
  });

  return router;
}
