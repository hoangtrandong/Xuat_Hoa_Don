import type { Metadata } from "next";
import MobileShell from "@/components/mobile/MobileShell";

export const metadata: Metadata = {
  title: "DMS Sales Mobile - Bấm đơn bán hàng",
  description: "Ứng dụng bấm đơn hàng trên điện thoại cho nhân viên bán hàng",
};

export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MobileShell>{children}</MobileShell>;
}
