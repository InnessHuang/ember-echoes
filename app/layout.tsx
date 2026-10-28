import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ember Echoes · 余烬回响",
  description: "原创回合制战斗与数值策划作品集项目，目前处于设计规范与工程基础阶段。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
