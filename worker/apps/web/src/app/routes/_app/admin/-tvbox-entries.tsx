import type { Entry, EntrySource, JsonObject, ListKind } from "./-tvbox-api";
import type { HealthFilter } from "./-tvbox-view";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveRestore, ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus, ShieldOff, Trash2, Undo2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { CenteredHint } from "@/shared/components/ui/centered-hint";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { Switch } from "@/shared/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { errorMessage, LIST_KINDS, tvboxApi, tvboxKeys } from "./-tvbox-api";
import { JsonDialog } from "./-tvbox-json-dialog";
import { entrySubtitle, entryTitle, filterEntries, filterHealth, moveId, siteEngine, upstreamLabel } from "./-tvbox-view";

// New sites start from one of these: a CMS API the app calls itself (type 1
// JSON / type 0 XML, the usual 苹果CMS endpoints), or a spider in a jar.
const SITE_TEMPLATES = {
  cmsJson: {
    key: "",
    name: "",
    type: 1,
    api: "https://example.com/api.php/provide/vod/",
    searchable: 1,
    quickSearch: 1,
    filterable: 1,
  },
  cmsXml: {
    key: "",
    name: "",
    type: 0,
    api: "https://example.com/api.php/provide/vod/at/xml/",
    searchable: 1,
    quickSearch: 1,
    filterable: 0,
  },
  // Our own spiders in tvbox.jar ("@tvbox": the latest build, filled in when published).
  macCms: {
    key: "",
    name: "",
    type: 3,
    api: "csp_MacCms",
    jar: "@tvbox",
    ext: { api: "https://example.com/api.php/provide/vod/", categories: [], parse: "" },
    searchable: 1,
    quickSearch: 1,
    filterable: 0,
  },
  alist: {
    key: "",
    name: "",
    type: 3,
    api: "csp_AList",
    jar: "@tvbox",
    ext: [
      {
        name: "",
        server: "https://alist.example.com",
        login: { username: "", password: "" },
        search: true,
      },
    ],
    searchable: 1,
    quickSearch: 0,
    filterable: 1,
  },
  jar: {
    key: "",
    name: "",
    type: 3,
    api: "csp_",
    jar: "",
    ext: "",
    searchable: 1,
    quickSearch: 1,
    filterable: 1,
  },
} satisfies Record<string, JsonObject>;
type SiteTemplate = keyof typeof SITE_TEMPLATES;

const NEW_ENTRY: Record<ListKind, JsonObject> = {
  sites: SITE_TEMPLATES.cmsJson,
  parses: { name: "", type: 0, url: "" },
  lives: { name: "", type: 0, url: "" },
  rules: { name: "", hosts: [], regex: [] },
  doh: { name: "", url: "", ips: [] },
};

export function EntriesTab() {
  const { t } = useTranslation(["common", "tvbox"]);
  const qc = useQueryClient();
  const [kind, setKind] = useState<ListKind>("sites");
  const [source, setSource] = useState<EntrySource>("all");
  const [health, setHealth] = useState<HealthFilter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [editing, setEditing] = useState<Entry | "new" | null>(null);
  const [deleting, setDeleting] = useState<Entry | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [template, setTemplate] = useState<SiteTemplate>("cmsJson");
  // The recycle bin: upstream entries deleted here, which syncs leave alone.
  const [trash, setTrash] = useState(false);

  const query = useQuery({
    queryKey: tvboxKeys.entries(kind, source, trash),
    queryFn: () => tvboxApi.entries(kind, source, trash),
  });
  const upstreams = useQuery({ queryKey: tvboxKeys.upstreams, queryFn: tvboxApi.upstreams });
  const upstreamName = useMemo(() => new Map(upstreams.data?.map(u => [
    u.id,
    upstreamLabel(u, upstreams.data),
  ])), [upstreams.data]);

  const refresh = () => void qc.invalidateQueries({
    queryKey: ["tvbox", "entries"],
  });
  const onError = (err: unknown) => toast.error(errorMessage(err, t("common.error.operationFailed")));

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { data?: JsonObject; enabled?: boolean; healthExempt?: boolean } }) => tvboxApi.updateEntry(id, body),
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
  const revert = useMutation({
    mutationFn: (id: string) => tvboxApi.revertEntry(id),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => tvboxApi.deleteEntry(id),
    onSuccess: () => {
      setDeleting(null);
      refresh();
    },
    onError,
  });
  const restore = useMutation({
    mutationFn: (id: string) => tvboxApi.restoreEntry(id),
    onSuccess: refresh,
    onError,
  });
  const bulkRemove = useMutation({
    mutationFn: () => tvboxApi.deleteEntries([...selected]),
    onSuccess: (r) => {
      toast.success(t("tvbox:entries.bulkDeleted", { count: r.count }));
      setBulkDeleting(false);
      setSelected(new Set());
      refresh();
    },
    onError,
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => tvboxApi.reorderEntries(kind, ids),
    onSuccess: refresh,
    onError,
  });
  const bulk = useMutation({
    mutationFn: (enabled: boolean) => tvboxApi.setEntriesEnabled([...selected], enabled),
    onSuccess: (r) => {
      toast.success(t("tvbox:entries.bulkDone", { count: r.count }));
      setSelected(new Set());
      refresh();
    },
    onError,
  });

  const rows = query.data ?? [];
  const needle = search.trim();
  const visible = filterHealth(filterEntries(rows, needle), health);
  // Reordering renumbers what it is given, so it needs the whole list.
  const canReorder = !needle && source === "all" && health === "all" && !trash;
  const allVisibleSelected = visible.length > 0 && visible.every(r => selected.has(r.id));

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (!next.delete(id))
      next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allVisibleSelected
    ? new Set()
    : new Set(visible.map(r => r.id)));
  const changeView = (apply: () => void) => {
    setSelected(new Set());
    apply();
  };

  const move = (entry: Entry, delta: number) => {
    const ids = moveId(rows.map(r => r.id), entry.id, delta);
    if (ids)
      reorder.mutate(ids);
  };

  const editingEntry = editing !== null && editing !== "new"
    ? editing
    : null;

  return (
    <div className="space-y-4 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={kind} onValueChange={v => changeView(() => setKind(v as ListKind))}>
          <TabsList>
            {LIST_KINDS.map(k => <TabsTrigger key={k} value={k}>{t(`tvbox:kinds.${k}`)}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Select value={health} onValueChange={v => v !== null && changeView(() => setHealth(v as HealthFilter))}>
            <SelectTrigger className="w-32">
              <SelectValue>{(v: string) => t(`tvbox:health.filter.${v}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {([
                "all",
                "fail",
                "disabledByHealth",
                "exempt",
              ] as const).map(f => <SelectItem key={f} value={f}>{t(`tvbox:health.filter.${f}`)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={source} onValueChange={v => v !== null && changeView(() => setSource(v))}>
            <SelectTrigger className="w-40">
              <SelectValue>
                {(v: string) => v === "all"
                  ? t("tvbox:entries.allSources")
                  : v === "common"
                    ? t("tvbox:entries.common")
                    : upstreamName.get(v) ?? v}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("tvbox:entries.allSources")}</SelectItem>
              <SelectItem value="common">{t("tvbox:entries.common")}</SelectItem>
              {upstreams.data?.map(u => <SelectItem key={u.id} value={u.id}>{upstreamLabel(u, upstreams.data)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input className="w-56" value={search} onChange={e => setSearch(e.target.value)} placeholder={t("tvbox:entries.search")} />
          <Button size="sm" variant={trash ? "default" : "outline"} title={t("tvbox:entries.trashHint")} onClick={() => changeView(() => setTrash(v => !v))}>
            <Trash2 className="size-4" />
            {t("tvbox:entries.trash")}
          </Button>
          <Button
            size="sm"
            disabled={trash}
            onClick={() => {
              setTemplate("cmsJson");
              setEditing("new");
            }}
          >
            <Plus className="size-4" />
            {t("tvbox:entries.add")}
          </Button>
        </div>
      </div>

      {query.error && <ErrorBanner message={errorMessage(query.error, t("common.error.loadFailed"))} />}
      {query.isLoading && <CenteredHint>{t("common.loading")}</CenteredHint>}
      {query.data && visible.length === 0 && <CenteredHint>{t("tvbox:entries.empty")}</CenteredHint>}

      <p className="text-xs text-muted-foreground">{t("tvbox:health.hint")}</p>

      {selected.size > 0 && !trash && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span>{t("tvbox:entries.selected", { count: selected.size })}</span>
          <Button size="sm" variant="outline" disabled={bulk.isPending} onClick={() => bulk.mutate(true)}>
            <Eye className="size-4" />
            {t("tvbox:entries.enableSelected")}
          </Button>
          <Button size="sm" variant="outline" disabled={bulk.isPending} onClick={() => bulk.mutate(false)}>
            <EyeOff className="size-4" />
            {t("tvbox:entries.disableSelected")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBulkDeleting(true)}>
            <Trash2 className="size-4" />
            {t("tvbox:entries.deleteSelected")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>{t("common.cancel")}</Button>
        </div>
      )}

      {visible.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <input type="checkbox" aria-label={t("tvbox:entries.selectAll")} checked={allVisibleSelected} onChange={toggleAll} className="size-4 accent-primary" />
              </TableHead>
              <TableHead className="w-12">{t("tvbox:entries.enabled")}</TableHead>
              <TableHead>{t("tvbox:entries.entry")}</TableHead>
              <TableHead>{t("tvbox:entries.source")}</TableHead>
              <TableHead>{t("tvbox:health.column")}</TableHead>
              <TableHead className="text-right">{t("tvbox:actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map(entry => (
              <TableRow key={entry.id} className={entry.enabled ? undefined : "opacity-60"}>
                <TableCell>
                  <input type="checkbox" aria-label={entryTitle(entry)} checked={selected.has(entry.id)} onChange={() => toggle(entry.id)} className="size-4 accent-primary" />
                </TableCell>
                <TableCell>
                  <Switch
                    checked={entry.enabled}
                    disabled={trash}
                    onCheckedChange={enabled => update.mutate({
                      id: entry.id,
                      body: { enabled },
                    })}
                  />
                </TableCell>
                <TableCell className="max-w-lg">
                  <div className="flex items-center gap-2 font-medium">
                    {entryTitle(entry)}
                    {kind === "sites" && siteEngine(entry.data) && <Badge variant="outline" className="font-normal">{t(`tvbox:entries.engine.${siteEngine(entry.data)}`)}</Badge>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{entrySubtitle(entry)}</div>
                </TableCell>
                <TableCell className="space-x-1 text-xs whitespace-nowrap">
                  {entry.upstreamId
                    ? <span>{upstreamName.get(entry.upstreamId) ?? "—"}</span>
                    : <Badge variant="outline">{t("tvbox:entries.common")}</Badge>}
                  {entry.locallyModified && <Badge variant="secondary">{t("tvbox:entries.modified")}</Badge>}
                  {entry.upstreamRemoved && <Badge variant="destructive">{t("tvbox:entries.removedUpstream")}</Badge>}
                </TableCell>
                <TableCell
                  className="space-x-1 text-xs whitespace-nowrap"
                  title={entry.healthCheckedAt
                    ? `${new Date(entry.healthCheckedAt).toLocaleString()}\n${entry.healthDetail ?? ""}`
                    : undefined}
                >
                  <Badge variant={entry.healthStatus === "fail"
                    ? "destructive"
                    : entry.healthStatus === "ok"
                      ? "secondary"
                      : "outline"}
                  >
                    {t(`tvbox:health.status.${entry.healthStatus ?? "unchecked"}`)}
                  </Badge>
                  {entry.disabledByHealth && <Badge variant="outline">{t("tvbox:health.disabledByHealth")}</Badge>}
                  {entry.healthExempt && <Badge>{t("tvbox:health.exempt")}</Badge>}
                </TableCell>
                <TableCell className="space-x-1 text-right whitespace-nowrap">
                  {trash && (
                    <Button size="sm" variant="outline" disabled={restore.isPending} onClick={() => restore.mutate(entry.id)}>
                      <ArchiveRestore className="size-4" />
                      {t("tvbox:entries.restore")}
                    </Button>
                  )}
                  {!trash && canReorder && (
                    <>
                      <Button size="sm" variant="ghost" disabled={reorder.isPending} onClick={() => move(entry, -1)}><ArrowUp className="size-4" /></Button>
                      <Button size="sm" variant="ghost" disabled={reorder.isPending} onClick={() => move(entry, 1)}><ArrowDown className="size-4" /></Button>
                    </>
                  )}
                  {!trash && <Button size="sm" variant="ghost" title={t("common.edit")} onClick={() => setEditing(entry)}><Pencil className="size-4" /></Button>}
                  {!trash && entry.healthExempt && (
                    <Button
                      size="sm"
                      variant="ghost"
                      title={t("tvbox:health.unexempt")}
                      onClick={() => update.mutate({
                        id: entry.id,
                        body: { healthExempt: false },
                      })}
                    >
                      <ShieldOff className="size-4" />
                    </Button>
                  )}
                  {!trash && entry.locallyModified && (
                    <Button size="sm" variant="ghost" title={t("tvbox:entries.revert")} onClick={() => revert.mutate(entry.id)}><Undo2 className="size-4" /></Button>
                  )}
                  {!trash && (
                    <Button size="sm" variant="ghost" title={t("common.delete")} onClick={() => setDeleting(entry)}><Trash2 className="size-4" /></Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <JsonDialog
        // A new template replaces the text.
        key={editingEntry
          ? editingEntry.id
          : `new-${template}`}
        open={editing !== null}
        onOpenChange={open => !open && setEditing(null)}
        title={editingEntry
          ? entryTitle(editingEntry)
          : t("tvbox:entries.add")}
        value={editingEntry
          ? editingEntry.data
          : kind === "sites"
            ? SITE_TEMPLATES[template]
            : NEW_ENTRY[kind]}
        objectOnly
        pending={update.isPending || create.isPending}
        extra={(
          <>
            {editingEntry?.locallyModified && editingEntry.upstreamData && <p className="text-xs text-muted-foreground">{t("tvbox:entries.modifiedHint")}</p>}
            {editing === "new" && kind === "sites" && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {(Object.keys(SITE_TEMPLATES) as SiteTemplate[]).map(k => (
                  <Button
                    key={k}
                    type="button"
                    size="sm"
                    variant={template === k
                      ? "default"
                      : "outline"}
                    onClick={() => setTemplate(k)}
                  >
                    {t(`tvbox:entries.engine.${k}`)}
                  </Button>
                ))}
                {t(`tvbox:entries.templateHint.${template}`)}
              </div>
            )}
            <UploadButton />
          </>
        )}
        onSave={value => editingEntry
          ? update.mutate({
              id: editingEntry.id,
              body: { data: value as JsonObject },
            })
          : create.mutate(value as JsonObject)}
      />

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={open => !open && setDeleting(null)}
        title={t("tvbox:entries.deleteTitle")}
        description={deleting
          ? `${entryTitle(deleting)} · ${t(deleting.upstreamId ? "tvbox:entries.deleteUpstreamHint" : "tvbox:entries.deleteLocalHint")}`
          : ""}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />

      <ConfirmDeleteDialog
        open={bulkDeleting}
        onOpenChange={setBulkDeleting}
        title={t("tvbox:entries.bulkDeleteTitle", { count: selected.size })}
        description={t("tvbox:entries.bulkDeleteHint")}
        pending={bulkRemove.isPending}
        onConfirm={() => bulkRemove.mutate()}
      />
    </div>
  );
}

/** Upload a file (spider jar, ext json…) and copy the path a config uses for it. */
function UploadButton() {
  const { t } = useTranslation(["common", "tvbox"]);
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (file: File) => tvboxApi.uploadFile(file),
    onSuccess: async (r) => {
      await navigator.clipboard?.writeText(r.path).catch(() => {});
      toast.success(t("tvbox:entries.uploaded", { path: r.path }), { duration: 10_000 });
    },
    onError: (err: unknown) => toast.error(errorMessage(err, t("common.error.operationFailed"))),
  });
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file)
            upload.mutate(file);
          e.target.value = "";
        }}
      />
      <Button type="button" size="sm" variant="outline" disabled={upload.isPending} onClick={() => inputRef.current?.click()}>
        <Upload className="size-4" />
        {t("tvbox:entries.upload")}
      </Button>
      {t("tvbox:entries.uploadHint")}
    </div>
  );
}
