import type { Metadata, Viewport } from "next";
import "./globals.css";
import PwaManager from "@/components/PwaManager";

export const metadata: Metadata = {
  applicationName: "Catalyst",
  title: "Catalyst — Task & Bug Tracking",
  description:
    "Internal requirement traceability, QA bug tracking, and developer task management for Catalyst IT Solutions.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Catalyst",
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#217346",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <PwaManager />
      </body>
    </html>
  );
}
