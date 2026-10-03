import type { NavItem } from "@/shared/components/sidebar/types";
import { Tv } from "lucide-react";

export const tvboxNav: NavItem = {
  area: "admin",
  key: "tvbox",
  path: "/admin/tvbox",
  icon: Tv,
  order: 5,
};
