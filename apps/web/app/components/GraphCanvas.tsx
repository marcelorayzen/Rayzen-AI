'use client'

import { useCallback } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

interface Milestone { id: string; title: string; status: string }
interface GapItem { area: string; description: string; severity: 'high' | 'medium' | 'low' }
interface SuccessCriteria { id: string; text: string; done: boolean }

interface StateGraphProps {
  mode: 'estado'
  milestones: Milestone[]
  blockers: string[]
  nextSteps: string[]
}

interface GoalGraphProps {
  mode: 'goal'
  goalTitle: string
  targetDate?: string
  criteria: SuccessCriteria[]
  gaps: GapItem[]
  nextBestAction?: string
  goalProgress?: number
}

type GraphCanvasProps = StateGraphProps | GoalGraphProps

const NODE_STYLE_BASE: React.CSSProperties = {
  fontSize: 11,
  borderRadius: 8,
  padding: '6px 10px',
  border: '1px solid',
  maxWidth: 180,
  wordBreak: 'break-word',
  textAlign: 'center',
}

function buildStateGraph(props: StateGraphProps): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const { milestones, blockers, nextSteps } = props

  const colX = { blocker: 60, milestone: 280, next: 500 }
  const rowH = 90

  milestones.forEach((m, i) => {
    const isDone = m.status === 'done'
    const isActive = m.status === 'active'
    nodes.push({
      id: `M${i}`,
      position: { x: colX.milestone, y: i * rowH + 40 },
      data: { label: `${isDone ? '[done]' : isActive ? '[ativo]' : '[pendente]'} ${m.title.slice(0, 40)}` },
      style: {
        ...NODE_STYLE_BASE,
        background: isDone ? '#166534' : isActive ? '#1e40af' : '#27272a',
        borderColor: isDone ? '#22c55e' : isActive ? '#3b82f6' : '#52525b',
        color: '#f4f4f5',
      },
    })
  })

  const activeIdx = milestones.findIndex(m => m.status === 'active')

  blockers.slice(0, 4).forEach((b, i) => {
    const id = `B${i}`
    nodes.push({
      id,
      position: { x: colX.blocker, y: i * rowH + 40 },
      data: { label: `[blocker] ${b.slice(0, 40)}` },
      style: { ...NODE_STYLE_BASE, background: '#7f1d1d', borderColor: '#ef4444', color: '#fca5a5' },
    })
    if (activeIdx >= 0) {
      edges.push({ id: `e-B${i}-M${activeIdx}`, source: id, target: `M${activeIdx}`, label: 'bloqueia', style: { stroke: '#ef4444' }, labelStyle: { fill: '#ef4444', fontSize: 10 } })
    }
  })

  nextSteps.slice(0, 4).forEach((s, i) => {
    const id = `NS${i}`
    nodes.push({
      id,
      position: { x: colX.next, y: i * rowH + 40 },
      data: { label: `[prox] ${s.slice(0, 40)}` },
      style: { ...NODE_STYLE_BASE, background: '#3b0764', borderColor: '#8b5cf6', color: '#c4b5fd' },
    })
    if (activeIdx >= 0) {
      edges.push({ id: `e-M${activeIdx}-NS${i}`, source: `M${activeIdx}`, target: id, style: { stroke: '#8b5cf6' } })
    }
  })

  if (nodes.length === 0) {
    nodes.push({
      id: 'empty',
      position: { x: 160, y: 60 },
      data: { label: 'Estado vazio — clique em gerar estado' },
      style: { ...NODE_STYLE_BASE, background: '#27272a', borderColor: '#52525b', color: '#71717a' },
    })
  }

  return { nodes, edges }
}

function buildGoalGraph(props: GoalGraphProps): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const { goalTitle, targetDate, criteria, gaps, nextBestAction } = props

  const deadline = targetDate ? ` · ${new Date(targetDate).toLocaleDateString('pt-BR')}` : ''
  nodes.push({
    id: 'G',
    position: { x: 220, y: 20 },
    data: { label: `[meta] ${goalTitle.slice(0, 50)}${deadline}` },
    style: { ...NODE_STYLE_BASE, background: '#1e3a5f', borderColor: '#3b82f6', color: '#93c5fd', fontWeight: 600 },
  })

  criteria.slice(0, 6).forEach((c, i) => {
    const id = `C${i}`
    nodes.push({
      id,
      position: { x: i * 160 + 40, y: 130 },
      data: { label: `${c.done ? '[ok]' : '[ ]'} ${c.text.slice(0, 35)}` },
      style: { ...NODE_STYLE_BASE, background: c.done ? '#166534' : '#27272a', borderColor: c.done ? '#22c55e' : '#52525b', color: c.done ? '#86efac' : '#a1a1aa' },
    })
    edges.push({ id: `e-G-C${i}`, source: 'G', target: id, style: { stroke: '#3b82f6' } })
  })

  const highGaps = gaps.filter(g => g.severity === 'high').slice(0, 3)
  highGaps.forEach((g, i) => {
    const id = `GAP${i}`
    nodes.push({
      id,
      position: { x: i * 200 + 60, y: 260 },
      data: { label: `[gap] ${g.description.slice(0, 45)}` },
      style: { ...NODE_STYLE_BASE, background: '#7f1d1d', borderColor: '#ef4444', color: '#fca5a5' },
    })
    const undoneIdx = criteria.findIndex(c => !c.done)
    const src = undoneIdx >= 0 ? `C${undoneIdx}` : 'G'
    edges.push({ id: `e-${src}-${id}`, source: src, target: id, style: { stroke: '#ef4444' } })
  })

  if (nextBestAction) {
    nodes.push({
      id: 'NBA',
      position: { x: 200, y: 380 },
      data: { label: `[acao] ${nextBestAction.slice(0, 60)}` },
      style: { ...NODE_STYLE_BASE, background: '#1e3a5f', borderColor: '#60a5fa', color: '#bfdbfe', fontWeight: 600 },
    })
    const src = highGaps.length > 0 ? 'GAP0' : 'G'
    edges.push({ id: 'e-NBA', source: src, target: 'NBA', style: { stroke: '#60a5fa' } })
  }

  return { nodes, edges }
}

export default function GraphCanvas(props: GraphCanvasProps) {
  const { nodes: initNodes, edges: initEdges } =
    props.mode === 'estado' ? buildStateGraph(props) : buildGoalGraph(props)

  const [nodes, , onNodesChange] = useNodesState(initNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges)
  const onConnect = useCallback((c: Connection) => setEdges(e => addEdge(c, e)), [setEdges])

  return (
    <div style={{ width: '100%', height: 340 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#3f3f46" gap={20} />
        <Controls showInteractive={false} style={{ background: '#27272a', border: '1px solid #3f3f46' }} />
      </ReactFlow>
    </div>
  )
}
