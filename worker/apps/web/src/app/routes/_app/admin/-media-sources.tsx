import type { PasteResult, Source, SourceOwner } from "./-media-api";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { CenteredHint } from "@/shared/components/ui/centered-hint";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Switch } from "@/shared/components/ui/switch";
import { Textarea } from "@/shared/components/ui/textarea";
import { mediaApi, mediaKeys, orNull } from "./-media-api";
import { useMediaMutation } from "./-media-hooks";

/** A movie's (`titles`) or a season's (`seasons`) sources and their streams. */
export function SourcesPanel({ owner }: { owner: SourceOwner }) {
  const { t } = useTranslation(["common", "media"]);
  const sources = useQuery({ queryKey: mediaKeys.sources(owner), queryFn: () => mediaApi.sources(owner) });
  const [name, setName] = useState("");
  const [quality, setQuality] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const add = useMediaMutation(() => mediaApi.createSource(owner, { name: name.trim(), quality: orNull(quality) }), (s) => {
    setName("");
    setQuality("");
    setOpen(s.id);
  });
  const update = useMediaMutation(({ id, enabled }: { id: string; enabled: boolean }) => mediaApi.updateSource(id, { enabled }));
  const remove = useMediaMutation((id: string) => mediaApi.deleteSource(id));

  return (
    <div className="space-y-2">
      {sources.data?.length === 0 && <CenteredHint>{t("media:sources.empty")}</CenteredHint>}
      {sources.data?.map(s => (
        <div key={s.id} className="rounded-md border">
          <div className="flex items-center gap-2 px-2 py-1">
            <Button size="sm" variant="ghost" onClick={() => setOpen(open === s.id ? null : s.id)}>
              {open === s.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </Button>
            <span className="font-medium">{s.name}</span>
            {s.quality && <Badge variant="outline">{s.quality}</Badge>}
            <span className="flex-1 text-xs text-muted-foreground">{t("media:sources.streamCount", { count: s.streamCount })}</span>
            <Switch checked={s.enabled} onCheckedChange={enabled => update.mutate({ id: s.id, enabled })} />
            <Button size="sm" variant="ghost" onClick={() => remove.mutate(s.id)}><Trash2 className="size-4" /></Button>
          </div>
          {open === s.id && <Streams source={s} owner={owner} />}
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input className="w-48" value={name} onChange={e => setName(e.target.value)} placeholder={t("media:sources.name")} />
        <Input className="w-28" value={quality} onChange={e => setQuality(e.target.value)} placeholder="1080p" />
        <Button size="sm" variant="outline" disabled={!name.trim() || add.isPending} onClick={() => add.mutate(undefined)}>
          <Plus className="size-4" />
          {t("media:sources.add")}
        </Button>
      </div>
    </div>
  );
}

function Streams({ source, owner }: { source: Source; owner: SourceOwner }) {
  const { t } = useTranslation(["common", "media"]);
  const streams = useQuery({ queryKey: mediaKeys.streams(source.id), queryFn: () => mediaApi.streams(source.id) });
  const episodes = useQuery({
    queryKey: mediaKeys.episodes(owner.id),
    queryFn: () => mediaApi.episodes(owner.id),
    enabled: owner.kind === "seasons",
  });
  const [url, setUrl] = useState("");
  const [resolution, setResolution] = useState("");
  const [text, setText] = useState("");
  const [createMissing, setCreateMissing] = useState(true);
  const [preview, setPreview] = useState<PasteResult | null>(null);
  const add = useMediaMutation(() => mediaApi.addStream(source.id, { url: url.trim(), resolution: orNull(resolution) }), () => setUrl(""));
  const remove = useMediaMutation((id: string) => mediaApi.deleteStream(id));
  const paste = useMediaMutation((dryRun: boolean) => mediaApi.paste(source.id, text, { createMissing, dryRun }), (r) => {
    setPreview(r);
    if (r.written > 0)
      setText("");
  });
  const numberOf = (episodeId: string | null) => episodes.data?.find(e => e.id === episodeId)?.episodeNumber;

  return (
    <div className="space-y-3 border-t p-3">
      <div className="max-h-64 space-y-1 overflow-y-auto">
        {streams.data?.map(st => (
          <div key={st.id} className="flex items-center gap-2 text-xs">
            {owner.kind === "seasons" && <Badge variant="outline">{t("media:sources.episode", { number: numberOf(st.episodeId) ?? "?" })}</Badge>}
            {st.resolution && <Badge variant="secondary">{st.resolution}</Badge>}
            <span className="flex-1 truncate font-mono" title={st.url}>{st.url}</span>
            <Button size="sm" variant="ghost" onClick={() => remove.mutate(st.id)}><Trash2 className="size-4" /></Button>
          </div>
        ))}
      </div>

      {owner.kind === "titles"
        ? (
            <div className="flex items-center gap-2">
              <Input className="flex-1" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…/index.m3u8" />
              <Input className="w-24" value={resolution} onChange={e => setResolution(e.target.value)} placeholder="1080p" />
              <Button size="sm" variant="outline" disabled={!url.trim() || add.isPending} onClick={() => add.mutate(undefined)}>{t("media:add")}</Button>
            </div>
          )
        : (
            <div className="space-y-2">
              <Label>{t("media:paste.label")}</Label>
              <Textarea
                rows={5}
                className="font-mono text-xs"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setPreview(null);
                }}
                placeholder={"第1集$https://…/1.m3u8\n第2集$https://…/2.m3u8"}
              />
              <div className="flex items-center gap-2">
                <Switch checked={createMissing} onCheckedChange={setCreateMissing} />
                <span className="flex-1 text-sm">{t("media:paste.createMissing")}</span>
                <Button size="sm" variant="outline" disabled={!text.trim() || paste.isPending} onClick={() => paste.mutate(true)}>{t("media:paste.preview")}</Button>
                <Button size="sm" disabled={!text.trim() || paste.isPending} onClick={() => paste.mutate(false)}>{t("media:paste.apply")}</Button>
              </div>
              {preview && (
                <div className="space-y-1 rounded-md bg-muted p-2 text-xs">
                  <div>{t("media:paste.summary", { matched: preview.matched.length, missing: preview.missing.length, unmatched: preview.unmatched.length, written: preview.written, created: preview.created })}</div>
                  {preview.missing.map(m => <div key={`m${m.episodeNumber}`} className="text-amber-600">{t("media:paste.missing", { number: m.episodeNumber, name: m.line.name })}</div>)}
                  {preview.unmatched.map(u => <div key={`${u.line.name}${u.line.url}`} className="text-destructive">{t(`media:paste.reason.${u.reason}`, { name: u.line.name })}</div>)}
                </div>
              )}
            </div>
          )}
    </div>
  );
}
