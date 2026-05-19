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
export interface PlanningNode { id: string; title: string; description?: string }
export interface Milestone extends PlanningNode { status: 'pending' | 'active' | 'done' }
export interface GraphLink { id: string; sourceId: string; targetId: string; label?: string }
export interface GapItem { area: string; description: string; severity: 'high' | 'medium' | 'low' }
export interface SuccessCriteria { id: string; text: string; done: boolean }
export interface EventNode { id: string; content: string; intent: string | null; type: string; source: string; ts: string; milestoneId: string | null }

type NodeType = 'milestone' | 'blocker' | 'next' | 'goal' | 'gap' | 'action' | 'decision' | 'problem' | 'idea' | 'event' | 'git' | 'voice' | 'notion' | 'cli' | 'execution' | 'brain' | 'artifact' | 'document' | 'wiki' | 'file'

interface NodeData extends Record<string, unknown> {
  label: string
  description?: string
  type: NodeType
  status?: 'pending' | 'active' | 'done'
  onDelete?: (id: string) => void
  onStatusCycle?: (id: string) => void
  onLabelChange?: (id: string, label: string) => void
  onDescriptionChange?: (id: string, description: string) => void
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
  decision:  { border: '#10b981', glow: '#10b981', bg: '#01100a',  text: '#6ee7b7', tag: 'decisão'   },
  problem:   { border: '#f43f5e', glow: '#f43f5e', bg: '#100108',  text: '#fda4af', tag: 'problema'  },
  idea:      { border: '#a78bfa', glow: '#a78bfa', bg: '#06020f',  text: '#ddd6fe', tag: 'ideia'     },
  event:     { border: '#71717a', glow: '#71717a', bg: '#0a0a0a',  text: '#a1a1aa', tag: 'evento'    },
  git:       { border: '#eab308', glow: '#eab308', bg: '#0a0800',  text: '#fde047', tag: 'git'       },
  voice:     { border: '#22d3ee', glow: '#22d3ee', bg: '#000d0f',  text: '#a5f3fc', tag: 'voz'       },
  notion:    { border: '#818cf8', glow: '#818cf8', bg: '#02020f',  text: '#c7d2fe', tag: 'notion'    },
  cli:       { border: '#4ade80', glow: '#4ade80', bg: '#010f03',  text: '#86efac', tag: 'hook'      },
  execution: { border: '#fb923c', glow: '#fb923c', bg: '#0f0400',  text: '#fdba74', tag: 'execução'  },
  brain:     { border: '#c084fc', glow: '#c084fc', bg: '#08020f',  text: '#e9d5ff', tag: 'brain'     },
  artifact:  { border: '#0ea5e9', glow: '#0ea5e9', bg: '#00060f',  text: '#7dd3fc', tag: 'checkpoint'},
  document:  { border: '#14b8a6', glow: '#14b8a6', bg: '#000f0d',  text: '#5eead4', tag: 'documento' },
  wiki:      { border: '#f472b6', glow: '#f472b6', bg: '#0f0008',  text: '#f9a8d4', tag: 'wiki'      },
  file:      { border: '#a3a3a3', glow: '#a3a3a3', bg: '#0a0a0a',  text: '#d4d4d4', tag: 'arquivo'   },
}

const STATUS_COLORS: Record<string, string> = {
  done:    '#22c55e',
  active:  '#3b82f6',
  pending: '#52525b',
}

const MONO_FONT = "'IBM Plex Mono', 'Consolas', 'Cascadia Code', monospace"

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
        fontFamily: MONO_FONT,
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

      {d.description && !editing && (
        <div style={{ fontSize: 10, color: '#71717a', lineHeight: 1.35, marginTop: 5, wordBreak: 'break-word' }}>
          {String(d.description)}
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

      {hovered && !editing && d.onDescriptionChange && (
        <button
          onClick={e => {
            e.stopPropagation()
            const next = window.prompt('Descrição do item', String(d.description ?? ''))
            if (next !== null) d.onDescriptionChange?.(id, next.trim())
          }}
          style={{ position: 'absolute', bottom: 4, right: 6, background: 'transparent', border: 'none', color: '#71717a', cursor: 'pointer', fontSize: 9, lineHeight: 1, padding: 0 }}
          title="Editar descrição"
        >desc</button>
      )}

      <Handle type="source" position={Position.Right}
        style={{ background: borderColor, width: 7, height: 7, border: 'none', boxShadow: `0 0 6px ${borderColor}` }} />
    </div>
  )
}

type AppNode = ProjectNode | Node
const nodeTypes = { project: ProjectNode }

/* ── layout helpers ─────────────────────────────────────── */
const COL = { goal: 40, milestone: 260, blocker: 500, next: 740 }
const ROW_H = 100

function uid() { return Math.random().toString(36).slice(2, 8) }
function stateNodeId(kind: 'goal' | 'milestone' | 'blocker' | 'next', id: string) { return `${kind}-${id}` }
function normalizePlanningNodes(items: Array<string | PlanningNode>, prefix: 'blocker' | 'next'): PlanningNode[] {
  return items.map((item, i) => typeof item === 'string' ? { id: `${prefix}-${i}-${uid()}`, title: item } : item)
}

/* ── Estado atual ───────────────────────────────────────── */
interface StateCanvasProps {
  milestones: Milestone[]
  blockers: Array<string | PlanningNode>
  nextSteps: Array<string | PlanningNode>
  graphLinks?: GraphLink[]
  goal?: { id: string; title: string } | null
  onSave?: (patch: { milestones: Milestone[]; blockers: PlanningNode[]; nextSteps: PlanningNode[]; graphLinks: GraphLink[] }) => void
}

export function StateCanvas({ milestones: initMilestones, blockers: initBlockers, nextSteps: initNextSteps, graphLinks: initGraphLinks = [], goal, onSave }: StateCanvasProps) {
  const [milestones, setMilestones] = useState<Milestone[]>(initMilestones)
  const [blockers, setBlockers] = useState<PlanningNode[]>(() => normalizePlanningNodes(initBlockers, 'blocker'))
  const [nextSteps, setNextSteps] = useState<PlanningNode[]>(() => normalizePlanningNodes(initNextSteps, 'next'))
  const [graphLinks, setGraphLinks] = useState<GraphLink[]>(initGraphLinks)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [addType, setAddType] = useState<NodeType | null>(null)
  const [addText, setAddText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const buildGraph = useCallback(() => {
    const nodes: Node[] = []
    const edges: Edge[] = []
    const activeIdx = milestones.findIndex(m => m.status === 'active')
    const activeMilestone = activeIdx >= 0 ? milestones[activeIdx] : milestones[0]

    const handleDelete = (id: string) => {
      if (!window.confirm('Excluir este item do grafo?')) return
      if (id.startsWith('milestone-')) setMilestones(p => p.filter(m => stateNodeId('milestone', m.id) !== id))
      else if (id.startsWith('blocker-')) setBlockers(p => p.filter(b => stateNodeId('blocker', b.id) !== id))
      else if (id.startsWith('next-')) setNextSteps(p => p.filter(s => stateNodeId('next', s.id) !== id))
      setGraphLinks(p => p.filter(l => l.sourceId !== id && l.targetId !== id))
      setDirty(true)
    }

    const handleStatusCycle = (id: string) => {
      if (!id.startsWith('milestone-')) return
      setMilestones(p => p.map(m => stateNodeId('milestone', m.id) === id ? { ...m, status: m.status === 'pending' ? 'active' : m.status === 'active' ? 'done' : 'pending' } : m))
      setDirty(true)
    }

    const handleLabelChange = (id: string, label: string) => {
      if (id.startsWith('milestone-')) setMilestones(p => p.map(m => stateNodeId('milestone', m.id) === id ? { ...m, title: label } : m))
      else if (id.startsWith('blocker-')) setBlockers(p => p.map(b => stateNodeId('blocker', b.id) === id ? { ...b, title: label } : b))
      else if (id.startsWith('next-')) setNextSteps(p => p.map(s => stateNodeId('next', s.id) === id ? { ...s, title: label } : s))
      setDirty(true)
    }

    const handleDescriptionChange = (id: string, description: string) => {
      if (id.startsWith('milestone-')) setMilestones(p => p.map(m => stateNodeId('milestone', m.id) === id ? { ...m, description } : m))
      else if (id.startsWith('blocker-')) setBlockers(p => p.map(b => stateNodeId('blocker', b.id) === id ? { ...b, description } : b))
      else if (id.startsWith('next-')) setNextSteps(p => p.map(s => stateNodeId('next', s.id) === id ? { ...s, description } : s))
      setDirty(true)
    }

    if (goal) {
      nodes.push({
        id: stateNodeId('goal', goal.id), type: 'project',
        position: { x: COL.goal, y: 40 },
        data: { label: goal.title, type: 'goal' },
      })
    }

    milestones.forEach((m, i) => {
      nodes.push({
        id: stateNodeId('milestone', m.id), type: 'project',
        position: { x: COL.milestone, y: i * ROW_H + 40 },
        data: { label: m.title, description: m.description, type: 'milestone', status: m.status, onDelete: handleDelete, onStatusCycle: handleStatusCycle, onLabelChange: handleLabelChange, onDescriptionChange: handleDescriptionChange },
      })
    })

    blockers.forEach((b, i) => {
      nodes.push({
        id: stateNodeId('blocker', b.id), type: 'project',
        position: { x: COL.blocker, y: i * ROW_H + 40 },
        data: { label: b.title, description: b.description, type: 'blocker', onDelete: handleDelete, onLabelChange: handleLabelChange, onDescriptionChange: handleDescriptionChange },
      })
    })

    nextSteps.forEach((s, i) => {
      nodes.push({
        id: stateNodeId('next', s.id), type: 'project',
        position: { x: COL.next, y: i * ROW_H + 40 },
        data: { label: s.title, description: s.description, type: 'next', onDelete: handleDelete, onLabelChange: handleLabelChange, onDescriptionChange: handleDescriptionChange },
      })
    })

    const nodeIds = new Set(nodes.map(n => n.id))
    const manualEdges = graphLinks.filter(l => nodeIds.has(l.sourceId) && nodeIds.has(l.targetId))
    if (manualEdges.length > 0) {
      manualEdges.forEach(l => edges.push({
        id: l.id, source: l.sourceId, target: l.targetId, label: l.label,
        animated: true, style: { stroke: '#06b6d4' }, labelStyle: { fill: '#67e8f9', fontSize: 9 }, labelBgStyle: { fill: '#00090f' },
      }))
    } else {
      if (goal) milestones.forEach(m => edges.push({ id: `auto-goal-${m.id}`, source: stateNodeId('goal', goal.id), target: stateNodeId('milestone', m.id), animated: true, style: { stroke: '#f59e0b80' } }))
      if (activeMilestone) {
        blockers.forEach(b => edges.push({ id: `auto-blocker-${b.id}`, source: stateNodeId('milestone', activeMilestone.id), target: stateNodeId('blocker', b.id), label: 'bloqueia', animated: true, style: { stroke: '#ef4444', strokeDasharray: '4 2' }, labelStyle: { fill: '#ef4444', fontSize: 9 }, labelBgStyle: { fill: '#0f0202' } }))
        nextSteps.forEach(s => edges.push({ id: `auto-next-${s.id}`, source: stateNodeId('milestone', activeMilestone.id), target: stateNodeId('next', s.id), animated: true, style: { stroke: '#8b5cf6' } }))
      }
    }

    if (nodes.length === 0) {
      nodes.push({ id: 'empty', type: 'project', position: { x: 180, y: 80 }, data: { label: 'Nenhum dado — clique em gerar estado ou adicione itens', type: 'milestone' } })
    }

    return { nodes, edges }
  }, [milestones, blockers, nextSteps, graphLinks, goal])

  const { nodes: initN, edges: initE } = buildGraph()
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>(initN as AppNode[])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initE)
  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return
    const link: GraphLink = { id: `link-${uid()}`, sourceId: c.source, targetId: c.target }
    setGraphLinks(p => [...p.filter(l => !(l.sourceId === link.sourceId && l.targetId === link.targetId)), link])
    setEdges(e => addEdge({ ...c, id: link.id, animated: true, style: { stroke: '#06b6d4' } }, e))
    setDirty(true)
  }, [setEdges])

  // rebuild when state changes — use ref to avoid render-phase setState
  const prevKey = useRef('')
  const nextKey = `${goal?.id ?? ''}-${milestones.length}-${blockers.length}-${nextSteps.length}-${graphLinks.length}-${milestones.map(m => m.id + m.status + m.title + (m.description ?? '')).join()}-${blockers.map(b => b.id + b.title + (b.description ?? '')).join()}-${nextSteps.map(s => s.id + s.title + (s.description ?? '')).join()}-${graphLinks.map(l => l.id + l.sourceId + l.targetId).join()}`
  if (prevKey.current !== nextKey) {
    prevKey.current = nextKey
    const { nodes: n, edges: e } = buildGraph()
    // schedule outside render cycle
    setTimeout(() => { setNodes(n as AppNode[]); setEdges(e) }, 0)
  }

  const addNode = () => {
    if (!addText.trim() || !addType) return
    if (addType === 'milestone') setMilestones(p => [...p, { id: uid(), title: addText.trim(), status: 'pending' }])
    else if (addType === 'blocker') setBlockers(p => [...p, { id: uid(), title: addText.trim() }])
    else if (addType === 'next') setNextSteps(p => [...p, { id: uid(), title: addText.trim() }])
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
        {selectedEdgeId && (
          <button onClick={() => {
            if (!window.confirm('Remover esta conexão?')) return
            setGraphLinks(p => p.filter(l => l.id !== selectedEdgeId))
            setEdges(e => e.filter(edge => edge.id !== selectedEdgeId))
            setSelectedEdgeId(null)
            setDirty(true)
          }} style={btnStyle('#ef4444')}>remover conexão</button>
        )}
        {dirty && onSave && (
          <button onClick={() => { onSave({ milestones, blockers, nextSteps, graphLinks }); setDirty(false) }} style={btnStyle('#22c55e')}>
            salvar
          </button>
        )}
      </div>

      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onConnect={onConnect} onEdgeClick={(_, edge) => setSelectedEdgeId(edge.id)} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.25 }}
        colorMode="dark" proOptions={{ hideAttribution: true }}
        style={{ background: '#050508', fontFamily: MONO_FONT }}
      >
        <Background color="#1c1c24" gap={24} size={1} />
        <Controls showInteractive={false} style={{ background: '#0f0f14', border: '1px solid #27272a', borderRadius: 8 }} />
        <MiniMap nodeColor={n => COLORS[(n.data as NodeData).type]?.border ?? '#52525b'} style={{ background: '#0f0f14', border: '1px solid #27272a' }} maskColor="#050508cc" />
      </ReactFlow>

      <div style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 10, fontSize: 9, color: '#52525b', letterSpacing: 0.5 }}>
        DUPLO CLIQUE para editar · HOVER desc/× · ARRASTE handles para conectar · CLIQUE edge para remover
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
      if (!window.confirm('Excluir este critério?')) return
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
        style={{ background: '#050508', fontFamily: MONO_FONT }}
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

/* ── Event Graph canvas ─────────────────────────────────── */
interface EventCanvasProps {
  milestones: Array<{ id: string; title: string; status: string }>
  events: EventNode[]
}

function resolveType(source: string, intent: string | null): NodeType {
  if (intent === 'decision') return 'decision'
  if (intent === 'problem')  return 'problem'
  if (intent === 'idea')     return 'idea'
  if (source === 'git')       return 'git'
  if (source === 'voice')     return 'voice'
  if (source === 'brain' || source === 'memory') return 'brain'
  if (source === 'cli')       return 'cli'
  if (source === 'execution') return 'execution'
  if (source === 'notion')    return 'notion'
  return 'event'
}

const LEGEND_TYPES: NodeType[] = ['decision', 'problem', 'idea', 'git', 'cli', 'brain', 'notion', 'voice', 'execution', 'event']

function fmtDate(ts: string) {
  return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

const SWIMLANE_COLS: { label: string; x: number; sources: string[]; intents: string[] }[] = [
  { label: 'Decisões / Ideias',  x: 60,   sources: [],                     intents: ['decision', 'idea', 'problem', 'reference'] },
  { label: 'Git',                x: 300,  sources: ['git'],                 intents: [] },
  { label: 'Hook / CLI',         x: 540,  sources: ['cli', 'manual'],       intents: [] },
  { label: 'Brain / Notion',     x: 780,  sources: ['brain', 'memory', 'notion'], intents: [] },
  { label: 'Voz / Execução',     x: 1020, sources: ['voice', 'execution'],  intents: [] },
  { label: 'Chat / Outros',      x: 1260, sources: ['chat'],                intents: [] },
]

function assignLane(ev: EventNode): number {
  if (ev.intent && ['decision','idea','problem','reference'].includes(ev.intent)) return 0
  for (let i = 1; i < SWIMLANE_COLS.length; i++) {
    if (SWIMLANE_COLS[i].sources.includes(ev.source)) return i
  }
  return SWIMLANE_COLS.length - 1
}

export function EventCanvas({ milestones, events }: EventCanvasProps) {
  const buildGraph = useCallback(() => {
    const nodes: Node[] = []
    const edges: Edge[] = []
    const EVENT_H = 100
    const MILESTONE_MIN_H = 110

    if (events.length === 0) {
      nodes.push({ id: 'empty', type: 'project', position: { x: 180, y: 80 },
        data: { label: 'Nenhum evento registrado ainda', type: 'event' as NodeType } })
      return { nodes, edges }
    }

    if (milestones.length === 0) {
      // Swim-lane layout by source group
      const lanes: EventNode[][] = SWIMLANE_COLS.map(() => [])
      events.forEach(ev => lanes[assignLane(ev)].push(ev))

      SWIMLANE_COLS.forEach((col, laneIdx) => {
        const laneEvents = lanes[laneIdx]
        if (laneEvents.length === 0) return

        // Column header node
        nodes.push({
          id: `LANE-${laneIdx}`,
          type: 'project',
          position: { x: col.x, y: -60 },
          data: { label: col.label, type: 'milestone' as NodeType },
        })

        laneEvents.forEach((ev, j) => {
          const nodeId = `EV-${ev.id}`
          nodes.push({
            id: nodeId, type: 'project',
            position: { x: col.x, y: j * EVENT_H },
            data: { label: `${ev.content.slice(0, 80)} · ${fmtDate(ev.ts)}`, type: resolveType(ev.source, ev.intent) },
          })
          if (j > 0) {
            edges.push({ id: `eTL-${laneIdx}-${j}`, source: `EV-${laneEvents[j - 1].id}`, target: nodeId,
              style: { stroke: '#27272a', strokeDasharray: '3 2' } })
          } else {
            edges.push({ id: `eLH-${laneIdx}`, source: `LANE-${laneIdx}`, target: nodeId,
              style: { stroke: '#27272a40', strokeDasharray: '2 3' } })
          }
        })
      })
      return { nodes, edges }
    }

    // Grouped by milestone
    let yOffset = 0
    milestones.forEach(m => {
      const mEvents = events.filter(e => e.milestoneId === m.id)
      const groupH = Math.max(MILESTONE_MIN_H, mEvents.length * EVENT_H)
      const mY = yOffset + groupH / 2 - 25
      nodes.push({ id: `M-${m.id}`, type: 'project',
        position: { x: 60, y: mY },
        data: { label: m.title.slice(0, 45), type: 'milestone' as NodeType, status: m.status as 'pending' | 'active' | 'done' } })
      mEvents.forEach((ev, j) => {
        const nodeType = resolveType(ev.source, ev.intent)
        nodes.push({ id: `EV-${ev.id}`, type: 'project',
          position: { x: 340, y: yOffset + j * EVENT_H + 10 },
          data: { label: `${ev.content.slice(0, 80)} · ${fmtDate(ev.ts)}`, type: nodeType } })
        edges.push({ id: `eMEV-${m.id}-${j}`, source: `M-${m.id}`, target: `EV-${ev.id}`,
          animated: true, style: { stroke: (COLORS[nodeType]?.border ?? '#3b82f6') + '60' } })
      })
      yOffset += groupH
    })

    // Unmapped events under "Geral"
    const unmapped = events.filter(e => !e.milestoneId)
    if (unmapped.length > 0) {
      const gY = yOffset + 30
      const groupH = Math.max(MILESTONE_MIN_H, unmapped.length * EVENT_H)
      nodes.push({ id: 'M-general', type: 'project',
        position: { x: 60, y: gY + groupH / 2 - 25 },
        data: { label: 'Geral', type: 'milestone' as NodeType } })
      unmapped.forEach((ev, j) => {
        const nodeType = resolveType(ev.source, ev.intent)
        nodes.push({ id: `EV-${ev.id}`, type: 'project',
          position: { x: 340, y: yOffset + 30 + j * EVENT_H + 10 },
          data: { label: `${ev.content.slice(0, 80)} · ${fmtDate(ev.ts)}`, type: nodeType } })
        edges.push({ id: `eGEV-${j}`, source: 'M-general', target: `EV-${ev.id}`,
          style: { stroke: '#27272a' } })
      })
    }

    return { nodes, edges }
  }, [milestones, events])

  const { nodes: initN, edges: initE } = buildGraph()
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>(initN as AppNode[])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initE)

  const prevKey = useRef('')
  const nextKey = `${milestones.length}-${events.length}-${events.map(e => e.id + e.milestoneId).join()}`
  if (prevKey.current !== nextKey) {
    prevKey.current = nextKey
    const { nodes: n, edges: e } = buildGraph()
    setTimeout(() => { setNodes(n as AppNode[]); setEdges(e) }, 0)
  }

  // Only show legend entries that exist in current events
  const activeSources = new Set(events.map(e => resolveType(e.source, e.intent)))
  const legendItems = LEGEND_TYPES.filter(t => activeSources.has(t))

  return (
    <div style={{ width: '100%', height: 480, position: 'relative' }}>
      {/* Legend */}
      {legendItems.length > 0 && (
        <div style={{
          position: 'absolute', top: 8, right: 8, zIndex: 10,
          background: '#09090b', border: '1px solid #27272a', borderRadius: 8,
          padding: '6px 10px', display: 'flex', flexWrap: 'wrap', gap: '6px 12px', maxWidth: 340,
        }}>
          {legendItems.map(t => (
            <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#a1a1aa', letterSpacing: 0.5 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[t].border, display: 'inline-block', boxShadow: `0 0 4px ${COLORS[t].border}` }} />
              {COLORS[t].tag}
            </span>
          ))}
        </div>
      )}

      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.2 }}
        colorMode="dark" proOptions={{ hideAttribution: true }}
        style={{ background: '#050508', fontFamily: MONO_FONT }}
      >
        <Background color="#1c1c24" gap={24} size={1} />
        <Controls showInteractive={false} style={{ background: '#0f0f14', border: '1px solid #27272a', borderRadius: 8 }} />
        <MiniMap nodeColor={n => COLORS[(n.data as NodeData).type]?.border ?? '#52525b'} style={{ background: '#0f0f14', border: '1px solid #27272a' }} maskColor="#050508cc" />
      </ReactFlow>
      <div style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 10, fontSize: 9, color: '#52525b', letterSpacing: 0.5 }}>
        {milestones.length === 0
          ? 'SWIM LANES por fonte · defina milestones na aba Estado para ver conexões'
          : 'EVENTOS conectados aos milestones · cores por fonte · ARRASTAR para mover'}
      </div>
    </div>
  )
}

/* ── Knowledge Graph canvas ─────────────────────────────── */
export interface KnowledgeNode { id: string; type: string; label: string; data: Record<string, unknown> }
export interface KnowledgeEdge { id: string; source: string; target: string; label: string }

interface KnowledgeCanvasProps {
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
}

const KG_COLS: Record<string, number> = { goal: 40, decision: 280, problem: 280, idea: 280, artifact: 540, document: 780, wiki: 1020, file: 660 }
const KG_ROW = 90

export function KnowledgeCanvas({ nodes: kNodes, edges: kEdges }: KnowledgeCanvasProps) {
  const buildGraph = useCallback(() => {
    const colCounters: Record<string, number> = {}
    const flowNodes: Node[] = kNodes.map(kn => {
      const t = (kn.type in COLORS ? kn.type : 'event') as NodeType
      const col = KG_COLS[kn.type] ?? 540
      const row = colCounters[kn.type] ?? 0
      colCounters[kn.type] = row + 1
      return {
        id: kn.id, type: 'project',
        position: { x: col, y: row * KG_ROW + 40 },
        data: {
          label: kn.label,
          type: t,
          description: kn.data?.['autoTriggered'] ? '⚡ automático' : undefined,
        },
      }
    })

    const nodeSet = new Set(flowNodes.map(n => n.id))
    const flowEdges: Edge[] = kEdges
      .filter(e => nodeSet.has(e.source) && nodeSet.has(e.target))
      .map(e => {
        const srcType = kNodes.find(n => n.id === e.source)?.type ?? 'event'
        const color = COLORS[(srcType in COLORS ? srcType : 'event') as NodeType]?.border ?? '#52525b'
        return {
          id: e.id, source: e.source, target: e.target,
          label: e.label,
          animated: srcType === 'goal' || srcType === 'artifact',
          style: { stroke: color + '80' },
          labelStyle: { fill: color, fontSize: 8 },
          labelBgStyle: { fill: '#050508' },
        }
      })

    if (flowNodes.length === 0) {
      flowNodes.push({ id: 'empty', type: 'project', position: { x: 200, y: 80 },
        data: { label: 'Nenhum dado ainda — registre decisões, checkpoints e documentos', type: 'event' as NodeType } })
    }

    return { nodes: flowNodes, edges: flowEdges }
  }, [kNodes, kEdges])

  const { nodes: initN, edges: initE } = buildGraph()
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>(initN as AppNode[])
  const [edges, , onEdgesChange] = useEdgesState<Edge>(initE)

  const prevKey = useRef('')
  const nextKey = `${kNodes.length}-${kEdges.length}`
  if (prevKey.current !== nextKey) {
    prevKey.current = nextKey
    const { nodes: n, edges: e } = buildGraph()
    setTimeout(() => { setNodes(n as AppNode[]); }, 0)
    void e
  }

  const knowledgeTypes: NodeType[] = ['goal', 'decision', 'problem', 'idea', 'artifact', 'document', 'wiki', 'file']
  const activeTypes = new Set(kNodes.map(n => n.type as NodeType))
  const legendItems = knowledgeTypes.filter(t => activeTypes.has(t))

  return (
    <div style={{ width: '100%', height: 420, position: 'relative' }}>
      {legendItems.length > 0 && (
        <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, background: '#09090b', border: '1px solid #27272a', borderRadius: 8, padding: '6px 10px', display: 'flex', flexWrap: 'wrap', gap: '6px 12px', maxWidth: 380 }}>
          {legendItems.map(t => (
            <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#a1a1aa', letterSpacing: 0.5 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[t].border, display: 'inline-block', boxShadow: `0 0 4px ${COLORS[t].border}` }} />
              {COLORS[t].tag}
            </span>
          ))}
        </div>
      )}
      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.2 }}
        colorMode="dark" proOptions={{ hideAttribution: true }}
        style={{ background: '#050508', fontFamily: MONO_FONT }}
      >
        <Background color="#1c1c24" gap={24} size={1} />
        <Controls showInteractive={false} style={{ background: '#0f0f14', border: '1px solid #27272a', borderRadius: 8 }} />
        <MiniMap nodeColor={n => COLORS[(n.data as NodeData).type]?.border ?? '#52525b'} style={{ background: '#0f0f14', border: '1px solid #27272a' }} maskColor="#050508cc" />
      </ReactFlow>
      <div style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 10, fontSize: 9, color: '#52525b', letterSpacing: 0.5 }}>
        KNOWLEDGE GRAPH · decisões ↔ checkpoints ↔ docs ↔ wiki ↔ arquivos ↔ meta · somente leitura
      </div>
    </div>
  )
}

/* ── default export (backwards compat) ─────────────────── */
export default function GraphCanvas(props:
  | { mode: 'estado'; milestones: Milestone[]; blockers: Array<string | PlanningNode>; nextSteps: Array<string | PlanningNode>; graphLinks?: GraphLink[]; goal?: { id: string; title: string } | null; onSave?: StateCanvasProps['onSave'] }
  | { mode: 'goal'; goalTitle: string; targetDate?: string; criteria: SuccessCriteria[]; gaps: GapItem[]; nextBestAction?: string; goalProgress?: number; goalId?: string; onToggleCriteria?: (criteriaId: string, done: boolean) => void; onSaveCriteria?: (criteria: SuccessCriteria[]) => void }
  | { mode: 'eventos'; milestones: Array<{ id: string; title: string; status: string }>; events: EventNode[] }
  | { mode: 'knowledge'; nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }
) {
  if (props.mode === 'estado') return <StateCanvas {...props} />
  if (props.mode === 'eventos') return <EventCanvas milestones={props.milestones} events={props.events} />
  if (props.mode === 'knowledge') return <KnowledgeCanvas nodes={props.nodes} edges={props.edges} />
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
