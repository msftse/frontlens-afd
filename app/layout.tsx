import type { Metadata } from "next";
import { Suspense } from "react";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

import { Providers } from "@/components/providers";
import { Sidebar } from "@/components/app-shell";
import { FilterBar } from "@/components/filters/filter-bar";
import { UserMenu } from "@/components/auth/user-menu";
import { dataSourceName } from "@/lib/datasource";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "FrontLens: Azure Front Door Analytics",
  description:
    "A better analytics & log explorer for Azure Front Door: filter by country, visitor, and URL path, and see who used what.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} antialiased`}>
      <body className="min-h-dvh">
        <Providers>
          <div className="flex min-h-dvh">
            <Sidebar footer={<UserMenu />} dataSource={dataSourceName()} />
            <div className="flex min-w-0 flex-1 flex-col">
              <Suspense fallback={<div className="h-14 border-b border-line" />}>
                <FilterBar />
                <main className="flex-1 px-4 py-5 lg:px-6">{children}</main>
              </Suspense>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
