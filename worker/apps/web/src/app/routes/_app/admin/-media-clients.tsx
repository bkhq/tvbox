import type { MediaClient } from "./-media-api";
import { useQuery } from "@tanstack/react-query";
import { Copy, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { mediaApi, mediaKeys } from "./-media-api";
import { useMediaMutation } from "./-media-hooks";
import { EnumSelect, MoveButtons, NameInput } from "./-media-shared";
import { tvboxApi, tvboxKeys } from "./-tvbox-api";

const URLS = [
  { key: "cms", path: "/cms" },
  { key: "v1", path: "/v1" },
  { key: "live", path: "/live.m3u" },
] as const;

export function ClientsTab() {
  return (
    <div className="grid gap-8 pt-4 lg:grid-cols-3">
      <div className="space-y-8 lg:col-span-2">
        <Clients />
        <StaleEntries />
      </div>
      <Channels />
    </div>
  );
}

function clientUrl(token: string, path: string): string {
  return `${window.location.origin}/m/${token}${path}`;
}

function Clients() {
  const { t } = useTranslation(["common", "media"]);
  const clients = useQuery({ queryKey: mediaKeys.clients, queryFn: mediaApi.clients });
  const channels = useQuery({ queryKey: mediaKeys.channels, queryFn: mediaApi.channels });
  const [name, setName] = useState("");
  const [channel, setChannel] = useState("");
  const [rotating, setRotating] = useState<MediaClient | null>(null);
  const [deleting, setDeleting] = useState<MediaClient | null>(null);
  const firstChannel = channels.data?.[0]?.id ?? "";
  const picked = channels.data?.some(c => c.id === channel)
    ? channel
    : firstChannel;
  const add = useMediaMutation(() => mediaApi.createClient({
    name: name.trim(),
    channelIds: [picked],
  }), () => setName(""));
  const update = useMediaMutation(({ id, body }: { id: string; body: Parameters<typeof mediaApi.updateClient>[1] }) => mediaApi.updateClient(id, body));
  const rotate = useMediaMutation((id: string) => mediaApi.rotateClient(id), () => setRotating(null));
  const remove = useMediaMutation((id: string) => mediaApi.deleteClient(id), () => setDeleting(null));
  const copy = (url: string) => void navigator.clipboard.writeText(url).then(() => toast.success(t("media:clients.copied")));

  return (
    <section className="space-y-2">
      <h3 className="font-medium">{t("media:clients.title")}</h3>
      <p className="text-xs text-muted-foreground">{t("media:clients.hint")}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("media:taxonomy.name")}</TableHead>
            <TableHead>{t("media:clients.channels")}</TableHead>
            <TableHead>{t("media:clients.urls")}</TableHead>
            <TableHead>{t("media:clients.enabled")}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {clients.data?.map(c => (
            <TableRow key={c.id}>
              <TableCell>
                <NameInput
                  key={c.name}
                  value={c.name}
                  onSave={name => update.mutate({
                    id: c.id,
                    body: { name },
                  })}
                />
              </TableCell>
              <TableCell className="space-x-1">
                {channels.data?.map((ch) => {
                  const on = c.channelIds.includes(ch.id);
                  return (
                    <Badge
                      key={ch.id}
                      variant={on ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => {
                        const channelIds = on
                          ? c.channelIds.filter(x => x !== ch.id)
                          : [...c.channelIds, ch.id];
                        if (channelIds.length > 0) {
                          update.mutate({
                            id: c.id,
                            body: { channelIds },
                          });
                        }
                      }}
                    >
                      {ch.name}
                    </Badge>
                  );
                })}
              </TableCell>
              <TableCell className="space-x-1 whitespace-nowrap">
                {URLS.map(u => (
                  <Button key={u.key} size="sm" variant="outline" title={clientUrl(c.token, u.path)} onClick={() => copy(clientUrl(c.token, u.path))}>
                    <Copy className="size-3" />
                    {t(`media:clients.url.${u.key}`)}
                  </Button>
                ))}
              </TableCell>
              <TableCell>
                <Switch
                  checked={c.enabled}
                  onCheckedChange={enabled => update.mutate({
                    id: c.id,
                    body: { enabled },
                  })}
                />
              </TableCell>
              <TableCell className="text-right whitespace-nowrap">
                <Button size="sm" variant="ghost" title={t("media:clients.rotate")} onClick={() => setRotating(c)}><RefreshCw className="size-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleting(c)}><Trash2 className="size-4" /></Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex items-center gap-2">
        <Input className="w-40" value={name} onChange={e => setName(e.target.value)} placeholder={t("media:taxonomy.name")} />
        {firstChannel && (
          <EnumSelect
            className="w-40"
            value={picked}
            values={channels.data!.map(c => c.id)}
            label={v => channels.data?.find(c => c.id === v)?.name ?? v}
            onChange={setChannel}
          />
        )}
        <Button size="sm" variant="outline" disabled={!name.trim() || !picked || add.isPending} onClick={() => add.mutate(undefined)}>{t("media:add")}</Button>
        {!firstChannel && <span className="text-xs text-muted-foreground">{t("media:clients.needChannel")}</span>}
      </div>
      <ConfirmDeleteDialog
        open={rotating !== null}
        onOpenChange={open => !open && setRotating(null)}
        title={t("media:clients.rotateTitle")}
        description={t("media:clients.rotateDescription", { name: rotating?.name ?? "" })}
        confirmLabel={t("media:clients.rotate")}
        pending={rotate.isPending}
        onConfirm={() => rotating && rotate.mutate(rotating.id)}
      />
      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={open => !open && setDeleting(null)}
        title={t("media:clients.deleteTitle")}
        description={t("media:clients.deleteDescription", { name: deleting?.name ?? "" })}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </section>
  );
}

function Channels() {
  const { t } = useTranslation(["common", "media"]);
  const channels = useQuery({ queryKey: mediaKeys.channels, queryFn: mediaApi.channels });
  const [name, setName] = useState("");
  const add = useMediaMutation(() => mediaApi.createChannel(name.trim()), () => setName(""));
  const rename = useMediaMutation(({ id, name }: { id: string; name: string }) => mediaApi.updateChannel(id, name));
  const remove = useMediaMutation((id: string) => mediaApi.deleteChannel(id));
  const reorder = useMediaMutation((ids: string[]) => mediaApi.reorderChannels(ids));
  const ids = channels.data?.map(c => c.id) ?? [];

  return (
    <section className="space-y-2">
      <h3 className="font-medium">{t("media:channels.title")}</h3>
      <p className="text-xs text-muted-foreground">{t("media:channels.hint")}</p>
      {channels.data?.map((c, i) => (
        <div key={c.id} className="flex items-center gap-2">
          <NameInput key={c.name} value={c.name} onSave={name => rename.mutate({ id: c.id, name })} />
          <span className="text-xs whitespace-nowrap text-muted-foreground">{t("media:channels.counts", { titles: c.titleCount, clients: c.clientCount })}</span>
          <MoveButtons ids={ids} index={i} onMove={next => reorder.mutate(next)} />
          <Button size="sm" variant="ghost" onClick={() => remove.mutate(c.id)}><Trash2 className="size-4" /></Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input className="w-40" value={name} onChange={e => setName(e.target.value)} placeholder={t("media:taxonomy.name")} />
        <Button size="sm" variant="outline" disabled={!name.trim() || add.isPending} onClick={() => add.mutate(undefined)}>{t("media:add")}</Button>
      </div>
    </section>
  );
}

// Entries that still name the library through the old `@media/` placeholder
// (only `@media/home` is still served) need a client URL instead.
function StaleEntries() {
  const { t } = useTranslation("media");
  const sites = useQuery({
    queryKey: tvboxKeys.entries("sites", "common", false),
    queryFn: () => tvboxApi.entries("sites", "common"),
  });
  const lives = useQuery({
    queryKey: tvboxKeys.entries("lives", "common", false),
    queryFn: () => tvboxApi.entries("lives", "common"),
  });
  const stale = [
    ...(sites.data ?? []),
    ...(lives.data ?? []),
  ].filter(e => /"@media\/(?!home")/.test(JSON.stringify(e.data)));
  if (stale.length === 0)
    return null;
  return (
    <section className="space-y-2 rounded-md border border-amber-500/50 p-3">
      <h3 className="font-medium">{t("clients.staleTitle")}</h3>
      <p className="text-xs text-muted-foreground">{t("clients.staleHint")}</p>
      {stale.map(e => (
        <code key={e.id} className="block text-xs break-all text-muted-foreground">{JSON.stringify(e.data)}</code>
      ))}
    </section>
  );
}
