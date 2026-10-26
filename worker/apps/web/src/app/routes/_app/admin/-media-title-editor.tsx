import type { ExternalSource, Title, TitleInput, Translation } from "./-media-api";
import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { CenteredHint } from "@/shared/components/ui/centered-hint";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { Textarea } from "@/shared/components/ui/textarea";
import { EXTERNAL_SOURCES, mediaApi, mediaKeys, orNull, PUBLISH_STATES, splitList, TITLE_STATUSES } from "./-media-api";
import { CreditsPanel } from "./-media-credits";
import { useMediaMutation } from "./-media-hooks";
import { ImagesPanel } from "./-media-images";
import { SeasonsPanel } from "./-media-seasons";
import { EnumSelect, Field } from "./-media-shared";
import { SourcesPanel } from "./-media-sources";

const NONE = "none";

export function TitleEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation(["common", "media"]);
  const title = useQuery({
    queryKey: mediaKeys.title(id),
    queryFn: () => mediaApi.title(id),
  });

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{title.data?.title ?? t("common.loading")}</DialogTitle>
        </DialogHeader>
        {title.data && (
          <Tabs defaultValue="info">
            <TabsList variant="line">
              <TabsTrigger value="info">{t("media:editor.info")}</TabsTrigger>
              {title.data.kind === "series"
                ? <TabsTrigger value="seasons">{t("media:editor.seasons")}</TabsTrigger>
                : <TabsTrigger value="sources">{t("media:editor.sources")}</TabsTrigger>}
              <TabsTrigger value="credits">{t("media:editor.credits")}</TabsTrigger>
              <TabsTrigger value="images">{t("media:editor.images")}</TabsTrigger>
              <TabsTrigger value="translations">{t("media:editor.translations")}</TabsTrigger>
              <TabsTrigger value="external">{t("media:editor.external")}</TabsTrigger>
            </TabsList>
            <TabsContent value="info"><InfoForm key={title.data.updatedAt} title={title.data} /></TabsContent>
            {title.data.kind === "series"
              ? <TabsContent value="seasons"><SeasonsPanel titleId={id} /></TabsContent>
              : <TabsContent value="sources"><SourcesPanel owner={{ kind: "titles", id }} /></TabsContent>}
            <TabsContent value="credits"><CreditsPanel title={title.data} /></TabsContent>
            <TabsContent value="images"><ImagesPanel ownerType="title" ownerId={id} kinds={["poster", "backdrop", "logo"]} /></TabsContent>
            <TabsContent value="translations"><Translations titleId={id} /></TabsContent>
            <TabsContent value="external"><ExternalIds titleId={id} /></TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InfoForm({ title }: { title: Title }) {
  const { t } = useTranslation(["common", "media"]);
  const categories = useQuery({ queryKey: mediaKeys.categories, queryFn: mediaApi.categories });
  const genres = useQuery({ queryKey: mediaKeys.genres, queryFn: mediaApi.genres });
  const collections = useQuery({ queryKey: mediaKeys.collections, queryFn: mediaApi.collections });
  const channels = useQuery({ queryKey: mediaKeys.channels, queryFn: mediaApi.channels });
  const [form, setForm] = useState({
    title: title.title,
    originalTitle: title.originalTitle ?? "",
    categoryId: title.categoryId,
    publishState: title.publishState,
    status: title.status,
    statusLocked: title.statusLocked,
    releaseDate: title.releaseDate ?? "",
    runtime: title.runtime?.toString() ?? "",
    originalLanguage: title.originalLanguage ?? "",
    originCountries: title.originCountries.join(", "),
    overview: title.overview ?? "",
    tagline: title.tagline ?? "",
    contentRating: title.contentRating ?? "",
    voteAverage: title.voteAverage?.toString() ?? "",
    popularity: String(title.popularity),
    collectionId: title.collectionId ?? NONE,
    genreIds: title.genreIds,
    public: title.public,
    channelIds: title.channelIds,
    aliases: title.aliases.map(a => a.name).join(", "),
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm(f => ({ ...f, [key]: value }));
  const save = useMediaMutation(() => {
    const body: TitleInput = {
      title: form.title.trim(),
      originalTitle: orNull(form.originalTitle),
      categoryId: form.categoryId,
      publishState: form.publishState,
      status: form.status,
      statusLocked: form.statusLocked,
      releaseDate: orNull(form.releaseDate),
      runtime: form.runtime.trim()
        ? Number(form.runtime)
        : null,
      originalLanguage: orNull(form.originalLanguage),
      originCountries: splitList(form.originCountries).map(c => c.toUpperCase()),
      overview: orNull(form.overview),
      tagline: orNull(form.tagline),
      contentRating: orNull(form.contentRating),
      voteAverage: form.voteAverage.trim()
        ? Number(form.voteAverage)
        : null,
      popularity: Number(form.popularity) || 0,
      collectionId: form.collectionId === NONE
        ? null
        : form.collectionId,
      genreIds: form.genreIds,
      public: form.public,
      channelIds: form.channelIds,
      aliases: splitList(form.aliases).map(name => ({ name })),
    };
    return mediaApi.updateTitle(title.id, body);
  });
  const allowed = (categories.data ?? []).filter(c => c.kinds.includes(title.kind));

  return (
    <div className="space-y-4 pt-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("media:titles.title")}><Input value={form.title} onChange={e => set("title", e.target.value)} /></Field>
        <Field label={t("media:info.originalTitle")}><Input value={form.originalTitle} onChange={e => set("originalTitle", e.target.value)} /></Field>
        <Field label={t("media:info.aliases")}><Input value={form.aliases} onChange={e => set("aliases", e.target.value)} /></Field>
        <Field label={t("media:titles.category")}>
          <EnumSelect value={form.categoryId} values={allowed.map(c => c.id)} label={v => allowed.find(c => c.id === v)?.name ?? v} onChange={v => set("categoryId", v)} />
        </Field>
        <Field label={t("media:titles.state")}>
          <EnumSelect value={form.publishState} values={PUBLISH_STATES} label={v => t(`media:state.${v}`)} onChange={v => set("publishState", v)} />
        </Field>
        <Field label={t("media:info.status")}>
          <div className="flex items-center gap-2">
            <EnumSelect value={form.status} values={TITLE_STATUSES} label={v => t(`media:status.${v}`)} onChange={v => set("status", v)} />
            <Switch checked={form.statusLocked} onCheckedChange={v => set("statusLocked", v)} title={t("media:info.statusLocked")} />
          </div>
        </Field>
        <Field label={t("media:info.releaseDate")}><Input type="date" value={form.releaseDate} onChange={e => set("releaseDate", e.target.value)} /></Field>
        <Field label={t("media:info.runtime")}><Input type="number" value={form.runtime} onChange={e => set("runtime", e.target.value)} /></Field>
        <Field label={t("media:info.contentRating")}><Input value={form.contentRating} onChange={e => set("contentRating", e.target.value)} /></Field>
        <Field label={t("media:info.countries")}><Input value={form.originCountries} onChange={e => set("originCountries", e.target.value)} placeholder="CN, US" /></Field>
        <Field label={t("media:info.language")}><Input value={form.originalLanguage} onChange={e => set("originalLanguage", e.target.value)} placeholder="zh" /></Field>
        <Field label={t("media:info.collection")}>
          <EnumSelect
            value={form.collectionId}
            values={[
              NONE,
              ...(collections.data ?? []).map(c => c.id),
            ]}
            label={v => (v === NONE
              ? t("media:info.noCollection")
              : collections.data?.find(c => c.id === v)?.name ?? v)}
            onChange={v => set("collectionId", v)}
          />
        </Field>
        <Field label={t("media:info.rating")}><Input type="number" step="0.1" value={form.voteAverage} onChange={e => set("voteAverage", e.target.value)} /></Field>
        <Field label={t("media:info.popularity")}><Input type="number" value={form.popularity} onChange={e => set("popularity", e.target.value)} /></Field>
        <Field label={t("media:info.tagline")}><Input value={form.tagline} onChange={e => set("tagline", e.target.value)} /></Field>
      </div>
      <Field label={t("media:info.overview")}><Textarea rows={4} value={form.overview} onChange={e => set("overview", e.target.value)} /></Field>
      <Field label={t("media:info.genres")}>
        <div className="flex flex-wrap gap-1">
          {(genres.data ?? []).map((g) => {
            const on = form.genreIds.includes(g.id);
            return (
              <Badge
                key={g.id}
                variant={on ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => set("genreIds", on
                  ? form.genreIds.filter(x => x !== g.id)
                  : [...form.genreIds, g.id])}
              >
                {g.name}
              </Badge>
            );
          })}
        </div>
      </Field>
      <Field label={t("media:info.audience")}>
        <div className="flex flex-wrap items-center gap-1">
          <label className="mr-2 flex items-center gap-2 text-sm">
            <Switch checked={form.public} onCheckedChange={v => set("public", v)} />
            {t("media:info.public")}
          </label>
          {(channels.data ?? []).map((c) => {
            const on = form.channelIds.includes(c.id);
            return (
              <Badge
                key={c.id}
                variant={on ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => set("channelIds", on
                  ? form.channelIds.filter(x => x !== c.id)
                  : [...form.channelIds, c.id])}
              >
                {c.name}
              </Badge>
            );
          })}
        </div>
        {!form.public && form.channelIds.length === 0 && <p className="text-xs text-muted-foreground">{t("media:info.nobody")}</p>}
      </Field>
      <div className="flex justify-end">
        <Button disabled={!form.title.trim() || save.isPending} onClick={() => save.mutate(undefined)}>{t("media:save")}</Button>
      </div>
    </div>
  );
}

const EMPTY_TRANSLATION = {
  locale: "",
  title: "",
  overview: "",
  tagline: "",
};

function Translations({ titleId }: { titleId: string }) {
  const { t } = useTranslation(["common", "media"]);
  const list = useQuery({
    queryKey: mediaKeys.translations(titleId),
    queryFn: () => mediaApi.translations(titleId),
  });
  const [form, setForm] = useState(EMPTY_TRANSLATION);
  const set = <K extends keyof typeof form>(key: K, value: string) => setForm(f => ({ ...f, [key]: value }));
  const edit = (x: Translation) => setForm({
    locale: x.locale,
    title: x.title ?? "",
    overview: x.overview ?? "",
    tagline: x.tagline ?? "",
  });
  const save = useMediaMutation(
    () => mediaApi.putTranslation(titleId, form.locale.trim(), {
      title: orNull(form.title),
      overview: orNull(form.overview),
      tagline: orNull(form.tagline),
    }),
    () => setForm(EMPTY_TRANSLATION),
  );
  const remove = useMediaMutation((locale: string) => mediaApi.deleteTranslation(titleId, locale));

  return (
    <div className="space-y-3 pt-4">
      {list.data?.length === 0 && <CenteredHint>{t("media:translations.empty")}</CenteredHint>}
      {list.data?.map(x => (
        <div key={x.id} className="flex items-center gap-2 text-sm">
          <Badge variant="outline">{x.locale}</Badge>
          <button type="button" className="flex-1 truncate text-left hover:underline" onClick={() => edit(x)}>{x.title || x.overview || x.tagline || "—"}</button>
          <Button size="sm" variant="ghost" onClick={() => remove.mutate(x.locale)}><Trash2 className="size-4" /></Button>
        </div>
      ))}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("media:translations.locale")}><Input value={form.locale} onChange={e => set("locale", e.target.value)} placeholder="en-US" /></Field>
        <Field label={t("media:titles.title")}><Input value={form.title} onChange={e => set("title", e.target.value)} /></Field>
        <Field label={t("media:info.tagline")}><Input value={form.tagline} onChange={e => set("tagline", e.target.value)} /></Field>
        <div className="sm:col-span-3">
          <Field label={t("media:info.overview")}><Textarea rows={3} value={form.overview} onChange={e => set("overview", e.target.value)} /></Field>
        </div>
      </div>
      <Button size="sm" disabled={!form.locale.trim() || save.isPending} onClick={() => save.mutate(undefined)}>{t("common.save")}</Button>
    </div>
  );
}

function ExternalIds({ titleId }: { titleId: string }) {
  const { t } = useTranslation(["common", "media"]);
  const list = useQuery({
    queryKey: mediaKeys.externalIds(titleId),
    queryFn: () => mediaApi.externalIds(titleId),
  });
  const [source, setSource] = useState<ExternalSource>("tmdb");
  const [value, setValue] = useState("");
  const add = useMediaMutation(() => mediaApi.addExternalId(titleId, source, value.trim()), () => setValue(""));
  const remove = useMediaMutation((id: string) => mediaApi.deleteExternalId(id));

  return (
    <div className="space-y-3 pt-4">
      {list.data?.length === 0 && <CenteredHint>{t("media:external.empty")}</CenteredHint>}
      {list.data?.map(x => (
        <div key={x.id} className="flex items-center gap-2 text-sm">
          <Badge variant="outline">{x.source}</Badge>
          <span className="flex-1 font-mono">{x.externalId}</span>
          <Button size="sm" variant="ghost" onClick={() => remove.mutate(x.id)}><Trash2 className="size-4" /></Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <EnumSelect className="w-28" value={source} values={EXTERNAL_SOURCES} label={v => v} onChange={setSource} />
        <Input
          className="w-56"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={source === "tmdb"
            ? "movie:27205"
            : "tt0111161"}
        />
        <Button size="sm" disabled={!value.trim() || add.isPending} onClick={() => add.mutate(undefined)}>{t("media:add")}</Button>
      </div>
    </div>
  );
}
