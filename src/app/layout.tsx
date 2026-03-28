import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OnCommand",
  description: "Real-time timing and cue execution for live theatre.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-slate-950 text-white flex flex-col">{children}</body>
    </html>
  );
}
