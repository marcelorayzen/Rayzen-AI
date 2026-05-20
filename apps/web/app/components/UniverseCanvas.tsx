'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, addEdge,
  Handle, Position,
  type Node, type Edge, type Connection, type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

/* ── types ─────────────────────────────────────────────────── */
export interface UniverseNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: {
    label: string
    nodeType: string
    color?: string
    originalId?: string
    [key: string]: unknown
  }
}

export interface UniverseEdge {
  id: string
  source: string
  target: string
  label?: string
  animated?: boolean
  style?: Record<string, unknown>
}

/* ── colors por tipo ────────────────────────────────────────── */
const TYPE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  decision:  { bg: '#1e1b4b', border: '#6366f1', text: '#a5b4fc' },
  problem:   { bg: '#1f0e0e', border: '#ef4444', text: '#fca5a5' },
  idea:      { bg: '#1c1308', border: '#f59e0b', text: '#fcd34d' },
  artifact:  { bg: '#081a1f', border: '#06b6d4', text: '#67e8f9' },
  document:  { bg: '#071a12', border: '#10b981', text: '#6ee7b7' },
  wiki:      { bg: '#1f0a14', border: '#ec4899', text: '#f9a8d4' },
  goal:      { bg: '#1a1400', border: '#eab308', text: '#fde047' },
  file:      { bg: '#111111', border: '#6b7280', text: '#d1d5db' },
  note:      { bg: '#0f0f0f', border: '#a78bfa', text: '#ddd6fe' },
  custom:    { bg: '#0a0a0a', border: '#ffffff40', text: '#e5e7eb' },
  checkpoint:{ bg: '#081a1f', border: '#06b6d4', text: '#67e8f9' },
}

function getColors(nodeType: string) {
  return TYPE_COLORS[nodeType] ?? TYPE_COLORS.custom
}

/* ── node component ─────────────────────────────────────────── */
interface UniverseNodeData extends Record<string, unknown> {
  label: string
  nodeType: string
  color?: string
  editing?: boolean
  onDelete?: (id: string) => void
  onEdit?: (id: string, label: string) => void
  onTypeChange?: (id: string, type: string) => void
}

function UniverseNodeComponent({ id, data, selected }: NodeProps<Node<UniverseNodeData>>) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(data.label)
  const inputRef = useRef<HTMLInputElement>(null)
  const colors = getColors(data.nodeType)

  useEffect(() => { setDraft(data.label) }, [data.label])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  const commitEdit = () => {
    setEditing(false)
    if (draft.trim() && draft.trim() !== data.label) {
      data.onEdit?.(id, draft.trim())
    }
  }

  return (
    <div
      style={{
        background: colors.bg,
        border: `1.5px solid ${selected ? '#ffffff80' : colors.border}`,
        borderRadius: 8,
        padding: '8px 12px',
        minWidth: 140,
        maxWidth: 240,
        boxShadow: selected ? `0 0 0 2px ${colors.border}40` : `0 2px 8px #00000060`,
        position: 'relative',
        cursor: 'default',
      }}
      onDoubleClick={() => setEditing(true)}
    >
      <Handle type="target" position={Position.Left} style={{ background: colors.border, width: 8, height: 8 }} />

      {/* tipo badge */}
      <div style={{ fontSize: 9, color: colors.border, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4, fontWeight: 700 }}>
        {data.nodeType}
      </div>

      {/* label / input */}
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') { setEditing(false); setDraft(data.label) } }}
          style={{
            background: 'transparent', border: 'none', outline: 'none',
            color: colors.text, fontSize: 12, width: '100%', fontFamily: 'inherit',
          }}
        />
      ) : (
        <div style={{ fontSize: 12, color: colors.text, lineHeight: 1.4, wordBreak: 'break-word' }}>
          {data.label}
        </div>
      )}

      {/* delete button */}
      {selected && (
        <button
          onClick={() => data.onDelete?.(id)}
          style={{
            position: 'absolute', top: -8, right: -8,
            background: '#ef4444', border: 'none', borderRadius: '50%',
            width: 18, height: 18, cursor: 'pointer', color: '#fff', fontSize: 10, lineHeight: '18px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >×</button>
      )}

      <Handle type="source" position={Position.Right} style={{ background: colors.border, width: 8, height: 8 }} />
    </div>
  )
}

const nodeTypes = { universe: UniverseNodeComponent }

/* ── node types available ───────────────────────────────────── */
const NODE_TYPES = ['note', 'idea', 'decision', 'problem', 'goal', 'document', 'wiki', 'artifact', 'custom'] as const
type NewNodeType = typeof NODE_TYPES[number]

function uid() { return Math.random().toString(36).slice(2, 10) }

/* ── main component ─────────────────────────────────────────── */
interface Props {
  projectId: string
  initialNodes: UniverseNode[]
  initialEdges: UniverseEdge[]
  onSave: (nodes: UniverseNode[], edges: UniverseEdge[]) => Promise<void>
  onImport: () => Promise<void>
  saving?: boolean
  importing?: boolean
}

export function UniverseCanvas({ projectId: _projectId, initialNodes, initialEdges, onSave, onImport, saving, importing }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<UniverseNodeData>>(
    initialNodes.map(n => ({
      ...n,
      type: 'universe',
      data: { ...n.data, nodeType: n.data.nodeType ?? 'custom' },
    }))
  )
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    initialEdges.map(e => ({
      ...e,
      animated: e.animated ?? true,
      style: e.style ?? { stroke: '#ffffff20' },
    }))
  )
  const [dirty, setDirty] = useState(false)
  const [addType, setAddType] = useState<NewNodeType>('note')
  const [addLabel, setAddLabel] = useState('')
  const [adding, setAdding] = useState(false)

  // sync when initialNodes/Edges change (after import or load)
  useEffect(() => {
    setNodes(initialNodes.map(n => ({
      ...n,
      type: 'universe',
      data: {
        ...n.data,
        nodeType: n.data.nodeType ?? 'custom',
        onDelete: handleDelete,
        onEdit: handleEdit,
      },
    })))
    setEdges(initialEdges.map(e => ({
      ...e,
      animated: e.animated ?? true,
      style: e.style ?? { stroke: '#ffffff20' },
    })))
    setDirty(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNodes, initialEdges])

  const handleDelete = useCallback((id: string) => {
    setNodes(ns => ns.filter(n => n.id !== id))
    setEdges(es => es.filter(e => e.source !== id && e.target !== id))
    setDirty(true)
  }, [setNodes, setEdges])

  const handleEdit = useCallback((id: string, label: string) => {
    setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, label } } : n))
    setDirty(true)
  }, [setNodes])

  // inject callbacks into all nodes whenever they change
  useEffect(() => {
    setNodes(ns => ns.map(n => ({
      ...n,
      data: { ...n.data, onDelete: handleDelete, onEdit: handleEdit },
    })))
  }, [handleDelete, handleEdit, setNodes])

  const onConnect = useCallback((c: Connection) => {
    setEdges(es => addEdge({
      ...c,
      id: `e-${uid()}`,
      animated: true,
      style: { stroke: '#ffffff30' },
    }, es))
    setDirty(true)
  }, [setEdges])

  const addNode = () => {
    if (!addLabel.trim()) return
    const colors = getColors(addType)
    const newNode: Node<UniverseNodeData> = {
      id: `u-${uid()}`,
      type: 'universe',
      position: { x: Math.random() * 400 + 100, y: Math.random() * 300 + 60 },
      data: {
        label: addLabel.trim(),
        nodeType: addType,
        color: colors.border,
        onDelete: handleDelete,
        onEdit: handleEdit,
      },
    }
    setNodes(ns => [...ns, newNode])
    setAddLabel('')
    setAdding(false)
    setDirty(true)
  }

  const handleSave = async () => {
    const rawNodes: UniverseNode[] = nodes.map(n => ({
      id: n.id,
      type: 'universe',
      position: n.position,
      data: {
        label: n.data.label,
        nodeType: n.data.nodeType,
        color: n.data.color,
        originalId: n.data.originalId,
      },
    }))
    const rawEdges: UniverseEdge[] = edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: typeof e.label === 'string' ? e.label : undefined,
      animated: e.animated ?? true,
    }))
    await onSave(rawNodes, rawEdges)
    setDirty(false)
  }

  return (
    <div style={{ width: '100%', height: 520, position: 'relative', background: '#050a0f', borderRadius: 8, overflow: 'hidden' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={(changes) => { onNodesChange(changes); setDirty(true) }}
        onEdgesChange={(changes) => { onEdgesChange(changes); setDirty(true) }}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        deleteKeyCode="Delete"
        style={{ background: 'transparent' }}
      >
        <Background color="#ffffff08" gap={24} />
        <Controls style={{ background: '#0a0f14', border: '1px solid #1e293b', borderRadius: 6 }} />
        <MiniMap
          style={{ background: '#050a0f', border: '1px solid #1e293b' }}
          nodeColor={n => getColors((n.data as UniverseNodeData).nodeType).border}
          maskColor="#00000080"
        />
      </ReactFlow>

      {/* toolbar */}
      <div style={{
        position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: 6, alignItems: 'center', zIndex: 20,
        background: '#0a0f14cc', border: '1px solid #1e293b', borderRadius: 8, padding: '6px 10px',
        backdropFilter: 'blur(8px)',
      }}>
        {adding ? (
          <>
            <select
              value={addType}
              onChange={e => setAddType(e.target.value as NewNodeType)}
              style={{ background: '#0f1923', border: '1px solid #1e293b', color: '#94a3b8', borderRadius: 4, padding: '3px 6px', fontSize: 11 }}
            >
              {NODE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input
              autoFocus
              value={addLabel}
              onChange={e => setAddLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addNode(); if (e.key === 'Escape') setAdding(false) }}
              placeholder="Nome do nó..."
              style={{ background: '#0f1923', border: '1px solid #1e293b', color: '#e2e8f0', borderRadius: 4, padding: '3px 8px', fontSize: 11, width: 160 }}
            />
            <button onClick={addNode} style={{ background: '#1d4ed8', border: 'none', color: '#fff', borderRadius: 4, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}>ok</button>
            <button onClick={() => setAdding(false)} style={{ background: 'transparent', border: '1px solid #374151', color: '#6b7280', borderRadius: 4, padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}>✕</button>
          </>
        ) : (
          <>
            <button
              onClick={() => setAdding(true)}
              style={{ background: '#1d4ed8', border: 'none', color: '#fff', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
            >+ nó</button>

            <button
              onClick={onImport}
              disabled={importing}
              style={{ background: 'transparent', border: '1px solid #334155', color: '#94a3b8', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}
              title="Importar dados do projeto como ponto de partida"
            >{importing ? '⟳ importando…' : '⬇ importar projeto'}</button>

            {dirty && (
              <button
                onClick={handleSave}
                disabled={saving}
                style={{ background: '#065f46', border: 'none', color: '#6ee7b7', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
              >{saving ? '⟳ salvando…' : '✓ salvar'}</button>
            )}

            {!dirty && nodes.length > 0 && (
              <span style={{ fontSize: 10, color: '#374151' }}>salvo</span>
            )}
          </>
        )}
      </div>

      {/* empty state */}
      {nodes.length === 0 && !importing && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 12, pointerEvents: 'none',
        }}>
          <div style={{ fontSize: 13, color: '#475569', textAlign: 'center' }}>
            Canvas vazio — comece importando dados do projeto<br />
            <span style={{ fontSize: 11, color: '#1e293b' }}>ou clique em "+ nó" para criar manualmente</span>
          </div>
        </div>
      )}
    </div>
  )
}
