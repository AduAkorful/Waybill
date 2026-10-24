import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono, Noto_Sans_SC } from "next/font/google";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono" });
const notoSc = Noto_Sans_SC({ weight: ["400", "500", "700"], variable: "--font-noto-sc", preload: false });

export const metadata: Metadata = {
  title: "Waybill prototype",
  description: "Clickable prototype of Waybill with demo data. Not the product.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${plexMono.variable} ${notoSc.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
