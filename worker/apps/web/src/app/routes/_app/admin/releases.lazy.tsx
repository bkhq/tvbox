/* eslint-disable react-refresh/only-export-components */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createLazyFileRoute } from "@tanstack/react-router";
import { Pencil, Trash2 } from "lucide-react";
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
import { Switch } from "@/shared/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { Textarea } from "@/shared/components/ui/textarea";
import { http } from "@/shared/lib/http";

export const Route = createLazyFileRoute("/_app/admin/releases")({
  component: ReleasesPage,
});

type Channel = "stable" | "beta";

interface Release {
  readonly id: string;
  readonly versionCode: number;
  readonly versionName: string;
  readonly channel: Channel;
  readonly notes: string;
  readonly withdrawn: boolean;
  readonly createdAt: string;
  readonly assets: readonly { readonly id: string; readonly mode: string; readonly abi: string; readonly size: number }[];
}

const releasesKey = ["tvbox", "releases"] as const;

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ReleasesPage() {
  const { t } = useTranslation(["common", "releases"]);
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: releasesKey,
    queryFn: async () => (await http<{ data: Release[] }>("/tvbox/releases")).data,
  });
  const [editing, setEditing] = useState<Release | null>(null);
  const [notes, setNotes] = useState("");
  const [deleting, setDeleting] = useState<Release | null>(null);

  const onError = (err: unknown) => toast.error(err instanceof Error
    ? err.message
    : t("common.error.operationFailed"));
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Pick<Release, "channel" | "notes" | "withdrawn">> }) =>
      http(`/tvbox/releases/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setEditing(null);
      void qc.invalidateQueries({ queryKey: releasesKey });
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => http(`/tvbox/releases/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: releasesKey });
    },
    onError,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("releases:page.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("releases:page.description")}</p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{`${window.location.origin}/u/<channel>/<mode>-<abi>.json`}</p>
      </div>

      {query.error && (
        <ErrorBanner message={query.error instanceof Error
          ? query.error.message
          : t("common.error.loadFailed")}
        />
      )}
      {query.isLoading && <CenteredHint>{t("common.loading")}</CenteredHint>}
      {query.data?.length === 0 && <CenteredHint>{t("releases:empty")}</CenteredHint>}

      {query.data && query.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("releases:version")}</TableHead>
              <TableHead>{t("releases:channel")}</TableHead>
              <TableHead>{t("releases:flavors")}</TableHead>
              <TableHead>{t("releases:offered")}</TableHead>
              <TableHead className="text-right">{t("releases:actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data.map(r => (
              <TableRow key={r.id} className={r.withdrawn ? "opacity-60" : undefined}>
                <TableCell className="max-w-sm">
                  <div className="font-medium">
                    {r.versionName}
                    <span className="ml-2 text-xs text-muted-foreground">{r.versionCode}</span>
                    {r.withdrawn && <Badge variant="destructive" className="ml-2">{t("releases:withdrawn")}</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</div>
                  {r.notes && <div className="mt-1 line-clamp-2 text-xs whitespace-pre-line">{r.notes}</div>}
                </TableCell>
                <TableCell>
                  <Tabs
                    value={r.channel}
                    onValueChange={v => update.mutate({
                      id: r.id,
                      body: { channel: v as Channel },
                    })}
                  >
                    <TabsList>
                      <TabsTrigger value="stable">{t("releases:channels.stable")}</TabsTrigger>
                      <TabsTrigger value="beta">{t("releases:channels.beta")}</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </TableCell>
                <TableCell className="text-xs">
                  {r.assets.map(a => <div key={a.id}>{`${a.mode}-${a.abi} · ${mb(a.size)}`}</div>)}
                </TableCell>
                <TableCell>
                  <Switch
                    checked={!r.withdrawn}
                    onCheckedChange={on => update.mutate({
                      id: r.id,
                      body: { withdrawn: !on },
                    })}
                  />
                </TableCell>
                <TableCell className="space-x-1 text-right whitespace-nowrap">
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t("common.edit")}
                    onClick={() => {
                      setNotes(r.notes);
                      setEditing(r);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button size="sm" variant="ghost" title={t("common.delete")} onClick={() => setDeleting(r)}><Trash2 className="size-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={editing !== null} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("releases:notes", { version: editing?.versionName ?? "" })}</DialogTitle>
          </DialogHeader>
          <Textarea value={notes} onChange={e => setNotes(e.target.value)} className="h-48" />
          <DialogFooter>
            <DialogClose render={<Button variant="outline">{t("common.cancel")}</Button>} />
            <Button
              disabled={update.isPending}
              onClick={() => editing && update.mutate({
                id: editing.id,
                body: { notes },
              })}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={open => !open && setDeleting(null)}
        title={t("releases:deleteTitle")}
        description={t("releases:deleteDescription", { version: deleting?.versionName ?? "" })}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}
