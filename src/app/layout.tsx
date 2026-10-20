import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Agent World",
  description:
    "A living 3D office where six AI agents collaborate to ship software tasks. Local simulation, no live inference.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-ink-950 font-sans text-mist-100 antialiased">
        {children}
      </body>
    </html>
  );
}
