import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Catalyst — Task & Bug Tracking",
  description:
    "Internal requirement traceability, QA bug tracking, and developer task management for Catalyst IT Solutions.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
