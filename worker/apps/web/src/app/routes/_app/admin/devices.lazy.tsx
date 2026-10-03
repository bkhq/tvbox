/* eslint-disable react-refresh/only-export-components */
import type { Device, JsonObject, Upstream } from "./-tvbox-api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createLazyFileRoute } from "@tanstack/react-router";
import { Copy, Eye, Link2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
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
import { Textarea } from "@/shared/components/ui/textarea";
import { EnrollmentsSection } from "./-devices-enrollments";
import { UpstreamPicker } from "./-devices-upstreams";
import { errorMessage, subscriptionUrl, tvboxApi, tvboxKeys } from "./-tvbox-api";
import { JsonDialog } from "./-tvbox-json-dialog";
import { upstreamLabel } from "./-tvbox-view";

export const Route = createLazyFileRoute("/_app/admin/devices")({
  component: DevicesPage,
});

interface FormState {
  readonly name: string;
  readonly note: string;
  readonly allUpstreams: boolean;
  readonly upstreamIds: ReadonlySet<string>;
}

const EMPTY_FORM: FormState = { name: "", note: "", allUpstreams: true, upstreamIds: new Set() };

function DevicesPage() {
  const { t } = useTranslation(["common", "devices"]);
  const qc = useQueryClient();
  const devices = useQuery({ queryKey: tvboxKeys.devices, queryFn: tvboxApi.devices });
  const upstreams = useQuery({ queryKey: tvboxKeys.upstreams, queryFn: tvboxApi.upstreams });

  const [form, setForm] = useState<{ device: Device | null; state: FormState } | null>(null);
  const [showUrl, setShowUrl] = useState<Device | null>(null);
  const [preview, setPreview] = useState<{ name: string; config: JsonObject } | null>(null);
  const [deleting, setDeleting] = useState<Device | null>(null);
  const [rotating, setRotating] = useState<Device | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: ["tvbox"] });
  const onError = (err: unknown) => toast.error(errorMessage(err, t("common.error.operationFailed")));

  const save = useMutation({
    mutationFn: async ({ device, state }: { device: Device | null; state: FormState }) => {
      const body = {
        name: state.name.trim(),
        note: state.note,
        upstreamIds: state.allUpstreams ? null : [...state.upstreamIds],
      };
      return device ? await tvboxApi.updateDevice(device.id, body) : await tvboxApi.createDevice(body);
    },
    onSuccess: (device, { device: before }) => {
      setForm(null);
      refresh();
      // A new device's next step is handing its URL to the box.
      if (!before)
        setShowUrl(device);
    },
    onError,
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => tvboxApi.updateDevice(id, { enabled }),
    onSuccess: refresh,
    onError,
  });
  const rotate = useMutation({
    mutationFn: (id: string) => tvboxApi.rotateDevice(id),
    onSuccess: (device) => {
      toast.success(t("devices:url.rotated"));
      setRotating(null);
      setShowUrl(device);
      refresh();
    },
    onError,
  });
  const loadPreview = useMutation({
    mutationFn: async (device: Device) => ({ name: device.name, config: await tvboxApi.preview(device.id) }),
    onSuccess: setPreview,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => tvboxApi.deleteDevice(id),
    onSuccess: () => {
      setDeleting(null);
      refresh();
    },
    onError,
  });

  const upstreamName = (id: string) => {
    const u = upstreams.data?.find(u => u.id === id);
    return u ? upstreamLabel(u, upstreams.data ?? []) : "—";
  };
  const openForm = (device: Device | null) => setForm({
    device,
    state: device
      ? { name: device.name, note: device.note, allUpstreams: device.allUpstreams, upstreamIds: new Set(device.upstreamIds) }
      : EMPTY_FORM,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("devices:page.title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("devices:page.description")}</p>
        </div>
        <Button size="sm" onClick={() => openForm(null)}>
          <Plus className="size-4" />
          {t("devices:add")}
        </Button>
      </div>

      <EnrollmentsSection devices={devices.data ?? []} upstreams={upstreams.data ?? []} />

      {devices.error && <ErrorBanner message={errorMessage(devices.error, t("common.error.loadFailed"))} />}
      {devices.isLoading && <CenteredHint>{t("common.loading")}</CenteredHint>}
      {devices.data?.length === 0 && <CenteredHint>{t("devices:empty")}</CenteredHint>}

      {devices.data && devices.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">{t("devices:enabled")}</TableHead>
              <TableHead>{t("devices:name")}</TableHead>
              <TableHead>{t("devices:content")}</TableHead>
              <TableHead>{t("devices:url.title")}</TableHead>
              <TableHead className="text-right">{t("devices:actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {devices.data.map(device => (
              <TableRow key={device.id} className={device.enabled ? undefined : "opacity-60"}>
                <TableCell>
                  <Switch checked={device.enabled} onCheckedChange={enabled => toggle.mutate({ id: device.id, enabled })} />
                </TableCell>
                <TableCell className="max-w-xs">
                  <div className="font-medium">{device.name}</div>
                  {device.note && <div className="truncate text-xs text-muted-foreground">{device.note}</div>}
                  {device.link && (
                    <div className="truncate text-xs text-muted-foreground" title={device.link.name}>
                      {t("devices:linked", {
                        app: [device.link.model, device.link.versionName && `v${device.link.versionName}`].filter(Boolean).join(" · "),
                        time: new Date(device.link.lastSeenAt).toLocaleString(),
                      })}
                    </div>
                  )}
                </TableCell>
                <TableCell className="space-x-1 text-xs">
                  {device.allUpstreams
                    ? <Badge>{t("devices:allUpstreams")}</Badge>
                    : device.upstreamIds.length === 0
                      ? <Badge variant="outline">{t("devices:commonOnly")}</Badge>
                      : device.upstreamIds.map(id => <Badge key={id} variant="secondary">{upstreamName(id)}</Badge>)}
                </TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => setShowUrl(device)}>
                    <Link2 className="size-4" />
                    <span className="font-mono text-xs">{`…${device.hint}`}</span>
                  </Button>
                </TableCell>
                <TableCell className="space-x-1 text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" title={t("devices:preview")} disabled={loadPreview.isPending} onClick={() => loadPreview.mutate(device)}><Eye className="size-4" /></Button>
                  <Button size="sm" variant="ghost" title={t("common.edit")} onClick={() => openForm(device)}><Pencil className="size-4" /></Button>
                  <Button size="sm" variant="ghost" title={t("common.delete")} onClick={() => setDeleting(device)}><Trash2 className="size-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <DeviceFormDialog
        form={form}
        upstreams={upstreams.data ?? []}
        pending={save.isPending}
        onChange={state => form && setForm({ ...form, state })}
        onClose={() => setForm(null)}
        onSave={() => form && save.mutate(form)}
      />

      <UrlDialog
        device={showUrl}
        pending={rotate.isPending}
        onClose={() => setShowUrl(null)}
        onRotate={() => showUrl && (showUrl.token ? setRotating(showUrl) : rotate.mutate(showUrl.id))}
      />

      <ConfirmDeleteDialog
        open={rotating !== null}
        onOpenChange={open => !open && setRotating(null)}
        title={t("devices:url.rotateTitle")}
        description={t("devices:url.rotateDescription", { name: rotating?.name ?? "" })}
        confirmLabel={t("devices:url.rotate")}
        pending={rotate.isPending}
        onConfirm={() => rotating && rotate.mutate(rotating.id)}
      />

      <JsonDialog
        open={preview !== null}
        onOpenChange={open => !open && setPreview(null)}
        title={t("devices:previewTitle", { name: preview?.name ?? "" })}
        value={preview?.config}
        extra={<p className="text-xs text-muted-foreground">{t("devices:previewHint")}</p>}
      />

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={open => !open && setDeleting(null)}
        title={t("devices:deleteTitle")}
        description={t("devices:deleteDescription", { name: deleting?.name ?? "" })}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}

function DeviceFormDialog({
  form,
  upstreams,
  pending,
  onChange,
  onClose,
  onSave,
}: {
  readonly form: { device: Device | null; state: FormState } | null;
  readonly upstreams: readonly Upstream[];
  readonly pending: boolean;
  readonly onChange: (state: FormState) => void;
  readonly onClose: () => void;
  readonly onSave: () => void;
}) {
  const { t } = useTranslation(["common", "devices"]);
  const state = form?.state ?? EMPTY_FORM;
  return (
    <Dialog open={form !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{form?.device ? t("devices:edit") : t("devices:add")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>{t("devices:name")}</Label>
            <Input value={state.name} onChange={e => onChange({ ...state, name: e.target.value })} placeholder={t("devices:namePlaceholder")} />
          </div>
          <div className="space-y-1">
            <Label>{t("devices:note")}</Label>
            <Textarea value={state.note} onChange={e => onChange({ ...state, note: e.target.value })} className="h-16" />
          </div>
          <UpstreamPicker value={state} upstreams={upstreams} onChange={choice => onChange({ ...state, ...choice })} />
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">{t("common.cancel")}</Button>} />
          <Button disabled={!state.name.trim() || pending} onClick={onSave}>{t("common.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UrlDialog({
  device,
  pending,
  onClose,
  onRotate,
}: {
  readonly device: Device | null;
  readonly pending: boolean;
  readonly onClose: () => void;
  readonly onRotate: () => void;
}) {
  const { t } = useTranslation(["common", "devices"]);
  // Keep showing the last device while the dialog animates closed.
  const [shown, setShown] = useState(device);
  if (device !== null && device !== shown)
    setShown(device);
  const current = device ?? shown;
  const url = current?.token ? subscriptionUrl(current.token) : null;
  const copy = () => {
    if (url)
      void navigator.clipboard.writeText(url).then(() => toast.success(t("devices:url.copied")));
  };

  return (
    <Dialog open={device !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("devices:url.dialogTitle", { name: current?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("devices:url.description")}</DialogDescription>
        </DialogHeader>
        {url
          ? (
              <div className="flex items-center gap-2">
                <Input readOnly value={url} className="font-mono text-xs" onFocus={e => e.target.select()} />
                <Button size="sm" variant="outline" onClick={copy}><Copy className="size-4" /></Button>
              </div>
            )
          : <p className="text-sm text-muted-foreground">{t("devices:url.unavailable")}</p>}
        <DialogFooter className="sm:justify-between">
          <Button variant="outline" disabled={pending} onClick={onRotate}>
            <RefreshCw className="size-4" />
            {t("devices:url.rotate")}
          </Button>
          <DialogClose render={<Button>{t("devices:url.close")}</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
