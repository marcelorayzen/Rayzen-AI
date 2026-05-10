'use client'

import { useState, useCallback, useRef } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, addEdge,
  Handle, Position,
  type Node, type Edge, type Connection, type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

/* ── types ─────────────────────────────────────────────── */
export interface Milestone { id: string; title: string; status: 'pending' | 'active' | 'done' }
export interface GapItem { area: string; description: string; severity: 'high' | 'medium' | 'low' }
export interface SuccessCriteria { id: string; text: string; done: boolean }

type NodeType = 'milestone' | 'blocker' | 'next' | 'goal' | 'gap' | 'action'

interface NodeData extends Record<string, unknown> {
  label: string
  type: NodeType
  status?: 'pending' | 'active' | 'done'
  onDelete?: (id: string) => void
  onStatusCycle?: (id: string) => void
  onLabelChange?: (id: string, label: string) => void
  onToggle?: () => void
}

type ProjectNode = Node<NodeData, 'project'>

const COLORS: Record<NodeType, { border: string; glow: string; bg: string; text: string; tag: string }> = {
  milestone: { border: '#3b82f6', glow: '#3b82f6', bg: '#03060f',  text: '#93c5fd', tag: 'milestone' },
  blocker:   { border: '#ef4444', glow: '#ef4444', bg: '#0f0202',  text: '#fca5a5', tag: 'blocker'   },
  next:      { border: '#8b5cf6', glow: '#8b5cf6', bg: '#07020f',  text: '#c4b5fd', tag: 'próximo'   },
  goal:      { border: '#f59e0b', glow: '#f59e0b', bg: '#0f0800',  text: '#fcd34d', tag: 'meta'      },
  gap:       { border: '#f97316', glow: '#f97316', bg: '#0f0400',  text: '#fdba74', tag: 'gap'       },
  action:    { border: '#06b6d4', glow: '#06b6d4', bg: '#00090f',  text: '#67e8f9', tag: 'ação'      },
}

const STATUS_COLORS: Record<string, string> = {
  done:    '#22c55e',
  active:  '#3b82f6',
  pending: '#52525b',
}

/* ── custom node ────────────────────────────────────────── */
function ProjectNode({ data, id, selected }: NodeProps<ProjectNode>) {
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(data.label))
  const d = data
  const c = COLORS[d.type]
  const borderColor = d.status ? STATUS_COLORS[d.status] : c.border

  const commitEdit = () => {
    setEditing(false)
    if (draft.trim() && draft !== d.label) d.onLabelChange?.(id, draft.trim())
  }

  return (
    <div
      style={{
        background: c.bg,
        border: `1.5px solid ${selected ? '#fff' : borderColor}`,
        boxShadow: hovered || selected
          ? `0 0 14px ${borderColor}80, 0 0 32px ${borderColor}30, inset 0 0 12px ${c.bg}`
          : `0 0 6px ${borderColor}50`,
        borderRadius: 10,
        padding: '8px 12px',
        minWidth: 140,
        maxWidth: 200,
        position: 'relative',
        transition: 'box-shadow 0.2s, border-color 0.2s',
        cursor: d.onStatusCycle ? 'pointer' : 'default',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => { d.onStatusCycle?.(id); d.onToggle?.() }}
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); setDraft(String(d.label)) }}
    >
      <Handle type="target" position={Position.Left}
        style={{ background: borderColor, width: 7, height: 7, border: 'none', boxShadow: `0 0 6px ${borderColor}` }} />

      {/* type tag */}
      <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: 1.5, color: c.border, marginBottom: 4, textTransform: 'uppercase', opacity: 0.85 }}>
        {c.tag}
        {d.status && (
          <span style={{ marginLeft: 6, color: STATUS_COLORS[d.status], fontWeight: 900 }}>
            · {d.status}
          </span>
        )}
      </div>

      {/* label / edit */}
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false) }}
          onClick={e => e.stopPropagation()}
          style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: `1px solid ${c.border}`, color: c.text, fontSize: 12, outline: 'none', fontFamily: 'inherit' }}
        />
      ) : (
        <div style={{ fontSize: 12, color: c.text, lineHeight: 1.45, wordBreak: 'break-word' }}>
          {String(d.label)}
        </div>
      )}

      {/* delete btn */}
      {hovered && !editing && d.onDelete && (
        <button
          onClick={e => { e.stopPropagation(); d.onDelete!(id) }}
          style={{ position: 'absolute', top: 4, right: 6, background: 'transparent', border: 'none', color: '#71717a', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}
          title="Remover"
        >×</button>
      )}

      <Handle type="source" position={Position.Right}
        style={{ background: borderColor, width: 7, height: 7, border: 'none', boxShadow: `0 0 6px ${borderColor}` }} />
    </div>
  )
}

type AppNode = ProjectNode | Node
const nodeTypes = { project: ProjectNode }

/* ── layout helpers ─────────────────────────────────────── */
const COL = { blocker: 60, milestone: 300, next: 560 }
const ROW_H = 100

function uid() { return Math.random().toString(36).slice(2, 8) }

/* ── Estado atual ───────────────────────────────────────── */
interface StateCanvasProps {
  milestones: Milestone[]
  blockers: string[]
  nextSteps: string[]
  onSave?: (patch: { milestones: Milestone[]; blockers: string[]; nextSteps: string[] }) => void
}

export function StateCanvas({ milestones: initMilestones, blockers: initBlockers, nextSteps: initNextSteps, onSave }: StateCanvasProps) {
  const [milestones, setMilestones] = useState<Milestone[]>(initMilestones)
  const [blockers, setBlockers] = useState<string[]>(initBlockers)
  const [nextSteps, setNextSteps] = useState<string[]>(initNextSteps)
  const [dirty, setDirty] = useState(false)
  const [addType, setAddType] = useState<NodeType | null>(null)
  const [addText, setAddText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const buildGraph = useCallback(() => {
    const nodes: Node[] = []
    const edges: Edge[] = []
    const activeIdx = milestones.findIndex(m => m.status === 'active')

    const handleDelete = (id: string) => {
      const [type, idxStr] = id.split('-')
      const idx = Number(idxStr)
      if (type === 'M') setMilestones(p => p.filter((_, i) => i !== idx))
      else if (type === 'B') setBlockers(p => p.filter((_, i) => i !== idx))
      else if (type === 'NS') setNextSteps(p => p.filter((_, i) => i !== idx))
      setDirty(true)
    }

    const handleStatusCycle = (id: string) => {
      const [type, idxStr] = id.split('-')
      if (type !== 'M') return
      const idx = Number(idxStr)
      setMilestones(p => p.map((m, i) => i === idx ? { ...m, status: m.status === 'pending' ? 'active' : m.status === 'active' ? 'done' : 'pending' } : m))
      setDirty(true)
    }

    const handleLabelChange = (id: string, label: string) => {
      const [type, idxStr] = id.split('-')
      const idx = Number(idxStr)
      if (type === 'M') setMilestones(p => p.map((m, i) => i === idx ? { ...m, title: label } : m))
      else if (type === 'B') setBlockers(p => p.map((b, i) => i === idx ? label : b))
      else if (type === 'NS') setNextSteps(p => p.map((s, i) => i === idx ? label : s))
      setDirty(true)
    }

    milestones.forEach((m, i) => {
      nodes.push({
        id: `M-${i}`, type: 'project',
        position: { x: COL.milestone, y: i * ROW_H + 40 },
        data: { label: m.title, type: 'milestone', status: m.status, onDelete: handleDelete, onStatusCycle: handleStatusCycle, onLabelChange: handleLabelChange },
      })
    })

    blockers.forEach((b, i) => {
      nodes.push({
        id: `B-${i}`, type: 'project',
        position: { x: COL.blocker, y: i * ROW_H + 40 },
        data: { label: b, type: 'blocker', onDelete: handleDelete, onLabelChange: handleLabelChange },
      })
      if (activeIdx >= 0) edges.push({ id: `eB${i}`, source: `B-${i}`, target: `M-${activeIdx}`, label: 'bloqueia', animated: true, style: { stroke: '#ef4444', strokeDasharray: '4 2' }, labelStyle: { fill: '#ef4444', fontSize: 9 }, labelBgStyle: { fill: '#0f0202' } })
    })

    nextSteps.forEach((s, i) => {
      nodes.push({
        id: `NS-${i}`, type: 'project',
        position: { x: COL.next, y: i * ROW_H + 40 },
        data: { label: s, type: 'next', onDelete: handleDelete, onLabelChange: handleLabelChange },
      })
      if (activeIdx >= 0) edges.push({ id: `eNS${i}`, source: `M-${activeIdx}`, target: `NS-${i}`, animated: true, style: { stroke: '#8b5cf6' } })
    })

    if (nodes.length === 0) {
      nodes.push({ id: 'empty', type: 'project', position: { x: 180, y: 80 }, data: { label: 'Nenhum dado — clique em gerar estado ou adicione itens', type: 'milestone' } })
    }

    return { nodes, edges }
  }, [milestones, blockers, nextSteps])

  const { nodes: initN, edges: initE } = buildGraph()
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>(initN as AppNode[])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initE)
  const onConnect = useCallback((c: Connection) => setEdges(e => addEdge(c, e)), [setEdges])

  // rebuild when state changes — use ref to avoid render-phase setState
  const prevKey = useRef('')
  const nextKey = `${milestones.length}-${blockers.length}-${nextSteps.length}-${milestones.map(m => m.status + m.title).join()}`
  if (prevKey.current !== nextKey) {
    prevKey.current = nextKey
    const { nodes: n, edges: e } = buildGraph()
    // schedule outside render cycle
    setTimeout(() => { setNodes(n as AppNode[]); setEdges(e) }, 0)
  }

  const addNode = () => {
    if (!addText.trim() || !addType) return
    if (addType === 'milestone') setMilestones(p => [...p, { id: uid(), title: addText.trim(), status: 'pending' }])
    else if (addType === 'blocker') setBlockers(p => [...p, addText.trim()])
    else if (addType === 'next') setNextSteps(p => [...p, addText.trim()])
    setAddText('')
    setAddType(null)
    setDirty(true)
  }

  return (
    <div style={{ width: '100%', height: 380, position: 'relative' }}>
      {/* toolbar */}
      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
        {addType ? (
          <>
            <input ref={inputRef} autoFocus value={addText} onChange={e => setAddText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addNode(); if (e.key === 'Escape') setAddType(null) }}
              placeholder={`Novo ${COLORS[addType].tag}…`}
              style={{ background: '#18181b', border: `1px solid ${COLORS[addType].border}`, borderRadius: 6, padding: '4px 8px', fontSize: 11, color: '#e4e4e7', outline: 'none', width: 200 }}
            />
            <button onClick={addNode} style={btnStyle(COLORS[addType].border)}>+</button>
            <button onClick={() => setAddType(null)} style={btnStyle('#52525b')}>×</button>
          </>
        ) : (
          <>
            <button onClick={() => setAddType('milestone')} style={btnStyle('#3b82f6')}>+ milestone</button>
            <button onClick={() => setAddType('blocker')}   style={btnStyle('#ef4444')}>+ blocker</button>
            <button onClick={() => setAddType('next')}      style={btnStyle('#8b5cf6')}>+ próximo</button>
          </>
        )}
        {dirty && onSave && (
          <button onClick={() => { onSave({ milestones, blockers, nextSteps }); setDirty(false) }} style={btnStyle('#22c55e')}>
            salvar
          </button>
        )}
      </div>

      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onConnect={onConnect} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.25 }}
        colorMode="dark" proOptions={{ hideAttribution: true }}
        style={{ background: '#050508' }}
      >
        <Background color="#1c1c24" gap={24} size={1} />
        <Controls showInteractive={false} style={{ background: '#0f0f14', border: '1px solid #27272a', borderRadius: 8 }} />
        <MiniMap nodeColor={n => COLORS[(n.data as NodeData).type]?.border ?? '#52525b'} style={{ background: '#0f0f14', border: '1px solid #27272a' }} maskColor="#050508cc" />
      </ReactFlow>

      <div style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 10, fontSize: 9, color: '#52525b', letterSpacing: 0.5 }}>
        DUPLO CLIQUE para editar · CLIQUE em milestone para trocar status · ARRASTAR para mover
      </div>
    </div>
  )
}

/* ── Goal Graph canvas ──────────────────────────────────── */
interface GoalCanvasProps {
  goalTitle: string
  targetDate?: string
  criteria: SuccessCriteria[]
  gaps: GapItem[]
  nextBestAction?: string
  goalId?: string
  onToggleCriteria?: (criteriaId: string, done: boolean) => void
  onSaveCriteria?: (criteria: SuccessCriteria[]) => void
}

export function GoalCanvas({ goalTitle, targetDate, criteria: initCriteria, gaps, nextBestAction, onToggleCriteria, onSaveCriteria }: GoalCanvasProps) {
  const deadline = targetDate ? ` · ${new Date(targetDate).toLocaleDateString('pt-BR')}` : ''
  const [criteria, setCriteria] = useState<SuccessCriteria[]>(initCriteria)
  const [dirty, setDirty] = useState(false)
  const [addText, setAddText] = useState('')
  const [adding, setAdding] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const buildGraph = useCallback(() => {
    const nodes: Node[] = []
    const edges: Edge[] = []

    nodes.push({ id: 'G', type: 'project', position: { x: 220, y: 20 },
      data: { label: `${goalTitle.slice(0, 50)}${deadline}`, type: 'goal' } })

    const handleDelete = (id: string) => {
      const idx = parseInt(id.replace('C-', ''))
      setCriteria(p => p.filter((_, i) => i !== idx))
      setDirty(true)
    }
    const handleLabelChange = (id: string, label: string) => {
      const idx = parseInt(id.replace('C-', ''))
      setCriteria(p => p.map((c, i) => i === idx ? { ...c, text: label } : c))
      setDirty(true)
    }

    const perRow = Math.min(criteria.length, 4)
    const rowW = Math.max(perRow, 1) * 200
    criteria.slice(0, 8).forEach((c, i) => {
      const col = i % 4, row = Math.floor(i / 4)
      nodes.push({ id: `C-${i}`, type: 'project',
        position: { x: col * 200 + (500 - rowW) / 2, y: 140 + row * 100 },
        data: {
          label: c.text.slice(0, 50), type: 'milestone', status: c.done ? 'done' : 'pending',
          onToggle: onToggleCriteria ? () => onToggleCriteria(c.id, !c.done) : undefined,
          onDelete: onSaveCriteria ? handleDelete : undefined,
          onLabelChange: onSaveCriteria ? handleLabelChange : undefined,
        } })
      edges.push({ id: `eGC${i}`, source: 'G', target: `C-${i}`, animated: !c.done, style: { stroke: c.done ? '#22c55e' : '#3b82f650' } })
    })

    const high = gaps.filter(g => g.severity === 'high').slice(0, 3)
    const yBase = 140 + Math.ceil(criteria.length / 4) * 100 + 20
    high.forEach((g, i) => {
      nodes.push({ id: `GAP-${i}`, type: 'project', position: { x: i * 220 + 80, y: yBase },
        data: { label: g.description.slice(0, 50), type: 'gap' } })
      const undoneIdx = criteria.findIndex(c => !c.done)
      const src = undoneIdx >= 0 ? `C-${undoneIdx}` : 'G'
      edges.push({ id: `eGAP${i}`, source: src, target: `GAP-${i}`, animated: true, style: { stroke: '#ef4444' } })
    })

    if (nextBestAction) {
      nodes.push({ id: 'NBA', type: 'project', position: { x: 220, y: yBase + 110 },
        data: { label: nextBestAction.slice(0, 70), type: 'action' } })
      const src = high.length > 0 ? 'GAP-0' : (criteria.length > 0 ? `C-0` : 'G')
      edges.push({ id: 'eNBA', source: src, target: 'NBA', animated: true, style: { stroke: '#06b6d4' } })
    }

    return { nodes, edges }
  }, [criteria, goalTitle, deadline, gaps, nextBestAction, onToggleCriteria, onSaveCriteria])

  const { nodes: initN, edges: initE } = buildGraph()
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>(initN as AppNode[])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initE)
  const onConnect = useCallback((c: Connection) => setEdges(e => addEdge(c, e)), [setEdges])

  const prevKey = useRef('')
  const nextKey = `${criteria.length}-${criteria.map(c => c.text + c.done).join()}`
  if (prevKey.current !== nextKey) {
    prevKey.current = nextKey
    const { nodes: n, edges: e } = buildGraph()
    setTimeout(() => { setNodes(n as AppNode[]); setEdges(e) }, 0)
  }

  const addCriteria = () => {
    if (!addText.trim()) return
    setCriteria(p => [...p, { id: uid(), text: addText.trim(), done: false }])
    setAddText('')
    setAdding(false)
    setDirty(true)
  }

  return (
    <div style={{ width: '100%', height: 420, position: 'relative' }}>
      {/* toolbar */}
      {onSaveCriteria && (
        <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
          {adding ? (
            <>
              <input ref={inputRef} autoFocus value={addText} onChange={e => setAddText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addCriteria(); if (e.key === 'Escape') setAdding(false) }}
                placeholder="Novo critério…"
                style={{ background: '#18181b', border: `1px solid ${COLORS.milestone.border}`, borderRadius: 6, padding: '4px 8px', fontSize: 11, color: '#e4e4e7', outline: 'none', width: 200 }}
              />
              <button onClick={addCriteria} style={btnStyle(COLORS.milestone.border)}>+</button>
              <button onClick={() => setAdding(false)} style={btnStyle('#52525b')}>×</button>
            </>
          ) : (
            <button onClick={() => setAdding(true)} style={btnStyle(COLORS.milestone.border)}>+ critério</button>
          )}
          {dirty && (
            <button onClick={() => { onSaveCriteria(criteria); setDirty(false) }} style={btnStyle('#22c55e')}>salvar</button>
          )}
        </div>
      )}

      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onConnect={onConnect} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.2 }}
        colorMode="dark" proOptions={{ hideAttribution: true }}
        style={{ background: '#050508' }}
      >
        <Background color="#1c1c24" gap={24} size={1} />
        <Controls showInteractive={false} style={{ background: '#0f0f14', border: '1px solid #27272a', borderRadius: 8 }} />
        <MiniMap nodeColor={n => COLORS[(n.data as NodeData).type]?.border ?? '#52525b'} style={{ background: '#0f0f14', border: '1px solid #27272a' }} maskColor="#050508cc" />
      </ReactFlow>
      {onSaveCriteria && (
        <div style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 10, fontSize: 9, color: '#52525b', letterSpacing: 0.5 }}>
          DUPLO CLIQUE para renomear · CLIQUE para toggle done · ARRASTAR para mover
        </div>
      )}
    </div>
  )
}

/* ── default export (backwards compat) ─────────────────── */
export default function GraphCanvas(props: { mode: 'estado'; milestones: Milestone[]; blockers: string[]; nextSteps: string[]; onSave?: StateCanvasProps['onSave'] } | { mode: 'goal'; goalTitle: string; targetDate?: string; criteria: SuccessCriteria[]; gaps: GapItem[]; nextBestAction?: string; goalProgress?: number; goalId?: string; onToggleCriteria?: (criteriaId: string, done: boolean) => void; onSaveCriteria?: (criteria: SuccessCriteria[]) => void }) {
  if (props.mode === 'estado') return <StateCanvas {...props} />
  return <GoalCanvas {...props} />
}

/* ── util ───────────────────────────────────────────────── */
function btnStyle(color: string): React.CSSProperties {
  return {
    background: `${color}18`,
    border: `1px solid ${color}60`,
    borderRadius: 6,
    color,
    fontSize: 10,
    fontWeight: 700,
    padding: '3px 8px',
    cursor: 'pointer',
    letterSpacing: 0.5,
    transition: 'background 0.15s',
  }
}
