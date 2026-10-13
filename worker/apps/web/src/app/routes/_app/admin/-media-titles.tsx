import type { PublishState, Title, TitleKind } from "./-media-api";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import { CenteredHint } from "@/shared/components/ui/centered-hint";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { mediaApi, mediaKeys, PUBLISH_STATES } from "./-media-api";
import { errorText, useMediaMutation } from "./-media-hooks";
import { EnumSelect, Field, StateBadge } from "./-media-shared";
import { TitleEditor } from "./-media-title-editor";

const PAGE = 20;
const ALL = "all";

export function TitlesTab() {
  const { t } = useTranslation(["common", "media"]);
  const [categoryId, setCategoryId] = useState(ALL);
  const [kind, setKind] = useState<TitleKind | typeof ALL>(ALL);
  const [state, setState] = useState<PublishState | typeof ALL>(ALL);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<Title | null>(null);

  const categories = useQuery({ queryKey: mediaKeys.categories, queryFn: mediaApi.categories });
  const params = {
    categoryId: categoryId === ALL ? undefined : categoryId,
    kind: kind === ALL ? undefined : kind,
    publishState: state === ALL ? undefined : state,
    q: q.trim() || undefined,
    page,
    limit: PAGE,
  };
  const titles = useQuery({ queryKey: mediaKeys.titles(params), queryFn: () => mediaApi.titles(params) });
  const remove = useMediaMutation((id: number) => mediaApi.deleteTitle(id), () => setDeleting(null));
  const categoryName = (id: string) => categories.data?.find(c => c.id === id)?.name ?? id;
  const pages = Math.max(1, Math.ceil((titles.data?.total ?? 0) / PAGE));
  const filter = (fn: () => void) => {
    fn();
    setPage(1);
  };

  return (
    <div className="space-y-4 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-56" value={q} onChange={e => filter(() => setQ(e.target.value))} placeholder={t("media:titles.search")} />
        <EnumSelect
          className="w-32"
          value={categoryId}
          values={[ALL, ...(categories.data ?? []).map(c => c.id)]}
          label={v => (v === ALL ? t("media:titles.allCategories") : categoryName(v))}
          onChange={v => filter(() => setCategoryId(v))}
        />
        <EnumSelect
          className="w-28"
          value={kind}
          values={[ALL, "movie", "series"] as const}
          label={v => (v === ALL ? t("media:titles.allKinds") : t(`media:kind.${v}`))}
          onChange={v => filter(() => setKind(v))}
        />
        <EnumSelect
          className="w-28"
          value={state}
          values={[ALL, ...PUBLISH_STATES] as const}
          label={v => (v === ALL ? t("media:titles.allStates") : t(`media:state.${v}`))}
          onChange={v => filter(() => setState(v))}
        />
        <div className="flex-1" />
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-4" />
          {t("media:titles.add")}
        </Button>
      </div>

      {titles.error && <ErrorBanner message={errorText(titles.error, t("common.error.loadFailed"))} />}
      {titles.isLoading && <CenteredHint>{t("common.loading")}</CenteredHint>}
      {titles.data?.items.length === 0 && <CenteredHint>{t("media:titles.empty")}</CenteredHint>}

      {titles.data && titles.data.items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("media:titles.title")}</TableHead>
              <TableHead>{t("media:titles.category")}</TableHead>
              <TableHead>{t("media:titles.state")}</TableHead>
              <TableHead>{t("media:titles.updated")}</TableHead>
              <TableHead className="text-right">{t("media:actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {titles.data.items.map(x => (
              <TableRow key={x.id}>
                <TableCell className="max-w-md">
                  <button type="button" className="font-medium hover:underline" onClick={() => setEditing(x.id)}>{x.title}</button>
                  <div className="text-xs text-muted-foreground">
                    {t(`media:kind.${x.kind}`)}
                    {x.kind === "series" && ` · ${t("media:titles.seasonCount", { count: x.seasonCount })}`}
                    {x.releaseDate && ` · ${x.releaseDate}`}
                  </div>
                </TableCell>
                <TableCell>{categoryName(x.categoryId)}</TableCell>
                <TableCell><StateBadge state={x.publishState} /></TableCell>
                <TableCell className="text-xs">{new Date(x.updatedAt).toLocaleString()}</TableCell>
                <TableCell className="space-x-1 text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" title={t("common.edit")} onClick={() => setEditing(x.id)}><Pencil className="size-4" /></Button>
                  <Button size="sm" variant="ghost" title={t("common.delete")} onClick={() => setDeleting(x)}><Trash2 className="size-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("media:prev")}</Button>
          <span>
            {page}
            {" "}
            /
            {" "}
            {pages}
          </span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t("media:next")}</Button>
        </div>
      )}

      <AddTitleDialog open={adding} onOpenChange={setAdding} onCreated={id => setEditing(id)} />
      {editing !== null && <TitleEditor id={editing} onClose={() => setEditing(null)} />}

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={open => !open && setDeleting(null)}
        title={t("media:titles.deleteTitle")}
        description={t("media:titles.deleteDescription", { name: deleting?.title ?? "" })}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}

function AddTitleDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (id: number) => void }) {
  const { t } = useTranslation(["common", "media"]);
  const categories = useQuery({ queryKey: mediaKeys.categories, queryFn: mediaApi.categories });
  const [kind, setKind] = useState<TitleKind>("movie");
  const [categoryId, setCategoryId] = useState("");
  const [title, setTitle] = useState("");
  const allowed = (categories.data ?? []).filter(c => c.kinds.includes(kind));
  const category = allowed.some(c => c.id === categoryId) ? categoryId : (allowed[0]?.id ?? "");

  const create = useMediaMutation(() => mediaApi.createTitle({ kind, categoryId: category, title: title.trim() }), (row) => {
    onOpenChange(false);
    setTitle("");
    onCreated(row.id);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("media:titles.add")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={t("media:titles.kind")}>
            <EnumSelect value={kind} values={["movie", "series"] as const} label={v => t(`media:kind.${v}`)} onChange={setKind} />
          </Field>
          <Field label={t("media:titles.category")}>
            <EnumSelect value={category} values={allowed.map(c => c.id)} label={v => allowed.find(c => c.id === v)?.name ?? v} onChange={setCategoryId} />
          </Field>
          <Field label={t("media:titles.title")}>
            <Input value={title} onChange={e => setTitle(e.target.value)} />
          </Field>
          {kind === "series" && <p className="text-xs text-muted-foreground">{t("media:titles.seriesHint")}</p>}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">{t("common.cancel")}</Button>} />
          <Button disabled={!title.trim() || !category || create.isPending} onClick={() => create.mutate(undefined)}>{t("media:titles.add")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
