import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Flow Detector",
  description: "Eye tracking for cognitive flow detection",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", backgroundColor: "#0a0a0a", color: "#fff" }}>
        {children}
      </body>
    </html>
  );
}
