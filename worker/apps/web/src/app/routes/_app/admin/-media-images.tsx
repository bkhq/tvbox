import type { ImageKind, ImageOwner } from "./-media-api";
import { useQuery } from "@tanstack/react-query";
import { Star, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { mediaApi, mediaKeys } from "./-media-api";
import { useMediaMutation } from "./-media-hooks";
import { EnumSelect } from "./-media-shared";

/** An owner's images by kind: add by URL or upload, pick the primary one. */
export function ImagesPanel({ ownerType, ownerId, kinds }: { ownerType: ImageOwner; ownerId: number; kinds: readonly ImageKind[] }) {
  const { t } = useTranslation(["common", "media"]);
  const images = useQuery({ queryKey: mediaKeys.images(ownerType, ownerId), queryFn: () => mediaApi.images(ownerType, ownerId) });
  const [kind, setKind] = useState<ImageKind>(kinds[0]!);
  const [url, setUrl] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const owner = { ownerType, ownerId: String(ownerId) };

  const add = useMediaMutation(() => mediaApi.addImage({ ...owner, kind, url: url.trim() }), () => setUrl(""));
  const upload = useMediaMutation(async (f: File) => {
    const stored = await mediaApi.uploadImage(f);
    return mediaApi.addImage({ ...owner, kind, assetSha256: stored.sha256, assetName: stored.name });
  });
  const primary = useMediaMutation((id: string) => mediaApi.setPrimaryImage(id));
  const remove = useMediaMutation((id: string) => mediaApi.deleteImage(id));

  return (
    <div className="space-y-3 pt-2">
      {kinds.map((k) => {
        const list = images.data?.filter(i => i.kind === k) ?? [];
        return (
          <div key={k} className="space-y-1">
            <div className="text-sm font-medium">
              {t(`media:images.kinds.${k}`)}
              <span className="ml-2 text-xs font-normal text-muted-foreground">{t(`media:images.sizes.${k}`)}</span>
            </div>
            {list.length === 0 && <p className="text-xs text-muted-foreground">—</p>}
            <div className="flex flex-wrap gap-2">
              {list.map(img => (
                <div key={img.id} className="w-36 space-y-1 rounded-md border p-1 text-xs">
                  {img.url
                    ? <img src={img.url} alt="" className="h-24 w-full rounded object-cover" loading="lazy" />
                    : <div className="flex h-24 items-center justify-center rounded bg-muted break-all">{img.assetName}</div>}
                  <div className="flex items-center justify-between">
                    {img.isPrimary
                      ? <Badge>{t("media:images.primary")}</Badge>
                      : <Button size="sm" variant="ghost" title={t("media:images.makePrimary")} onClick={() => primary.mutate(img.id)}><Star className="size-4" /></Button>}
                    <Button size="sm" variant="ghost" onClick={() => remove.mutate(img.id)}><Trash2 className="size-4" /></Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <div className="flex items-center gap-2">
        <EnumSelect className="w-28" value={kind} values={kinds} label={v => t(`media:images.kinds.${v}`)} onChange={setKind} />
        <Input className="flex-1" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…/poster.jpg" />
        <Button size="sm" variant="outline" disabled={!url.trim() || add.isPending} onClick={() => add.mutate(undefined)}>{t("media:add")}</Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f)
              upload.mutate(f);
            e.target.value = "";
          }}
        />
        <Button size="sm" variant="outline" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
          <Upload className="size-4" />
          {t("media:images.upload")}
        </Button>
      </div>
    </div>
  );
}
