import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Pocket Base · Imagine it. Make it yours.",
  description: "A creative workshop for little games, big ideas, and worlds you can keep in your pocket.",
  robots: { index: false, follow: false },
  applicationName: "Pocket Base",
  appleWebApp: { capable: true, title: "Pocket Base", statusBarStyle: "default" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, interactiveWidget: "resizes-content", viewportFit: "cover", themeColor: "#faf8f2" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
