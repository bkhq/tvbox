import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/admin/tvbox")({
  staticData: { titleKey: "tvbox:page.title" },
});
