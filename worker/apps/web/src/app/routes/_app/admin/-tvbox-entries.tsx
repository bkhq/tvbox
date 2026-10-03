import type { Entry, JsonObject, ListKind } from "./-tvbox-api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { CenteredHint } from "@/shared/components/ui/centered-hint";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { errorMessage, LIST_KINDS, tvboxApi, tvboxKeys } from "./-tvbox-api";
import { JsonDialog } from "./-tvbox-json-dialog";
import { entrySubtitle, entryTitle, filterEntries, moveId } from "./-tvbox-view";

const NEW_ENTRY: Record<ListKind, JsonObject> = {
  sites: { key: "", name: "", type: 3, api: "", searchable: 1, quickSearch: 1, filterable: 1 },
  parses: { name: "", type: 0, url: "" },
  lives: { name: "", type: 0, url: "" },
  rules: { name: "", hosts: [], regex: [] },
  doh: { name: "", url: "", ips: [] },
};

export function EntriesTab() {
  const { t } = useTranslation(["common", "tvbox"]);
  const qc = useQueryClient();
  const [kind, setKind] = useState<ListKind>("sites");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Entry | "new" | null>(null);
  const [deleting, setDeleting] = useState<Entry | null>(null);

  const query = useQuery({ queryKey: tvboxKeys.entries(kind), queryFn: () => tvboxApi.entries(kind) });
  const upstreams = useQuery({ queryKey: tvboxKeys.upstreams, queryFn: tvboxApi.upstreams });
  const upstreamName = useMemo(() => new Map(upstreams.data?.map(u => [u.id, u.name])), [upstreams.data]);

  const refresh = () => void qc.invalidateQueries({ queryKey: tvboxKeys.entries(kind) });
  const onError = (err: unknown) => toast.error(errorMessage(err, t("common.error.operationFailed")));

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { data?: JsonObject; enabled?: boolean } }) => tvboxApi.updateEntry(id, body),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
    onError,
  });
  const create = useMutation({
    mutationFn: (data: JsonObject) => tvboxApi.createEntry(kind, data),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
    onError,
  });
  const revert = useMutation({ mutationFn: (id: string) => tvboxApi.revertEntry(id), onSuccess: refresh, onError });
  const remove = useMutation({
    mutationFn: (id: string) => tvboxApi.deleteEntry(id),
    onSuccess: () => {
      setDeleting(null);
      refresh();
    },
    onError,
  });
  const reorder = useMutation({ mutationFn: (ids: string[]) => tvboxApi.reorderEntries(kind, ids), onSuccess: refresh, onError });

  const rows = query.data ?? [];
  const needle = search.trim();
  const visible = filterEntries(rows, needle);

  const move = (entry: Entry, delta: number) => {
    const ids = moveId(rows.map(r => r.id), entry.id, delta);
    if (ids)
      reorder.mutate(ids);
  };

  const editingEntry = editing !== null && editing !== "new" ? editing : null;

  return (
    <div className="space-y-4 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={kind} onValueChange={v => setKind(v as ListKind)}>
          <TabsList>
            {LIST_KINDS.map(k => <TabsTrigger key={k} value={k}>{t(`tvbox:kinds.${k}`)}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Input className="w-56" value={search} onChange={e => setSearch(e.target.value)} placeholder={t("tvbox:entries.search")} />
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            {t("tvbox:entries.add")}
          </Button>
        </div>
      </div>

      {query.error && <ErrorBanner message={errorMessage(query.error, t("common.error.loadFailed"))} />}
      {query.isLoading && <CenteredHint>{t("common.loading")}</CenteredHint>}
      {query.data && visible.length === 0 && <CenteredHint>{t("tvbox:entries.empty")}</CenteredHint>}

      {visible.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">{t("tvbox:entries.enabled")}</TableHead>
              <TableHead>{t("tvbox:entries.entry")}</TableHead>
              <TableHead>{t("tvbox:entries.source")}</TableHead>
              <TableHead className="text-right">{t("tvbox:actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map(entry => (
              <TableRow key={entry.id} className={entry.enabled ? undefined : "opacity-60"}>
                <TableCell>
                  <Switch checked={entry.enabled} onCheckedChange={enabled => update.mutate({ id: entry.id, body: { enabled } })} />
                </TableCell>
                <TableCell className="max-w-lg">
                  <div className="font-medium">{entryTitle(entry)}</div>
                  <div className="truncate text-xs text-muted-foreground">{entrySubtitle(entry)}</div>
                </TableCell>
                <TableCell className="space-x-1 text-xs whitespace-nowrap">
                  <span>{entry.upstreamId ? upstreamName.get(entry.upstreamId) ?? "—" : t("tvbox:entries.local")}</span>
                  {entry.locallyModified && <Badge variant="secondary">{t("tvbox:entries.modified")}</Badge>}
                  {entry.upstreamRemoved && <Badge variant="destructive">{t("tvbox:entries.removedUpstream")}</Badge>}
                </TableCell>
                <TableCell className="space-x-1 text-right whitespace-nowrap">
                  {!needle && (
                    <>
                      <Button size="sm" variant="ghost" disabled={reorder.isPending} onClick={() => move(entry, -1)}><ArrowUp className="size-4" /></Button>
                      <Button size="sm" variant="ghost" disabled={reorder.isPending} onClick={() => move(entry, 1)}><ArrowDown className="size-4" /></Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" title={t("common.edit")} onClick={() => setEditing(entry)}><Pencil className="size-4" /></Button>
                  {entry.locallyModified && (
                    <Button size="sm" variant="ghost" title={t("tvbox:entries.revert")} onClick={() => revert.mutate(entry.id)}><Undo2 className="size-4" /></Button>
                  )}
                  {entry.upstreamId === null && (
                    <Button size="sm" variant="ghost" title={t("common.delete")} onClick={() => setDeleting(entry)}><Trash2 className="size-4" /></Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <JsonDialog
        open={editing !== null}
        onOpenChange={open => !open && setEditing(null)}
        title={editingEntry ? entryTitle(editingEntry) : t("tvbox:entries.add")}
        value={editingEntry ? editingEntry.data : NEW_ENTRY[kind]}
        objectOnly
        pending={update.isPending || create.isPending}
        extra={editingEntry?.locallyModified && editingEntry.upstreamData
          ? <p className="text-xs text-muted-foreground">{t("tvbox:entries.modifiedHint")}</p>
          : undefined}
        onSave={value => editingEntry
          ? update.mutate({ id: editingEntry.id, body: { data: value as JsonObject } })
          : create.mutate(value as JsonObject)}
      />

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={open => !open && setDeleting(null)}
        title={t("tvbox:entries.deleteTitle")}
        description={deleting ? entryTitle(deleting) : ""}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}
