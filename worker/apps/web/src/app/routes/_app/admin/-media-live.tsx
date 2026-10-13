import type { ImportResult, LiveChannel, LiveStream } from "./-media-api";
import { useQuery } from "@tanstack/react-query";
import { Download, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import { CenteredHint } from "@/shared/components/ui/centered-hint";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { Textarea } from "@/shared/components/ui/textarea";
import { mediaApi, mediaKeys, orNull, splitList } from "./-media-api";
import { useMediaMutation } from "./-media-hooks";
import { EnumSelect, Field, NameInput } from "./-media-shared";

export function LiveTab() {
  const { t } = useTranslation(["common", "media"]);
  const groups = useQuery({ queryKey: mediaKeys.liveGroups, queryFn: mediaApi.liveGroups });
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [importing, setImporting] = useState(false);
  const current = groups.data?.find(g => g.id === selected) ?? groups.data?.[0];
  const add = useMediaMutation(() => mediaApi.createLiveGroup(name.trim()), (g) => {
    setName("");
    setSelected(g.id);
  });
  const rename = useMediaMutation(({ id, name }: { id: string; name: string }) => mediaApi.updateLiveGroup(id, name));
  const remove = useMediaMutation((id: string) => mediaApi.deleteLiveGroup(id), () => setSelected(null));
  const exportM3u = useMediaMutation(() => mediaApi.exportLive(), ({ text }) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "audio/x-mpegurl" }));
    a.download = "live.m3u";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  return (
    <div className="space-y-6 pt-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">{t("media:live.description")}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
            <Upload className="size-4" />
            {t("media:live.import")}
          </Button>
          <Button size="sm" variant="outline" disabled={exportM3u.isPending} onClick={() => exportM3u.mutate(undefined)}>
            <Download className="size-4" />
            {t("media:live.export")}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <div className="space-y-2">
          {groups.data?.map(g => (
            <div key={g.id} className={`flex items-center gap-1 rounded-md px-1 ${current?.id === g.id ? "bg-muted" : ""}`}>
              <button type="button" className="flex-1 truncate py-1 text-left text-sm" onClick={() => setSelected(g.id)}>
                {g.name}
                <span className="ml-1 text-xs text-muted-foreground">{g.channelCount}</span>
              </button>
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(g.id)}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <div className="flex gap-1">
            <Input value={name} onChange={e => setName(e.target.value)} placeholder={t("media:live.groupName")} />
            <Button size="sm" variant="outline" disabled={!name.trim() || add.isPending} onClick={() => add.mutate(undefined)}><Plus className="size-4" /></Button>
          </div>
        </div>
        <div className="space-y-2">
          {current
            ? (
                <>
                  <NameInput key={current.name} value={current.name} onSave={name => rename.mutate({ id: current.id, name })} />
                  <Channels groupId={current.id} />
                </>
              )
            : <CenteredHint>{t("media:live.empty")}</CenteredHint>}
        </div>
      </div>

      <Epg />
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </div>
  );
}

function Channels({ groupId }: { groupId: string }) {
  const { t } = useTranslation(["common", "media"]);
  const channels = useQuery({ queryKey: mediaKeys.liveChannels(groupId), queryFn: () => mediaApi.liveChannels(groupId) });
  const [editing, setEditing] = useState<LiveChannel | "new" | null>(null);
  const toggle = useMediaMutation(({ id, enabled }: { id: string; enabled: boolean }) => mediaApi.updateLiveChannel(id, { enabled }));
  const remove = useMediaMutation((id: string) => mediaApi.deleteLiveChannel(id));

  return (
    <div className="space-y-2">
      {channels.data && channels.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>{t("media:live.channel")}</TableHead>
              <TableHead>{t("media:live.streams")}</TableHead>
              <TableHead>{t("media:live.enabled")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {channels.data.map(c => (
              <TableRow key={c.id}>
                <TableCell>{c.number ?? ""}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {c.logo && <img src={c.logo} alt="" className="h-6 w-10 object-contain" loading="lazy" />}
                    <span className="font-medium">{c.name}</span>
                  </div>
                </TableCell>
                <TableCell className="max-w-xs truncate font-mono text-xs" title={c.streams.map(s => s.url).join("\n")}>
                  {t("media:live.streamCount", { count: c.streams.length })}
                </TableCell>
                <TableCell><Switch checked={c.enabled} onCheckedChange={enabled => toggle.mutate({ id: c.id, enabled })} /></TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(c)}><Pencil className="size-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(c.id)}><Trash2 className="size-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
        <Plus className="size-4" />
        {t("media:live.addChannel")}
      </Button>
      {editing !== null && <ChannelDialog key={editing === "new" ? "new" : editing.id} groupId={groupId} channel={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** One stream a line: `url`, or `url|User-Agent|Referer`. */
function streamsToText(streams: readonly LiveStream[]): string {
  return streams.map(s => [s.url, s.userAgent ?? "", s.referer ?? ""].join("|").replace(/\|+$/, "")).join("\n");
}

function textToStreams(text: string): LiveStream[] {
  return text.split("\n").map(l => l.trim()).filter(Boolean).map((line) => {
    const [url, userAgent, referer] = line.split("|").map(s => s.trim());
    return { url: url!, userAgent: orNull(userAgent ?? ""), referer: orNull(referer ?? "") };
  });
}

function ChannelDialog({ groupId, channel, onClose }: { groupId: string; channel: LiveChannel | null; onClose: () => void }) {
  const { t } = useTranslation(["common", "media"]);
  const groups = useQuery({ queryKey: mediaKeys.liveGroups, queryFn: mediaApi.liveGroups });
  const [form, setForm] = useState(() => ({
    groupId: channel?.groupId ?? groupId,
    name: channel?.name ?? "",
    number: channel?.number?.toString() ?? "",
    tvgId: channel?.tvgId ?? "",
    logo: channel?.logo ?? "",
    streams: streamsToText(channel?.streams ?? []),
  }));
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm(f => ({ ...f, [key]: value }));
  const save = useMediaMutation(() => {
    const body = {
      groupId: form.groupId,
      name: form.name.trim(),
      number: form.number.trim() ? Number(form.number) : null,
      tvgId: orNull(form.tvgId),
      logo: orNull(form.logo),
      streams: textToStreams(form.streams),
    };
    return channel ? mediaApi.updateLiveChannel(channel.id, body) : mediaApi.createLiveChannel(body);
  }, onClose);

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{channel ? channel.name : t("media:live.addChannel")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("media:live.channel")}><Input value={form.name} onChange={e => set("name", e.target.value)} /></Field>
          <Field label={t("media:live.group")}>
            <EnumSelect value={form.groupId} values={(groups.data ?? []).map(g => g.id)} label={v => groups.data?.find(g => g.id === v)?.name ?? v} onChange={v => set("groupId", v)} />
          </Field>
          <Field label={t("media:live.number")}><Input type="number" value={form.number} onChange={e => set("number", e.target.value)} /></Field>
          <Field label="tvg-id"><Input value={form.tvgId} onChange={e => set("tvgId", e.target.value)} /></Field>
          <Field label={t("media:live.logo")} className="sm:col-span-2"><Input value={form.logo} onChange={e => set("logo", e.target.value)} placeholder="https://…/logo.png" /></Field>
          <Field label={t("media:live.streamsHint")} className="sm:col-span-2">
            <Textarea rows={4} className="font-mono text-xs" value={form.streams} onChange={e => set("streams", e.target.value)} placeholder="https://…/live.m3u8|okhttp/4.12.0" />
          </Field>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">{t("common.cancel")}</Button>} />
          <Button disabled={!form.name.trim() || !form.streams.trim() || save.isPending} onClick={() => save.mutate(undefined)}>{t("media:save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(["common", "media"]);
  const [text, setText] = useState("");
  const [replace, setReplace] = useState(false);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const run = useMediaMutation((dryRun: boolean) => mediaApi.importLive(text, { replace, dryRun }), (result) => {
    setPreview(result);
  });

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("media:live.import")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t("media:live.importHint")}</p>
        <Textarea
          rows={10}
          className="font-mono text-xs"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
          }}
          placeholder={"#EXTM3U\n#EXTINF:-1 group-title=\"…\",…\nhttps://…"}
        />
        <div className="flex items-center gap-2">
          <Switch checked={replace} onCheckedChange={setReplace} />
          <span className="text-sm">{t("media:live.replace")}</span>
        </div>
        {preview && <p className="text-sm">{t("media:live.importResult", { ...preview })}</p>}
        <DialogFooter>
          <DialogClose render={<Button variant="outline">{t("common.cancel")}</Button>} />
          <Button variant="outline" disabled={!text.trim() || run.isPending} onClick={() => run.mutate(true)}>{t("media:paste.preview")}</Button>
          <Button disabled={!text.trim() || run.isPending} onClick={() => run.mutate(false)}>{t("media:live.import")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Epg() {
  const { t } = useTranslation(["common", "media"]);
  const epg = useQuery({ queryKey: mediaKeys.epg, queryFn: mediaApi.epg });
  const [text, setText] = useState<string | null>(null);
  const save = useMediaMutation(() => mediaApi.setEpg(splitList(text ?? "")), () => setText(null));

  return (
    <section className="space-y-2">
      <h3 className="font-medium">EPG</h3>
      <p className="text-xs text-muted-foreground">{t("media:live.epgHint")}</p>
      <Textarea rows={2} className="font-mono text-xs" value={text ?? (epg.data ?? []).join("\n")} onChange={e => setText(e.target.value)} placeholder="https://…/e.xml.gz" />
      <Button size="sm" disabled={text === null || save.isPending} onClick={() => save.mutate(undefined)}>{t("media:save")}</Button>
    </section>
  );
}
