import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/admin/devices")({
  staticData: { titleKey: "devices:page.title" },
});
