import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Astrolabe",
  description:
    "Stablecoin FX agent: USDC ↔ EURC from any chain, settled on Arc with guarded execution.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
