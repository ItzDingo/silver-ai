import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Silver Chat - AI Assistant",
  description: "A premium, calm AI chat interface powered by local and cloud models",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
