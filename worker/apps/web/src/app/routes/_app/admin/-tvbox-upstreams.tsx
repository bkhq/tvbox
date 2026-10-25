import type { Upstream } from "./-tvbox-api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { CenteredHint } from "@/shared/components/ui/centered-hint";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Switch } from "@/shared/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { errorMessage, tvboxApi, tvboxKeys } from "./-tvbox-api";
import { upstreamTree } from "./-tvbox-view";

export function UpstreamsTab() {
  const { t } = useTranslation(["common", "tvbox"]);
  const qc = useQueryClient();
  const query = useQuery({ queryKey: tvboxKeys.upstreams, queryFn: tvboxApi.upstreams });
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [deleting, setDeleting] = useState<Upstream | null>(null);

  const refresh = () => void qc.invalidateQueries({
    queryKey: ["tvbox"],
  });
  const onError = (err: unknown) => toast.error(errorMessage(err, t("common.error.operationFailed")));

  const create = useMutation({
    mutationFn: () => tvboxApi.createUpstream({
      name: name.trim(),
      url: url.trim(),
    }),
    onSuccess: () => {
      setAddOpen(false);
      setName("");
      setUrl("");
      refresh();
    },
    onError,
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof tvboxApi.updateUpstream>[1] }) => tvboxApi.updateUpstream(id, body),
    onSuccess: refresh,
    onError,
  });
  const sync = useMutation({
    mutationFn: (id: string) => tvboxApi.syncUpstream(id),
    onSuccess: (r) => {
      toast.success(t("tvbox:upstreams.synced", {
        added: r.added,
        updated: r.updated,
        removed: r.removed,
        mirrored: r.assets.mirrored,
      }));
      if (r.lines && r.lines.failed.length > 0) {
        toast.warning(t("tvbox:upstreams.linesFailed", {
          count: r.lines.failed.length,
          total: r.lines.total,
          names: r.lines.failed.join("、"),
        }));
      }
      if (r.assets.failed.length > 0)
        toast.warning(t("tvbox:upstreams.assetsFailed", { count: r.assets.failed.length }));
      refresh();
    },
    onError: (err) => {
      onError(err);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => tvboxApi.deleteUpstream(id),
    onSuccess: () => {
      setDeleting(null);
      refresh();
    },
    onError,
  });

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">{t("tvbox:upstreams.description")}</p>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" />
          {t("tvbox:upstreams.add")}
        </Button>
      </div>

      {query.error && <ErrorBanner message={errorMessage(query.error, t("common.error.loadFailed"))} />}
      {query.isLoading && <CenteredHint>{t("common.loading")}</CenteredHint>}
      {query.data?.length === 0 && <CenteredHint>{t("tvbox:upstreams.empty")}</CenteredHint>}

      {query.data && query.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("tvbox:upstreams.name")}</TableHead>
              <TableHead>{t("tvbox:upstreams.usage")}</TableHead>
              <TableHead>{t("tvbox:upstreams.lastSync")}</TableHead>
              <TableHead>{t("tvbox:upstreams.scheduled")}</TableHead>
              <TableHead className="text-right">{t("tvbox:actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {upstreamTree(query.data).map(({ upstream: up, depth, lines }) => (
              <TableRow key={up.id}>
                <TableCell className={depth === 1
                  ? "max-w-md pl-8"
                  : "max-w-md"}
                >
                  <div className="flex items-center gap-2 font-medium">
                    {up.name}
                    {up.isPrimary && <Badge>{t("tvbox:upstreams.primary")}</Badge>}
                    {lines > 0 && <Badge variant="outline">{t("tvbox:upstreams.collection", { count: lines })}</Badge>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground" title={up.url}>{up.url}</div>
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  {t("tvbox:upstreams.usageText", { entries: up.entryCount, devices: up.deviceCount })}
                </TableCell>
                <TableCell className="text-xs">
                  {up.lastSyncedAt
                    ? new Date(up.lastSyncedAt).toLocaleString()
                    : "—"}
                  {up.lastStatus === "error" && (
                    <div className="max-w-xs truncate text-destructive" title={up.lastError ?? ""}>{up.lastError}</div>
                  )}
                </TableCell>
                <TableCell>
                  <Switch
                    checked={up.syncEnabled}
                    onCheckedChange={syncEnabled => update.mutate({
                      id: up.id,
                      body: { syncEnabled },
                    })}
                  />
                </TableCell>
                <TableCell className="space-x-1 text-right whitespace-nowrap">
                  <Button size="sm" variant="outline" disabled={sync.isPending} onClick={() => sync.mutate(up.id)}>
                    <RefreshCw className={sync.isPending && sync.variables === up.id
                      ? "size-4 animate-spin"
                      : "size-4"}
                    />
                    {t("tvbox:upstreams.syncNow")}
                  </Button>
                  {!up.isPrimary && up.parentId === null && lines === 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      title={t("tvbox:upstreams.makePrimary")}
                      onClick={() => update.mutate({
                        id: up.id,
                        body: { isPrimary: true },
                      })}
                    >
                      <Star className="size-4" />
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(up)}>
                    <Trash2 className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("tvbox:upstreams.add")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("tvbox:upstreams.name")}</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="xiaosa" />
            </div>
            <div className="space-y-1">
              <Label>URL</Label>
              <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…/api.json" />
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">{t("common.cancel")}</Button>} />
            <Button disabled={!name.trim() || !url.trim() || create.isPending} onClick={() => create.mutate()}>
              {t("tvbox:upstreams.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={open => !open && setDeleting(null)}
        title={t("tvbox:upstreams.deleteTitle")}
        description={t("tvbox:upstreams.deleteDescription", { name: deleting?.name ?? "" })}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}
