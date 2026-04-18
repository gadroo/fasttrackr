import type { Metadata } from "next";
import "./globals.css";
import { Header } from "./header";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "FastTrackr",
  description: "Household financial data manager with spreadsheet and audio enrichment",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-dvh flex-col text-text-primary antialiased">
        <ThemeProvider>
          <Header />
          <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
