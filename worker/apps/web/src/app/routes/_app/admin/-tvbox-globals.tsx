import type { Global } from "./-tvbox-api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { CenteredHint } from "@/shared/components/ui/centered-hint";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { errorMessage, LIST_KINDS, tvboxApi, tvboxKeys } from "./-tvbox-api";
import { JsonDialog } from "./-tvbox-json-dialog";

export function GlobalsTab() {
  const { t } = useTranslation(["common", "tvbox"]);
  const qc = useQueryClient();
  const query = useQuery({ queryKey: tvboxKeys.globals, queryFn: tvboxApi.globals });
  const [editing, setEditing] = useState<Global | "new" | null>(null);
  const [newKey, setNewKey] = useState("");
  const [deleting, setDeleting] = useState<Global | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: tvboxKeys.globals });
  const onError = (err: unknown) => toast.error(errorMessage(err, t("common.error.operationFailed")));

  const put = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) => tvboxApi.putGlobal(key, value),
    onSuccess: () => {
      setEditing(null);
      setNewKey("");
      refresh();
    },
    onError,
  });
  const revert = useMutation({
    mutationFn: (key: string) => tvboxApi.revertGlobal(key),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: (key: string) => tvboxApi.deleteGlobal(key),
    onSuccess: () => {
      setDeleting(null);
      refresh();
    },
    onError,
  });

  const editingGlobal = editing !== null && editing !== "new"
    ? editing
    : null;
  const keyValid = newKey.trim() !== "" && !LIST_KINDS.includes(newKey.trim() as never);

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">{t("tvbox:globals.description")}</p>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="size-4" />
          {t("tvbox:globals.add")}
        </Button>
      </div>

      {query.error && <ErrorBanner message={errorMessage(query.error, t("common.error.loadFailed"))} />}
      {query.isLoading && <CenteredHint>{t("common.loading")}</CenteredHint>}
      {query.data?.length === 0 && <CenteredHint>{t("tvbox:globals.empty")}</CenteredHint>}

      {query.data && query.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("tvbox:globals.key")}</TableHead>
              <TableHead>{t("tvbox:globals.value")}</TableHead>
              <TableHead className="text-right">{t("tvbox:actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data.map(g => (
              <TableRow key={g.key}>
                <TableCell className="font-medium whitespace-nowrap">
                  {g.key}
                  {g.locallyModified && <Badge variant="secondary" className="ml-2">{t("tvbox:entries.modified")}</Badge>}
                  {g.upstreamValue === null && <Badge variant="outline" className="ml-2">{t("tvbox:entries.local")}</Badge>}
                </TableCell>
                <TableCell className="max-w-xl truncate font-mono text-xs">{JSON.stringify(g.value)}</TableCell>
                <TableCell className="space-x-1 text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" title={t("common.edit")} onClick={() => setEditing(g)}><Pencil className="size-4" /></Button>
                  {g.locallyModified && (
                    <Button size="sm" variant="ghost" title={t("tvbox:entries.revert")} onClick={() => revert.mutate(g.key)}><Undo2 className="size-4" /></Button>
                  )}
                  {g.upstreamValue === null && (
                    <Button size="sm" variant="ghost" title={t("common.delete")} onClick={() => setDeleting(g)}><Trash2 className="size-4" /></Button>
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
        title={editingGlobal
          ? editingGlobal.key
          : t("tvbox:globals.add")}
        value={editingGlobal ? editingGlobal.value : ""}
        pending={put.isPending}
        extra={editing === "new"
          ? (
              <div className="space-y-1">
                <Label>{t("tvbox:globals.key")}</Label>
                <Input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="danmaku" />
              </div>
            )
          : undefined}
        onSave={(value) => {
          if (editingGlobal) {
            put.mutate({ key: editingGlobal.key, value });
          }
          else if (keyValid) {
            put.mutate({
              key: newKey.trim(),
              value,
            });
          }
          else {
            toast.error(t("tvbox:globals.invalidKey"));
          }
        }}
      />

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={open => !open && setDeleting(null)}
        title={t("tvbox:globals.deleteTitle")}
        description={deleting?.key ?? ""}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.key)}
      />
    </div>
  );
}
