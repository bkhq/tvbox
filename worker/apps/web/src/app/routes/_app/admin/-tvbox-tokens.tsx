import type { Token } from "./-tvbox-api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/shared/components/ui/button";
import { CenteredHint } from "@/shared/components/ui/centered-hint";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Switch } from "@/shared/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { errorMessage, subscriptionUrl, tvboxApi, tvboxKeys } from "./-tvbox-api";

export function TokensTab() {
  const { t } = useTranslation(["common", "tvbox"]);
  const qc = useQueryClient();
  const query = useQuery({ queryKey: tvboxKeys.tokens, queryFn: tvboxApi.tokens });
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Token | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: tvboxKeys.tokens });
  const onError = (err: unknown) => toast.error(errorMessage(err, t("common.error.operationFailed")));

  const create = useMutation({
    mutationFn: () => tvboxApi.createToken(name.trim()),
    onSuccess: (row) => {
      setName("");
      setCreated(subscriptionUrl(row.token));
      refresh();
    },
    onError,
  });
  const update = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => tvboxApi.updateToken(id, { enabled }),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => tvboxApi.deleteToken(id),
    onSuccess: () => {
      setDeleting(null);
      refresh();
    },
    onError,
  });

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => toast.success(t("tvbox:tokens.copied")));
  };

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">{t("tvbox:tokens.description")}</p>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" />
          {t("tvbox:tokens.add")}
        </Button>
      </div>

      {query.error && <ErrorBanner message={errorMessage(query.error, t("common.error.loadFailed"))} />}
      {query.isLoading && <CenteredHint>{t("common.loading")}</CenteredHint>}
      {query.data?.length === 0 && <CenteredHint>{t("tvbox:tokens.empty")}</CenteredHint>}

      {query.data && query.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">{t("tvbox:entries.enabled")}</TableHead>
              <TableHead>{t("tvbox:tokens.name")}</TableHead>
              <TableHead>{t("tvbox:tokens.created")}</TableHead>
              <TableHead className="text-right">{t("tvbox:actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data.map(token => (
              <TableRow key={token.id}>
                <TableCell>
                  <Switch checked={token.enabled} onCheckedChange={enabled => update.mutate({ id: token.id, enabled })} />
                </TableCell>
                <TableCell>
                  <div className="font-medium">{token.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">{`…${token.hint}`}</div>
                </TableCell>
                <TableCell className="text-xs">{new Date(token.createdAt).toLocaleString()}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(token)}><Trash2 className="size-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open)
            setCreated(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("tvbox:tokens.add")}</DialogTitle>
            {created && <DialogDescription>{t("tvbox:tokens.shownOnce")}</DialogDescription>}
          </DialogHeader>
          {created
            ? (
                <div className="flex items-center gap-2">
                  <Input readOnly value={created} className="font-mono text-xs" />
                  <Button size="sm" variant="outline" onClick={() => copy(created)}><Copy className="size-4" /></Button>
                </div>
              )
            : (
                <div className="space-y-1">
                  <Label>{t("tvbox:tokens.name")}</Label>
                  <Input value={name} onChange={e => setName(e.target.value)} placeholder={t("tvbox:tokens.namePlaceholder")} />
                </div>
              )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline">{created ? t("tvbox:json.close") : t("common.cancel")}</Button>} />
            {!created && (
              <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
                {t("tvbox:tokens.add")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={open => !open && setDeleting(null)}
        title={t("tvbox:tokens.deleteTitle")}
        description={t("tvbox:tokens.deleteDescription", { name: deleting?.name ?? "" })}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}
