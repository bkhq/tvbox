import type { UpstreamChoice } from "./-devices-upstreams";
import type { Device, Enrollment, Upstream } from "./-tvbox-api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Trash2, Unlink, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { UpstreamPicker } from "./-devices-upstreams";
import { errorMessage, tvboxApi, tvboxKeys } from "./-tvbox-api";

function appLine(e: Pick<Enrollment, "model" | "versionName" | "mode" | "abi">): string {
  return [e.model, e.versionName && `v${e.versionName}`, e.mode && e.abi && `${e.mode}-${e.abi}`].filter(Boolean).join(" · ");
}

/** Link requests from TVBox apps: pending ones to answer, then the history. */
export function EnrollmentsSection({ devices, upstreams }: { readonly devices: readonly Device[]; readonly upstreams: readonly Upstream[] }) {
  const { t } = useTranslation(["common", "devices"]);
  const qc = useQueryClient();
  // Pending requests arrive while the page is open; the app polls every 15s.
  const query = useQuery({ queryKey: tvboxKeys.enrollments, queryFn: tvboxApi.enrollments, refetchInterval: 15_000 });
  const [approving, setApproving] = useState<Enrollment | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const refresh = () => void qc.invalidateQueries({ queryKey: ["tvbox"] });
  const onError = (err: unknown) => toast.error(errorMessage(err, t("common.error.operationFailed")));
  const reject = useMutation({ mutationFn: (id: string) => tvboxApi.rejectEnrollment(id), onSuccess: refresh, onError });
  const remove = useMutation({ mutationFn: (id: string) => tvboxApi.deleteEnrollment(id), onSuccess: refresh, onError });

  const rows = query.data ?? [];
  const pending = rows.filter(e => e.status === "pending");
  const history = rows.filter(e => e.status !== "pending");

  return (
    <div className="space-y-4">
      {pending.length > 0 && (
        <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-4">
          <h2 className="font-semibold">{t("devices:enroll.pendingTitle", { count: pending.length })}</h2>
          <p className="text-sm text-muted-foreground">{t("devices:enroll.pendingHint")}</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("devices:enroll.code")}</TableHead>
                <TableHead>{t("devices:enroll.app")}</TableHead>
                <TableHead>{t("devices:enroll.seen")}</TableHead>
                <TableHead className="text-right">{t("devices:actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.map(e => (
                <TableRow key={e.id}>
                  <TableCell className="font-mono text-lg font-semibold tracking-wider">{e.code}</TableCell>
                  <TableCell>
                    <div className="font-medium">{e.name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{appLine(e)}</div>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>{new Date(e.lastSeenAt).toLocaleString()}</div>
                    <div className="text-muted-foreground">{e.ip}</div>
                  </TableCell>
                  <TableCell className="space-x-1 text-right whitespace-nowrap">
                    <Button size="sm" onClick={() => setApproving(e)}>
                      <Check className="size-4" />
                      {t("devices:enroll.approve")}
                    </Button>
                    <Button size="sm" variant="outline" disabled={reject.isPending} onClick={() => reject.mutate(e.id)}>
                      <X className="size-4" />
                      {t("devices:enroll.reject")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {history.length > 0 && (
        <div>
          <Button size="sm" variant="ghost" onClick={() => setShowHistory(v => !v)}>
            {showHistory ? t("devices:enroll.hideHistory") : t("devices:enroll.showHistory", { count: history.length })}
          </Button>
          {showHistory && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("devices:enroll.code")}</TableHead>
                  <TableHead>{t("devices:enroll.app")}</TableHead>
                  <TableHead>{t("devices:enroll.state")}</TableHead>
                  <TableHead className="text-right">{t("devices:actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map(e => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-xs">{e.code}</TableCell>
                    <TableCell>
                      <div className="text-sm">{e.name || "—"}</div>
                      <div className="text-xs text-muted-foreground">{appLine(e)}</div>
                    </TableCell>
                    <TableCell className="space-x-1 text-xs">
                      <Badge variant={e.status === "approved" ? "default" : "outline"}>{t(`devices:enroll.status.${e.status}`)}</Badge>
                      {e.deviceName && <span>{e.deviceName}</span>}
                    </TableCell>
                    <TableCell className="space-x-1 text-right whitespace-nowrap">
                      {e.status === "approved" && (
                        <Button size="sm" variant="ghost" title={t("devices:enroll.revoke")} disabled={reject.isPending} onClick={() => reject.mutate(e.id)}>
                          <Unlink className="size-4" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" title={t("common.delete")} disabled={remove.isPending} onClick={() => remove.mutate(e.id)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      <ApproveDialog enrollment={approving} devices={devices} upstreams={upstreams} onClose={() => setApproving(null)} onDone={refresh} />
    </div>
  );
}

function ApproveDialog({
  enrollment,
  devices,
  upstreams,
  onClose,
  onDone,
}: {
  readonly enrollment: Enrollment | null;
  readonly devices: readonly Device[];
  readonly upstreams: readonly Upstream[];
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  return (
    <Dialog open={enrollment !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent>
        {/* Remounted per request so the form starts from its defaults. */}
        {enrollment && <ApproveForm key={enrollment.id} enrollment={enrollment} devices={devices} upstreams={upstreams} onClose={onClose} onDone={onDone} />}
      </DialogContent>
    </Dialog>
  );
}

function ApproveForm({
  enrollment,
  devices,
  upstreams,
  onClose,
  onDone,
}: {
  readonly enrollment: Enrollment;
  readonly devices: readonly Device[];
  readonly upstreams: readonly Upstream[];
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  const { t } = useTranslation(["common", "devices"]);
  const [target, setTarget] = useState<"new" | "existing">("new");
  const [name, setName] = useState(enrollment.name || enrollment.model || enrollment.code);
  const [choice, setChoice] = useState<UpstreamChoice>(() => ({ allUpstreams: true, upstreamIds: new Set() }));
  const [deviceId, setDeviceId] = useState<string | null>(devices[0]?.id ?? null);

  const approve = useMutation({
    mutationFn: () => tvboxApi.approveEnrollment(enrollment.id, target === "existing" && deviceId
      ? { deviceId }
      : { name: name.trim(), upstreamIds: choice.allUpstreams ? null : [...choice.upstreamIds] }),
    onSuccess: () => {
      toast.success(t("devices:enroll.approved"));
      onClose();
      onDone();
    },
    onError: (err: unknown) => toast.error(errorMessage(err, t("common.error.operationFailed"))),
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("devices:enroll.approveTitle", { code: enrollment.code })}</DialogTitle>
        <DialogDescription>{t("devices:enroll.approveHint")}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{[enrollment.name, appLine(enrollment)].filter(Boolean).join(" · ")}</p>
        <Tabs value={target} onValueChange={v => setTarget(v as "new" | "existing")}>
          <TabsList>
            <TabsTrigger value="new">{t("devices:enroll.newDevice")}</TabsTrigger>
            <TabsTrigger value="existing" disabled={devices.length === 0}>{t("devices:enroll.existingDevice")}</TabsTrigger>
          </TabsList>
        </Tabs>
        {target === "new"
          ? (
              <>
                <div className="space-y-1">
                  <Label>{t("devices:name")}</Label>
                  <Input value={name} onChange={e => setName(e.target.value)} />
                </div>
                <UpstreamPicker value={choice} upstreams={upstreams} onChange={setChoice} />
              </>
            )
          : (
              <Select value={deviceId} onValueChange={v => setDeviceId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(v: string | null) => devices.find(d => d.id === v)?.name ?? ""}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {devices.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
      </div>
      <DialogFooter>
        <DialogClose render={<Button variant="outline">{t("common.cancel")}</Button>} />
        <Button disabled={approve.isPending || (target === "new" ? !name.trim() : !deviceId)} onClick={() => approve.mutate()}>
          {t("devices:enroll.approve")}
        </Button>
      </DialogFooter>
    </>
  );
}
