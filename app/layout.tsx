import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ember Echoes · 余烬回响",
  description: "原创回合制单场战斗 Demo：观察意图，管理能量，在幽暗遗迹中做出选择。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
