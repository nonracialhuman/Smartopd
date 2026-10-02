import type { Metadata, Viewport } from "next";
import "@fontsource-variable/atkinson-hyperlegible-next";
import "@fontsource-variable/doto/full.css";
import "./globals.css";
import { ToastProvider } from "@/components/toast";

export const metadata: Metadata = {
  title: "SmartOPD · City General Hospital",
  description: "Virtual OPD queue and live bed board. Demo hospital, demo data.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#e4ebe8" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
