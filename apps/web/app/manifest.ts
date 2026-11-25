import type { MetadataRoute } from 'next'

// Item 7.4 — o Hub instalável no celular: ícone na tela inicial, tela cheia, sem barra do
// navegador. É onde a aprovação de envelope com o código do autenticador acontece (13/11).
//
// Fora daqui, de propósito: service worker e notificação push. Instalar não exige SW no Chrome
// atual, e push precisa de chaves VAPID e de um caminho de envio — trabalho de outro tamanho.
// Os PNGs saem de `scripts/gerar-icones-pwa.mjs`; regenerar se o rayzen-icon.svg mudar.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Rayzen Hub',
    short_name: 'Rayzen',
    description: 'Plataforma pessoal de IA — Rayzen',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    lang: 'pt-BR',
    icons: [
      { src: '/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
