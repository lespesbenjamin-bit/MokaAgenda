import type { Metadata } from "next";
import { getNavItem } from "@/config/navigation";
import { ComingSoon } from "@/components/modules/coming-soon";

const item = getNavItem("settings");

export const metadata: Metadata = { title: item.label };

export default function Page() {
  return <ComingSoon item={item} />;
}
