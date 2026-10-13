import type { Episode, Season } from "./-media-api";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import { CenteredHint } from "@/shared/components/ui/centered-hint";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { EPISODE_TYPES, mediaApi, mediaKeys, orNull, PUBLISH_STATES, SEASON_STATUSES } from "./-media-api";
import { useMediaMutation } from "./-media-hooks";
import { ImagesPanel } from "./-media-images";
import { EnumSelect, Field } from "./-media-shared";
import { SourcesPanel } from "./-media-sources";

export function SeasonsPanel({ titleId }: { titleId: number }) {
  const { t } = useTranslation(["common", "media"]);
  const seasons = useQuery({ queryKey: mediaKeys.seasons(titleId), queryFn: () => mediaApi.seasons(titleId) });
  const [selected, setSelected] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<Season | null>(null);
  const current = seasons.data?.find(s => s.id === selected) ?? seasons.data?.[0];
  const next = Math.max(0, ...(seasons.data ?? []).map(s => s.seasonNumber)) + 1;
  const add = useMediaMutation(() => mediaApi.createSeason(titleId, { seasonNumber: next }), s => setSelected(s.id));
  const remove = useMediaMutation((id: number) => mediaApi.deleteSeason(id), () => {
    setDeleting(null);
    setSelected(null);
  });

  return (
    <div className="space-y-4 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        {seasons.data?.map(s => (
          <Button key={s.id} size="sm" variant={current?.id === s.id ? "default" : "outline"} onClick={() => setSelected(s.id)}>
            {s.name ?? t("media:seasons.numbered", { number: s.seasonNumber })}
            <span className="text-xs opacity-70">
              {s.publishedEpisodeCount}
              /
              {s.episodeTotal ?? s.episodeCount}
            </span>
          </Button>
        ))}
        <Button size="sm" variant="ghost" disabled={add.isPending} onClick={() => add.mutate(undefined)}>
          <Plus className="size-4" />
          {t("media:seasons.add")}
        </Button>
      </div>
      {current && <SeasonDetail key={current.id} season={current} onDelete={() => setDeleting(current)} />}
      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={open => !open && setDeleting(null)}
        title={t("media:seasons.deleteTitle")}
        description={t("media:seasons.deleteDescription")}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}

function SeasonDetail({ season, onDelete }: { season: Season; onDelete: () => void }) {
  const { t } = useTranslation(["common", "media"]);
  const [form, setForm] = useState({
    seasonNumber: String(season.seasonNumber),
    name: season.name ?? "",
    status: season.status,
    publishState: season.publishState,
    airDate: season.airDate ?? "",
    endDate: season.endDate ?? "",
    episodeTotal: season.episodeTotal?.toString() ?? "",
    updateSchedule: season.updateSchedule ?? "",
    overview: season.overview ?? "",
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm(f => ({ ...f, [key]: value }));
  const save = useMediaMutation(() => mediaApi.updateSeason(season.id, {
    seasonNumber: Number(form.seasonNumber),
    name: orNull(form.name),
    status: form.status,
    publishState: form.publishState,
    airDate: orNull(form.airDate),
    endDate: orNull(form.endDate),
    episodeTotal: form.episodeTotal.trim() ? Number(form.episodeTotal) : null,
    updateSchedule: orNull(form.updateSchedule),
    overview: orNull(form.overview),
  }));

  return (
    <div className="space-y-6 rounded-lg border p-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={t("media:seasons.number")}><Input type="number" value={form.seasonNumber} onChange={e => set("seasonNumber", e.target.value)} /></Field>
        <Field label={t("media:seasons.name")}><Input value={form.name} onChange={e => set("name", e.target.value)} placeholder={t("media:seasons.numbered", { number: form.seasonNumber })} /></Field>
        <Field label={t("media:info.status")}>
          <EnumSelect value={form.status} values={SEASON_STATUSES} label={v => t(`media:seasonStatus.${v}`)} onChange={v => set("status", v)} />
        </Field>
        <Field label={t("media:titles.state")}>
          <EnumSelect value={form.publishState} values={PUBLISH_STATES} label={v => t(`media:state.${v}`)} onChange={v => set("publishState", v)} />
        </Field>
        <Field label={t("media:seasons.airDate")}><Input type="date" value={form.airDate} onChange={e => set("airDate", e.target.value)} /></Field>
        <Field label={t("media:seasons.endDate")}><Input type="date" value={form.endDate} onChange={e => set("endDate", e.target.value)} /></Field>
        <Field label={t("media:seasons.episodeTotal")}><Input type="number" value={form.episodeTotal} onChange={e => set("episodeTotal", e.target.value)} /></Field>
        <Field label={t("media:seasons.schedule")}><Input value={form.updateSchedule} onChange={e => set("updateSchedule", e.target.value)} placeholder={t("media:seasons.schedulePlaceholder")} /></Field>
      </div>
      <Field label={t("media:info.overview")}><Input value={form.overview} onChange={e => set("overview", e.target.value)} /></Field>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDelete}>{t("common.delete")}</Button>
        <Button disabled={save.isPending} onClick={() => save.mutate(undefined)}>{t("media:save")}</Button>
      </div>

      <Episodes seasonId={season.id} />

      <div className="space-y-2">
        <h3 className="font-medium">{t("media:editor.sources")}</h3>
        <SourcesPanel owner={{ kind: "seasons", id: season.id }} />
      </div>

      <div className="space-y-2">
        <h3 className="font-medium">{t("media:editor.images")}</h3>
        <ImagesPanel ownerType="season" ownerId={season.id} kinds={["poster", "backdrop"]} />
      </div>
    </div>
  );
}

function Episodes({ seasonId }: { seasonId: number }) {
  const { t } = useTranslation(["common", "media"]);
  const episodes = useQuery({ queryKey: mediaKeys.episodes(seasonId), queryFn: () => mediaApi.episodes(seasonId) });
  const [range, setRange] = useState({ from: "1", to: "" });
  const [shift, setShift] = useState({ from: "1", delta: "1" });
  const [plan, setPlan] = useState({ from: "1", start: "", interval: "7" });
  const [editing, setEditing] = useState<Episode | null>(null);

  const generate = useMediaMutation(() => mediaApi.generateEpisodes(seasonId, Number(range.from), Number(range.to)));
  const renumber = useMediaMutation(() => mediaApi.shiftEpisodes(seasonId, Number(shift.from), Number(shift.delta)));
  const schedule = useMediaMutation(() => mediaApi.scheduleEpisodes(seasonId, Number(plan.from), plan.start, Number(plan.interval)));
  const update = useMediaMutation(({ id, body }: { id: string; body: Partial<Omit<Episode, "id">> }) => mediaApi.updateEpisode(id, body), () => setEditing(null));
  const remove = useMediaMutation((id: string) => mediaApi.deleteEpisode(id));

  return (
    <div className="space-y-3">
      <h3 className="font-medium">{t("media:episodes.title")}</h3>
      <div className="grid gap-2 text-sm sm:grid-cols-3">
        <div className="flex items-end gap-1">
          <Field label={t("media:episodes.from")}><Input type="number" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></Field>
          <Field label={t("media:episodes.to")}><Input type="number" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></Field>
          <Button size="sm" variant="outline" disabled={!range.to || generate.isPending} onClick={() => generate.mutate(undefined)}>{t("media:episodes.generate")}</Button>
        </div>
        <div className="flex items-end gap-1">
          <Field label={t("media:episodes.from")}><Input type="number" value={shift.from} onChange={e => setShift({ ...shift, from: e.target.value })} /></Field>
          <Field label={t("media:episodes.delta")}><Input type="number" value={shift.delta} onChange={e => setShift({ ...shift, delta: e.target.value })} /></Field>
          <Button size="sm" variant="outline" disabled={renumber.isPending} onClick={() => renumber.mutate(undefined)}>{t("media:episodes.shift")}</Button>
        </div>
        <div className="flex items-end gap-1">
          <Field label={t("media:episodes.from")}><Input type="number" value={plan.from} onChange={e => setPlan({ ...plan, from: e.target.value })} /></Field>
          <Field label={t("media:episodes.start")}><Input type="date" value={plan.start} onChange={e => setPlan({ ...plan, start: e.target.value })} /></Field>
          <Field label={t("media:episodes.interval")}><Input type="number" value={plan.interval} onChange={e => setPlan({ ...plan, interval: e.target.value })} /></Field>
          <Button size="sm" variant="outline" disabled={!plan.start || schedule.isPending} onClick={() => schedule.mutate(undefined)}>{t("media:episodes.schedule")}</Button>
        </div>
      </div>

      {episodes.data?.length === 0 && <CenteredHint>{t("media:episodes.empty")}</CenteredHint>}
      {episodes.data && episodes.data.length > 0 && (
        <div className="max-h-96 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>{t("media:episodes.name")}</TableHead>
                <TableHead>{t("media:seasons.airDate")}</TableHead>
                <TableHead>{t("media:episodes.type")}</TableHead>
                <TableHead>{t("media:episodes.published")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {episodes.data.map(e => (
                <TableRow key={e.id}>
                  <TableCell>{e.episodeNumber}</TableCell>
                  <TableCell>
                    {editing?.id === e.id
                      ? (
                          <Input
                            autoFocus
                            defaultValue={e.name ?? ""}
                            onBlur={ev => update.mutate({ id: e.id, body: { name: orNull(ev.target.value) } })}
                            onKeyDown={ev => ev.key === "Enter" && (ev.target as HTMLInputElement).blur()}
                          />
                        )
                      : <button type="button" className="hover:underline" onClick={() => setEditing(e)}>{e.name ?? <span className="text-muted-foreground">—</span>}</button>}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="date"
                      className="w-36"
                      defaultValue={e.airDate ?? ""}
                      onBlur={ev => ev.target.value !== (e.airDate ?? "") && update.mutate({ id: e.id, body: { airDate: orNull(ev.target.value) } })}
                    />
                  </TableCell>
                  <TableCell>
                    <EnumSelect className="w-28" value={e.episodeType} values={EPISODE_TYPES} label={v => t(`media:episodeType.${v}`)} onChange={v => update.mutate({ id: e.id, body: { episodeType: v } })} />
                  </TableCell>
                  <TableCell>
                    <Switch checked={e.publishState === "published"} onCheckedChange={on => update.mutate({ id: e.id, body: { publishState: on ? "published" : "draft" } })} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => remove.mutate(e.id)}><Trash2 className="size-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t("media:episodes.hint")}</p>
    </div>
  );
}
