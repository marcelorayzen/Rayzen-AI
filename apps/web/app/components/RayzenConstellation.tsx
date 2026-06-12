'use client'

import { useEffect, useRef } from 'react'

const NODES = [
  { label: 'Brain',          color: '#3b82f6' },
  { label: 'Wiki',           color: '#60a5fa' },
  { label: 'Memory',         color: '#93c5fd' },
  { label: 'QA Engine',      color: '#3b82f6' },
  { label: 'Context Engine', color: '#93c5fd' },
  { label: 'V1 Bridge',      color: '#60a5fa' },
  { label: 'Hook',           color: '#3b82f6' },
  { label: 'Events',         color: '#60a5fa' },
  { label: 'Goal Graph',     color: '#f59e0b' },
  { label: 'Checkpoint',     color: '#3b82f6' },
  { label: 'Agent',          color: '#f59e0b' },
  { label: 'Data Quality',   color: '#3b82f6' },
  { label: 'Specialists',    color: '#60a5fa' },
  { label: 'Embeddings',     color: '#93c5fd' },
]

interface Node {
  x: number; y: number
  vx: number; vy: number
  label: string; color: string
  phase: number; phaseSpeed: number
}

// Occasional "data pulse" travelling along an edge
interface Pulse {
  fromIdx: number; toIdx: number
  t: number; speed: number
}

export function RayzenConstellation() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animId: number
    let nodes: Node[] = []
    let pulses: Pulse[] = []
    let lastPulseAt = 0

    function init() {
      canvas!.width  = window.innerWidth
      canvas!.height = window.innerHeight
      nodes = NODES.map((n) => ({
        ...n,
        x:          30 + Math.random() * (canvas!.width  - 60),
        y:          30 + Math.random() * (canvas!.height - 60),
        vx:         (Math.random() - 0.5) * 0.25,
        vy:         (Math.random() - 0.5) * 0.25,
        phase:      Math.random() * Math.PI * 2,
        phaseSpeed: 0.008 + Math.random() * 0.016,
      }))
    }

    function spawnPulse(now: number) {
      if (now - lastPulseAt < 800) return
      lastPulseAt = now
      const i = Math.floor(Math.random() * nodes.length)
      let j = Math.floor(Math.random() * nodes.length)
      if (j === i) j = (j + 1) % nodes.length
      pulses.push({ fromIdx: i, toIdx: j, t: 0, speed: 0.006 + Math.random() * 0.006 })
    }

    function draw(now: number) {
      const w = canvas!.width
      const h = canvas!.height
      ctx!.clearRect(0, 0, w, h)

      spawnPulse(now)

      // Edges
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x
          const dy = nodes[i].y - nodes[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 380) {
            const alpha = (1 - dist / 380) * 0.18
            ctx!.beginPath()
            ctx!.moveTo(nodes[i].x, nodes[i].y)
            ctx!.lineTo(nodes[j].x, nodes[j].y)
            ctx!.strokeStyle = `rgba(59,130,246,${alpha})`
            ctx!.lineWidth = 1.2
            ctx!.stroke()
          }
        }
      }

      // Data pulses along edges
      pulses = pulses.filter((p) => {
        p.t += p.speed
        if (p.t > 1) return false
        const a = nodes[p.fromIdx]
        const b = nodes[p.toIdx]
        const px = a.x + (b.x - a.x) * p.t
        const py = a.y + (b.y - a.y) * p.t
        const fade = Math.sin(p.t * Math.PI)
        ctx!.beginPath()
        ctx!.arc(px, py, 4, 0, Math.PI * 2)
        ctx!.fillStyle = `rgba(147,197,253,${0.9 * fade})`
        ctx!.shadowBlur = 12
        ctx!.shadowColor = 'rgba(59,130,246,0.9)'
        ctx!.fill()
        ctx!.shadowBlur = 0
        return true
      })

      // Nodes
      for (const n of nodes) {
        n.phase += n.phaseSpeed
        const glow = 0.5 + 0.5 * Math.sin(n.phase)

        const [r, g, b] = n.color === '#f59e0b'
          ? [245, 158, 11]
          : n.color === '#93c5fd'
            ? [147, 197, 253]
            : [59, 130, 246]

        // Outer halo
        const grad = ctx!.createRadialGradient(n.x, n.y, 0, n.x, n.y, 44)
        grad.addColorStop(0,   `rgba(${r},${g},${b},${0.22 * glow})`)
        grad.addColorStop(0.5, `rgba(${r},${g},${b},${0.08 * glow})`)
        grad.addColorStop(1,   'transparent')
        ctx!.beginPath()
        ctx!.arc(n.x, n.y, 44, 0, Math.PI * 2)
        ctx!.fillStyle = grad
        ctx!.fill()

        // Inner ring
        ctx!.beginPath()
        ctx!.arc(n.x, n.y, 10 + glow * 2, 0, Math.PI * 2)
        ctx!.strokeStyle = `rgba(${r},${g},${b},${0.25 + 0.2 * glow})`
        ctx!.lineWidth = 1
        ctx!.stroke()

        // Core dot
        ctx!.beginPath()
        ctx!.arc(n.x, n.y, 5 + glow * 1.5, 0, Math.PI * 2)
        ctx!.fillStyle = n.color
        ctx!.globalAlpha = 0.7 + 0.3 * glow
        ctx!.fill()
        ctx!.globalAlpha = 1

        // Label
        ctx!.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        ctx!.fillStyle = `rgba(200,220,255,${0.45 + 0.35 * glow})`
        ctx!.textAlign = 'center'
        ctx!.fillText(n.label, n.x, n.y + 24)

        // Drift + bounce
        n.x += n.vx
        n.y += n.vy
        if (n.x < 50 || n.x > w - 50) n.vx *= -1
        if (n.y < 50 || n.y > h - 50) n.vy *= -1
      }

      animId = requestAnimationFrame(draw)
    }

    init()
    animId = requestAnimationFrame(draw)

    const onResize = () => init()
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
        opacity: 0.75,
      }}
    />
  )
}
