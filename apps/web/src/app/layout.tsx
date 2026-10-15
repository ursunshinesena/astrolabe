import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Astrolabe",
  description: "Cross-market execution agent — one intent, four chains, guarded execution.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
