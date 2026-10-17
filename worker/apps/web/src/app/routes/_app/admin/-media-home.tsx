import type { Row, RowRule, TitleKind } from "./-media-api";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { CenteredHint } from "@/shared/components/ui/centered-hint";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { mediaApi, mediaKeys } from "./-media-api";
import { useMediaMutation } from "./-media-hooks";
import { EnumSelect, Field, MoveButtons, TitleListEditor } from "./-media-shared";

const ANY = "any";
const SORTS = ["updated", "popular", "release", "rating"] as const;

export function HomeTab() {
  const { t } = useTranslation(["common", "media"]);
  const rows = useQuery({ queryKey: mediaKeys.rows, queryFn: mediaApi.rows });
  const hero = useQuery({ queryKey: mediaKeys.hero, queryFn: mediaApi.hero });
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const setHero = useMediaMutation((ids: string[]) => mediaApi.setHero(ids));
  const update = useMediaMutation(({ id, onHome }: { id: string; onHome: boolean }) => mediaApi.updateRow(id, { onHome }));
  const reorder = useMediaMutation((ids: string[]) => mediaApi.reorderRows(ids));
  const remove = useMediaMutation((id: string) => mediaApi.deleteRow(id));
  const ids = rows.data?.map(r => r.id) ?? [];

  return (
    <div className="grid gap-8 pt-4 lg:grid-cols-[1fr_2fr]">
      <section className="space-y-2">
        <h3 className="font-medium">{t("media:home.hero")}</h3>
        <p className="text-xs text-muted-foreground">{t("media:home.heroHint")}</p>
        {hero.data && <TitleListEditor ids={hero.data} max={10} onChange={next => setHero.mutate(next)} />}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">{t("media:home.rows")}</h3>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            {t("media:home.addRow")}
          </Button>
        </div>
        {rows.data?.length === 0 && <CenteredHint>{t("media:home.empty")}</CenteredHint>}
        {rows.data && rows.data.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("media:home.name")}</TableHead>
                <TableHead>{t("media:home.content")}</TableHead>
                <TableHead>{t("media:home.onHome")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.data.map((r, i) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>
                    {r.kind === "rule" && r.rule
                      ? <Badge variant="outline">{t("media:home.ruleSummary", { sort: t(`media:home.sorts.${r.rule.sort}`), limit: r.rule.limit })}</Badge>
                      : t("media:home.manualSummary", { count: r.titleIds.length })}
                  </TableCell>
                  <TableCell><Switch checked={r.onHome} onCheckedChange={onHome => update.mutate({ id: r.id, onHome })} /></TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <MoveButtons ids={ids} index={i} onMove={next => reorder.mutate(next)} />
                    <Button size="sm" variant="ghost" onClick={() => setEditing(r)}><Pencil className="size-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => remove.mutate(r.id)}><Trash2 className="size-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      {editing !== null && <RowDialog key={editing === "new" ? "new" : editing.id} row={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RowDialog({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const { t } = useTranslation(["common", "media"]);
  const categories = useQuery({ queryKey: mediaKeys.categories, queryFn: mediaApi.categories });
  const genres = useQuery({ queryKey: mediaKeys.genres, queryFn: mediaApi.genres });
  const [name, setName] = useState(row?.name ?? "");
  const [kind, setKind] = useState(row?.kind ?? "manual");
  const [titleIds, setTitleIds] = useState(row?.titleIds ?? []);
  const [rule, setRule] = useState<RowRule>(row?.rule ?? { sort: "updated", limit: 20 });
  const save = useMediaMutation(() => {
    const body = kind === "rule" ? { name: name.trim(), rule } : { name: name.trim(), rule: null, titleIds };
    return row ? mediaApi.updateRow(row.id, body) : mediaApi.createRow({ ...body, kind });
  }, onClose);
  const pick = (key: "categoryId" | "genreId" | "kind", value: string) => {
    const next = { ...rule };
    if (value === ANY)
      delete next[key];
    else
      (next as Record<string, unknown>)[key] = value;
    setRule(next);
  };

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{row ? row.name : t("media:home.addRow")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={t("media:home.name")}><Input value={name} onChange={e => setName(e.target.value)} /></Field>
          {!row && (
            <Field label={t("media:home.kind")}>
              <EnumSelect value={kind} values={["manual", "rule"] as const} label={v => t(`media:home.kinds.${v}`)} onChange={setKind} />
            </Field>
          )}
          {kind === "manual"
            ? <TitleListEditor ids={titleIds} max={100} onChange={setTitleIds} />
            : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("media:titles.category")}>
                    <EnumSelect
                      value={rule.categoryId ?? ANY}
                      values={[ANY, ...(categories.data ?? []).map(c => c.id)]}
                      label={v => (v === ANY ? t("media:home.any") : categories.data?.find(c => c.id === v)?.name ?? v)}
                      onChange={v => pick("categoryId", v)}
                    />
                  </Field>
                  <Field label={t("media:info.genres")}>
                    <EnumSelect
                      value={rule.genreId ?? ANY}
                      values={[ANY, ...(genres.data ?? []).map(g => g.id)]}
                      label={v => (v === ANY ? t("media:home.any") : genres.data?.find(g => g.id === v)?.name ?? v)}
                      onChange={v => pick("genreId", v)}
                    />
                  </Field>
                  <Field label={t("media:titles.kind")}>
                    <EnumSelect
                      value={rule.kind ?? ANY}
                      values={[ANY, "movie", "series"] as const}
                      label={v => (v === ANY ? t("media:home.any") : t(`media:kind.${v as TitleKind}`))}
                      onChange={v => pick("kind", v)}
                    />
                  </Field>
                  <Field label={t("media:home.sort")}>
                    <EnumSelect value={rule.sort} values={SORTS} label={v => t(`media:home.sorts.${v}`)} onChange={sort => setRule({ ...rule, sort })} />
                  </Field>
                  <Field label={t("media:home.limit")}>
                    <Input type="number" min={1} max={50} value={rule.limit} onChange={e => setRule({ ...rule, limit: Math.min(50, Math.max(1, Number(e.target.value) || 1)) })} />
                  </Field>
                </div>
              )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">{t("common.cancel")}</Button>} />
          <Button disabled={!name.trim() || save.isPending} onClick={() => save.mutate(undefined)}>{t("media:save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
