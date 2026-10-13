import type { Person } from "./-media-api";
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
import { Textarea } from "@/shared/components/ui/textarea";
import { mediaApi, mediaKeys, orNull } from "./-media-api";
import { errorText, useMediaMutation } from "./-media-hooks";
import { ImagesPanel } from "./-media-images";
import { EnumSelect, Field } from "./-media-shared";

const NONE = "none";
type Gender = NonNullable<Person["gender"]> | typeof NONE;

export function PeopleTab() {
  const { t } = useTranslation(["common", "media"]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const people = useQuery({ queryKey: mediaKeys.people(q, page), queryFn: () => mediaApi.people(q, page) });
  const [editing, setEditing] = useState<Person | "new" | null>(null);
  const [deleting, setDeleting] = useState<Person | null>(null);
  const remove = useMediaMutation((id: number) => mediaApi.deletePerson(id), () => setDeleting(null));
  const pages = Math.max(1, Math.ceil((people.data?.total ?? 0) / 20));

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center gap-2">
        <Input
          className="w-56"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder={t("media:people.search")}
        />
        <div className="flex-1" />
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="size-4" />
          {t("media:people.add")}
        </Button>
      </div>

      {people.error && <ErrorBanner message={errorText(people.error, t("common.error.loadFailed"))} />}
      {people.data?.items.length === 0 && <CenteredHint>{t("media:people.empty")}</CenteredHint>}
      {people.data && people.data.items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("media:people.name")}</TableHead>
              <TableHead>{t("media:people.originalName")}</TableHead>
              <TableHead>{t("media:people.birthday")}</TableHead>
              <TableHead className="text-right">{t("media:actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {people.data.items.map(p => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>{p.originalName}</TableCell>
                <TableCell>{p.birthday}</TableCell>
                <TableCell className="space-x-1 text-right">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(p)}><Pencil className="size-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(p)}><Trash2 className="size-4" /></Button>
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

      {editing !== null && <PersonDialog key={editing === "new" ? "new" : editing.id} person={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={open => !open && setDeleting(null)}
        title={t("media:people.deleteTitle")}
        description={t("media:people.deleteDescription", { name: deleting?.name ?? "" })}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}

function PersonDialog({ person, onClose }: { person: Person | null; onClose: () => void }) {
  const { t } = useTranslation(["common", "media"]);
  const [form, setForm] = useState({
    name: person?.name ?? "",
    originalName: person?.originalName ?? "",
    gender: (person?.gender ?? NONE) as Gender,
    birthday: person?.birthday ?? "",
    placeOfBirth: person?.placeOfBirth ?? "",
    biography: person?.biography ?? "",
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm(f => ({ ...f, [key]: value }));
  const save = useMediaMutation(() => {
    const body = {
      name: form.name.trim(),
      originalName: orNull(form.originalName),
      gender: form.gender === NONE ? null : form.gender,
      birthday: orNull(form.birthday),
      placeOfBirth: orNull(form.placeOfBirth),
      biography: orNull(form.biography),
    };
    return person ? mediaApi.updatePerson(person.id, body) : mediaApi.createPerson(body);
  }, onClose);

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{person ? person.name : t("media:people.add")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("media:people.name")}><Input value={form.name} onChange={e => set("name", e.target.value)} /></Field>
          <Field label={t("media:people.originalName")}><Input value={form.originalName} onChange={e => set("originalName", e.target.value)} /></Field>
          <Field label={t("media:people.gender")}>
            <EnumSelect value={form.gender} values={[NONE, "female", "male", "other"] as const} label={v => t(`media:people.genders.${v}`)} onChange={v => set("gender", v)} />
          </Field>
          <Field label={t("media:people.birthday")}><Input type="date" value={form.birthday} onChange={e => set("birthday", e.target.value)} /></Field>
          <Field label={t("media:people.placeOfBirth")} className="sm:col-span-2"><Input value={form.placeOfBirth} onChange={e => set("placeOfBirth", e.target.value)} /></Field>
          <Field label={t("media:people.biography")} className="sm:col-span-2"><Textarea rows={4} value={form.biography} onChange={e => set("biography", e.target.value)} /></Field>
        </div>
        {person && <ImagesPanel ownerType="person" ownerId={person.id} kinds={["profile"]} />}
        <DialogFooter>
          <DialogClose render={<Button variant="outline">{t("common.cancel")}</Button>} />
          <Button disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate(undefined)}>{t("media:save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
