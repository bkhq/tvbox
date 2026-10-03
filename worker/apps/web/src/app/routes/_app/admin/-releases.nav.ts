import type { NavItem } from "@/shared/components/sidebar/types";
import { PackageOpen } from "lucide-react";

export const releasesNav: NavItem = {
  area: "admin",
  key: "releases",
  path: "/admin/releases",
  icon: PackageOpen,
  order: 6,
};
