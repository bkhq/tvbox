import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { CenteredHint } from "@/shared/components/ui/centered-hint";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { http } from "@/shared/lib/http";

interface SystemVersion {
  readonly version: string | null;
  readonly commit: string | null;
  readonly buildTime: string | null;
}

const versionQueryKey = ["system", "version"] as const;

async function fetchVersion(): Promise<SystemVersion> {
  return (await http<{ data: SystemVersion }>("/system/version")).data;
}

export function AboutSettingsTab() {
  const { t } = useTranslation("settings");
  const versionQuery = useQuery({ queryKey: versionQueryKey, queryFn: fetchVersion });

  const version = versionQuery.data;

  return (
    <div className="space-y-4 pt-4">
      {versionQuery.error && (
        <ErrorBanner message={versionQuery.error instanceof Error ? versionQuery.error.message : t("about.loadFailed")} />
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("about.title")}</CardTitle>
          <CardDescription>{t("about.description")}</CardDescription>
          <CardAction>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void versionQuery.refetch()}
              disabled={versionQuery.isFetching}
            >
              <RefreshCw className={versionQuery.isFetching ? "animate-spin" : undefined} />
              {t("about.refresh")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {versionQuery.isLoading
            ? <CenteredHint>{t("about.loading")}</CenteredHint>
            : (
                <div className="grid gap-3 sm:grid-cols-3">
                  <InfoField label={t("about.version")} value={version?.version} />
                  <InfoField label={t("about.commit")} value={version?.commit} mono />
                  <InfoField label={t("about.buildTime")} value={formatBuildTime(version?.buildTime)} />
                </div>
              )}
        </CardContent>
      </Card>
    </div>
  );
}

function InfoField({ label, value, mono = false }: { readonly label: string; readonly value: string | null | undefined; readonly mono?: boolean }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={mono ? "mt-1 break-all font-mono text-sm" : "mt-1 break-words text-sm font-medium"}>
        {safeText(value) ?? "—"}
      </div>
    </div>
  );
}

function safeText(value: string | null | undefined) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || null;
}

function formatBuildTime(value: string | null | undefined) {
  const text = safeText(value);
  if (!text)
    return null;
  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp))
    return text;
  return new Date(timestamp).toLocaleString();
}
