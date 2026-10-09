import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: { default: "Praxia", template: "%s · Praxia" },
  description: "Agenda por WhatsApp para tu negocio",
  applicationName: "Praxia",
  openGraph: { siteName: "Praxia", type: "website" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${montserrat.variable} h-full font-sans antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
