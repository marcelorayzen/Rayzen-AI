import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "./components/toast";

export const metadata: Metadata = {
  title: "Rayzen AI",
  description: "Plataforma pessoal de IA — Rayzen",
  icons: {
    icon: "/rayzen-icon.svg",
    // iOS não lê os ícones do manifest: sem este PNG a tela inicial ganha um print da página.
    apple: "/apple-touch-icon.png",
  },
  // iOS: abrir da tela inicial sem a barra do Safari (o equivalente do display: standalone).
  appleWebApp: {
    capable: true,
    title: "Rayzen",
    // "black" e não "black-translucent": translúcido põe a página POR BAIXO da barra de
    // status, e o header (com o botão "trabalhos") ficaria sob o relógio.
    statusBarStyle: "black",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- regra do Pages Router; no App Router o root layout aplica a fonte ao app inteiro */}
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,400;0,500;0,600;1,400&family=Orbitron:wght@400;600;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
