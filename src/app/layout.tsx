import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Relay · Incident Agent",
  description:
    "AI production incident response over a simulated checkout service",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      <body className="flex min-h-full flex-col overflow-x-hidden md:flex-row">
        <Sidebar />
        <main className="min-h-screen min-w-0 flex-1 px-4 py-5 md:px-8 md:py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
