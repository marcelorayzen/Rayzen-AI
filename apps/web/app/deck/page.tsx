'use client'

import Hls from 'hls.js'
import { motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Slide = {
  eyebrow: string
  title: string
  copy: string
  playbackId: string
  align: 'left' | 'center' | 'right'
}

const slides: Slide[] = [
  {
    eyebrow: 'Rayzen Commerce',
    title: 'Uma operação inteira em uma única experiência.',
    copy: 'Catálogo, CRM, estoque, caixa, delivery e restaurante funcionando como um sistema contínuo para pequenos negócios.',
    playbackId: process.env.NEXT_PUBLIC_MUX_PLAYBACK_ID_1 ?? 'DS00Spx1CV902MCtPj5WknGlR102V5HFkDe',
    align: 'left',
  },
  {
    eyebrow: 'Catálogo vivo',
    title: 'A vitrine pública já nasce pronta para vender.',
    copy: 'Produtos, categorias, preços e carrinho de orçamento com a identidade visual de cada cliente.',
    playbackId: process.env.NEXT_PUBLIC_MUX_PLAYBACK_ID_2 ?? 'j1p02zY1DKxO4L3mIh3BH3X2HoYH012oW00',
    align: 'right',
  },
  {
    eyebrow: 'Gestão comercial',
    title: 'CRM, clientes e follow-up no mesmo fluxo.',
    copy: 'O pipeline conecta atendimento, histórico e próxima ação para transformar conversas em vendas reais.',
    playbackId: process.env.NEXT_PUBLIC_MUX_PLAYBACK_ID_3 ?? 'fXNzVYXy3mJQ9pJZ3bA02JNzjPqha00pFQ',
    align: 'center',
  },
  {
    eyebrow: 'Operação presencial',
    title: 'PDV, caixa e estoque sem trocar de ferramenta.',
    copy: 'A operação de balcão conversa com o catálogo e mantém movimentações, vendas e conferência no lugar certo.',
    playbackId: process.env.NEXT_PUBLIC_MUX_PLAYBACK_ID_4 ?? 'VNwG1RZ3q3C2QdLI2zFA3Q02Hj7P6D2wV',
    align: 'left',
  },
  {
    eyebrow: 'Expansão modular',
    title: 'Ative novos módulos quando o negócio pedir.',
    copy: 'Delivery, rastreamento, NFC-e e restaurante entram sem recomeçar o projeto do zero.',
    playbackId: process.env.NEXT_PUBLIC_MUX_PLAYBACK_ID_5 ?? 'uQk018u7PZM01VbSA8k4xI3dwS01Q7iWVMf',
    align: 'right',
  },
]

function muxHlsUrl(playbackId: string) {
  return `https://stream.mux.com/${playbackId}.m3u8`
}

function HlsVideo({ playbackId, active }: { playbackId: string; active: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const src = muxHlsUrl(playbackId)
    let hls: Hls | null = null

    if (Hls.isSupported()) {
      hls = new Hls({
        autoStartLoad: true,
        startPosition: 0,
        capLevelToPlayerSize: true,
      })
      hls.loadSource(src)
      hls.attachMedia(video)
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src
    }

    video.load()

    return () => {
      hls?.destroy()
      video.removeAttribute('src')
      video.load()
    }
  }, [playbackId])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (active) {
      void video.play().catch(() => undefined)
    } else {
      video.pause()
    }
  }, [active])

  return (
    <video
      ref={videoRef}
      className="absolute inset-0 h-full w-full object-cover opacity-70"
      muted
      playsInline
      loop
      preload="auto"
      aria-hidden="true"
    />
  )
}

function SlideView({
  slide,
  index,
  active,
}: {
  slide: Slide
  index: number
  active: boolean
}) {
  const alignment = {
    left: 'items-start text-left',
    center: 'items-center text-center',
    right: 'items-end text-right',
  }[slide.align]

  const maxWidth = slide.align === 'center' ? 'max-w-4xl' : 'max-w-3xl'

  return (
    <motion.section
      className="absolute inset-0 bg-black"
      animate={{ opacity: active ? 1 : 0 }}
      initial={false}
      transition={{ duration: 0.35, ease: 'easeInOut' }}
      style={{
        zIndex: active ? 10 : 0,
        pointerEvents: active ? 'auto' : 'none',
      }}
    >
      <HlsVideo playbackId={slide.playbackId} active={active} />
      <div className="absolute inset-0 bg-black/45" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(255,255,255,0.16),transparent_38%),linear-gradient(180deg,rgba(0,0,0,0.15),#000)]" />

      <div className={`relative z-10 flex h-full flex-col justify-center px-8 py-16 md:px-16 lg:px-24 ${alignment}`}>
        <div className={maxWidth}>
          <p className="mb-5 text-xs font-semibold uppercase tracking-[0.28em] text-white/60">
            {String(index + 1).padStart(2, '0')} / 05&nbsp;&nbsp;{slide.eyebrow}
          </p>
          <h1 className="text-5xl font-semibold leading-[0.95] text-white md:text-7xl lg:text-8xl">
            {slide.title}
          </h1>
          <p className="mt-8 max-w-2xl text-base leading-7 text-white/72 md:text-xl md:leading-8">
            {slide.copy}
          </p>
        </div>
      </div>
    </motion.section>
  )
}

export default function DeckPage() {
  const [activeSlide, setActiveSlide] = useState(0)
  const lastIndex = slides.length - 1

  const goNext = useCallback(() => {
    setActiveSlide((current) => Math.min(current + 1, lastIndex))
  }, [lastIndex])

  const goPrev = useCallback(() => {
    setActiveSlide((current) => Math.max(current - 1, 0))
  }, [])

  const keys = useMemo(
    () => ({
      next: new Set(['ArrowRight', 'ArrowDown', ' ']),
      prev: new Set(['ArrowLeft', 'ArrowUp']),
    }),
    [],
  )

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (keys.next.has(event.key)) {
        event.preventDefault()
        goNext()
      }

      if (keys.prev.has(event.key)) {
        event.preventDefault()
        goPrev()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [goNext, goPrev, keys])

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black font-['Aeonik',sans-serif]">
      {slides.map((slide, index) => (
        <SlideView
          key={slide.title}
          slide={slide}
          index={index}
          active={activeSlide === index}
        />
      ))}

      <div className="fixed bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2">
        {slides.map((slide, index) => (
          <button
            key={slide.title}
            type="button"
            aria-label={`Ir para slide ${index + 1}`}
            aria-current={activeSlide === index}
            onClick={() => setActiveSlide(index)}
            className={`h-2 rounded-full transition-all duration-300 ${
              activeSlide === index ? 'w-6 bg-white' : 'w-2 bg-white/40'
            }`}
          />
        ))}
      </div>
    </main>
  )
}
