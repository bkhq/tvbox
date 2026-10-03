/* eslint-disable react-refresh/only-export-components */
import { createLazyFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { EntriesTab } from "./-tvbox-entries";
import { GlobalsTab } from "./-tvbox-globals";
import { PublishesTab } from "./-tvbox-publishes";
import { UpstreamsTab } from "./-tvbox-upstreams";

export const Route = createLazyFileRoute("/_app/admin/tvbox")({
  component: TvboxPage,
});

function TvboxPage() {
  const { t } = useTranslation("tvbox");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("page.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("page.description")}</p>
      </div>

      <Tabs defaultValue="entries">
        <TabsList variant="line">
          <TabsTrigger value="entries">{t("tabs.entries")}</TabsTrigger>
          <TabsTrigger value="globals">{t("tabs.globals")}</TabsTrigger>
          <TabsTrigger value="upstreams">{t("tabs.upstreams")}</TabsTrigger>
          <TabsTrigger value="publishes">{t("tabs.publishes")}</TabsTrigger>
        </TabsList>
        <TabsContent value="entries"><EntriesTab /></TabsContent>
        <TabsContent value="globals"><GlobalsTab /></TabsContent>
        <TabsContent value="upstreams"><UpstreamsTab /></TabsContent>
        <TabsContent value="publishes"><PublishesTab /></TabsContent>
      </Tabs>
    </div>
  );
}
