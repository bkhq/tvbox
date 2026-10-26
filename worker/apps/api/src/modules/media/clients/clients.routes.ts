import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { jsonCreated, jsonOk, validator } from "@/shared/lib/openapi";
import { requireMediaDb } from "../db";
import { doc, idParam, nameText, record, reorderBody } from "../shared/http";
import {
  createChannel,
  createClient,
  deleteChannel,
  deleteClient,
  listChannels,
  listClients,
  reorderChannels,
  rotateClientToken,
  updateChannel,
  updateClient,
} from "./clients.service";

const channelSchema = z.object({
  id: z.string(),
  name: z.string(),
  sort: z.number(),
  titleCount: z.number(),
  clientCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const clientSchema = z.object({
  id: z.string(),
  name: z.string(),
  token: z.string(),
  enabled: z.boolean(),
  note: z.string(),
  channelIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const clientFields = z.object({
  name: nameText,
  note: z.string().trim().max(500).optional(),
  enabled: z.boolean().optional(),
  channelIds: z.array(z.string().max(64)).min(1).max(50),
});

export function clientsRoutes() {
  const router = new Hono<AppEnv>();

  // ─── Channels ───

  router.get("/media/channels", doc("List channels", jsonOk(z.array(channelSchema))), async c =>
    c.json({ success: true, data: await listChannels(requireMediaDb()) }));

  router.post("/media/channels", doc("Add a channel", jsonCreated(channelSchema)), validator("json", z.object({
    name: nameText,
  })), async (c) => {
    const row = await createChannel(requireMediaDb(), c.req.valid("json"));
    await record(c, "media.channel.created", { type: "media_channel", id: row.id, name: row.name });
    return c.json({ success: true, data: row }, 201);
  });

  router.post("/media/channels/reorder", doc("Reorder channels", jsonOk(z.object({
    count: z.number(),
  }))), validator("json", reorderBody), async (c) => {
    const { ids } = c.req.valid("json");
    await reorderChannels(requireMediaDb(), ids);
    return c.json({
      success: true,
      data: { count: ids.length },
    });
  });

  router.patch("/media/channels/:id", doc("Rename a channel", jsonOk(channelSchema)), validator("param", idParam), validator("json", z.object({
    name: nameText.optional(),
  })), async (c) => {
    const row = await updateChannel(requireMediaDb(), c.req.valid("param").id, c.req.valid("json"));
    await record(c, "media.channel.updated", { type: "media_channel", id: row.id, name: row.name });
    return c.json({ success: true, data: row });
  });

  router.delete("/media/channels/:id", doc("Delete a channel (titles lose it)", jsonOk(channelSchema)), validator("param", idParam), async (c) => {
    const row = await deleteChannel(requireMediaDb(), c.req.valid("param").id);
    await record(c, "media.channel.deleted", { type: "media_channel", id: row.id, name: row.name });
    return c.json({ success: true, data: row });
  });

  // ─── Clients ───

  router.get("/media/clients", doc("List clients", jsonOk(z.array(clientSchema))), async c =>
    c.json({ success: true, data: await listClients(requireMediaDb()) }));

  router.post("/media/clients", doc("Add a client", jsonCreated(clientSchema)), validator("json", clientFields), async (c) => {
    const row = await createClient(requireMediaDb(), c.req.valid("json"));
    await record(c, "media.client.created", { type: "media_client", id: row.id, name: row.name });
    return c.json({ success: true, data: row }, 201);
  });

  router.patch("/media/clients/:id", doc("Update a client", jsonOk(clientSchema)), validator("param", idParam), validator("json", clientFields.partial()), async (c) => {
    const row = await updateClient(requireMediaDb(), c.req.valid("param").id, c.req.valid("json"));
    await record(c, "media.client.updated", { type: "media_client", id: row.id, name: row.name }, {
      fields: Object.keys(c.req.valid("json")),
    });
    return c.json({ success: true, data: row });
  });

  router.post("/media/clients/:id/rotate", doc("Issue a new client token; the old URL stops working", jsonOk(clientSchema)), validator("param", idParam), async (c) => {
    const row = await rotateClientToken(requireMediaDb(), c.req.valid("param").id);
    await record(c, "media.client.rotated", { type: "media_client", id: row.id, name: row.name });
    return c.json({ success: true, data: row });
  });

  router.delete("/media/clients/:id", doc("Delete a client", jsonOk(clientSchema)), validator("param", idParam), async (c) => {
    const row = await deleteClient(requireMediaDb(), c.req.valid("param").id);
    await record(c, "media.client.deleted", { type: "media_client", id: row.id, name: row.name });
    return c.json({ success: true, data: row });
  });

  return router;
}
