export const emphasisOptions = [
  { id: 'important', label: 'Important' },
  { id: 'plain', label: 'Plain' },
  { id: 'muted', label: 'Muted' },
]

export const skeletonPresets = {
  bright: {
    label: 'Bright',
    root: { background: '#334155', color: '#ffffff', fontSize: '30' },
    branch: { background: '#ffffff', color: '#1f2937', fontSize: '17' },
    leaf: { background: '#ffffff', color: '#4b5563', fontSize: '15' },
    important: { background: '#fff1f2', color: '#be123c', fontSize: '18' },
    plain: { background: '#ffffff', color: '#1f2937', fontSize: '16' },
    muted: { background: '#e5e7eb', color: '#9ca3af', fontSize: '13', opacity: '0.56' },
  },
  mono: {
    label: 'Mono',
    root: { background: '#0f172a', color: '#e0f2fe', fontSize: '30' },
    branch: { background: '#172554', color: '#bfdbfe', fontSize: '17' },
    leaf: { background: '#111827', color: '#dbeafe', fontSize: '15' },
    important: { background: '#f59e0b', color: '#111827', fontSize: '18' },
    plain: { background: '#1e293b', color: '#e0f2fe', fontSize: '16' },
    muted: { background: '#111827', color: '#64748b', fontSize: '13', opacity: '0.52' },
  },
  colorful: {
    label: 'Colorful',
    root: { background: '#1e1b4b', color: '#ffffff', fontSize: '30' },
    branch: { background: '#fff7ed', color: '#9a3412', fontSize: '17' },
    leaf: { background: '#f0fdfa', color: '#115e59', fontSize: '15' },
    important: { background: '#fef3c7', color: '#92400e', fontSize: '18' },
    plain: { background: '#eff6ff', color: '#1d4ed8', fontSize: '16' },
    muted: { background: '#f1f5f9', color: '#94a3b8', fontSize: '13', opacity: '0.56' },
  },
}

export const mindThemes = {
  bright: {
    name: 'Bright',
    palette: ['#ef4444', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#3b82f6'],
    cssVar: {
      '--main-color': '#ef4444',
      '--main-bgcolor': '#ffffff',
      '--color': '#334155',
      '--bgcolor': '#f6f8fb',
      '--selected': '#2563eb',
      '--root-color': '#ffffff',
      '--root-bgcolor': '#334155',
      '--root-border-color': '#334155',
      '--panel-color': '#1f2937',
      '--panel-bgcolor': '#ffffff',
      '--panel-border-color': '#d8dee7',
    },
  },
  mono: {
    name: 'Mono',
    type: 'dark',
    palette: ['#38bdf8', '#818cf8', '#c084fc', '#22d3ee', '#f59e0b', '#60a5fa'],
    cssVar: {
      '--main-color': '#38bdf8',
      '--main-bgcolor': '#0f172a',
      '--main-bgcolor-transparent': 'rgba(15, 23, 42, 0.78)',
      '--color': '#dbeafe',
      '--bgcolor': '#070b16',
      '--selected': '#f59e0b',
      '--root-color': '#e0f2fe',
      '--root-bgcolor': '#0f172a',
      '--root-border-color': '#38bdf8',
      '--panel-color': '#dbeafe',
      '--panel-bgcolor': '#111827',
      '--panel-border-color': '#334155',
    },
  },
  colorful: {
    name: 'Colorful',
    palette: ['#f97316', '#ec4899', '#8b5cf6', '#06b6d4', '#22c55e', '#eab308'],
    cssVar: {
      '--main-color': '#f97316',
      '--main-bgcolor': '#fff7ed',
      '--color': '#334155',
      '--bgcolor': '#fffaf3',
      '--selected': '#ec4899',
      '--root-color': '#ffffff',
      '--root-bgcolor': '#1e1b4b',
      '--root-border-color': '#1e1b4b',
      '--panel-color': '#312e81',
      '--panel-bgcolor': '#ffffff',
      '--panel-border-color': '#f0abfc',
    },
  },
}

export function getSkeletonPreset(id) {
  return skeletonPresets[id] || skeletonPresets.bright
}

export function getMindTheme(id) {
  return mindThemes[id] || mindThemes.bright
}

function cloneData(data) {
  return structuredClone(data)
}

function baseStyleForDepth(preset, depth) {
  if (depth === 1) return preset.root
  if (depth === 2) return preset.branch
  return preset.leaf
}

export function applySkeletonPreset(data, presetId) {
  const next = cloneData(data)
  const preset = getSkeletonPreset(presetId)
  next.theme = getMindTheme(presetId)

  const walk = (node, depth) => {
    const emphasis = node.metadata?.emphasis
    node.style = {
      ...baseStyleForDepth(preset, depth),
      ...(emphasis ? preset[emphasis] : {}),
      ...(node.styleOverride || {}),
    }
    ;(node.children || []).forEach((child) => walk(child, depth + 1))
  }

  if (next.nodeData) walk(next.nodeData, 1)
  return next
}

export function applyNodeEmphasis(data, nodeId, emphasis, presetId) {
  const next = cloneData(data)
  const preset = getSkeletonPreset(presetId)
  let didApply = false

  const walk = (node, depth) => {
    if (node.id === nodeId) {
      node.metadata = { ...(node.metadata || {}), emphasis }
      node.style = {
        ...baseStyleForDepth(preset, depth),
        ...preset[emphasis],
        ...(node.styleOverride || {}),
      }
      didApply = true
    }
    ;(node.children || []).forEach((child) => walk(child, depth + 1))
  }

  if (next.nodeData) walk(next.nodeData, 1)
  return { data: next, didApply }
}

export function collectNodeStylesByTopicPath(data) {
  const styles = new Map()

  const walk = (node, path) => {
    const nextPath = [...path, node.topic || 'Untitled']
    if (node.metadata?.emphasis || node.styleOverride) {
      styles.set(nextPath.join(' / '), {
        metadata: node.metadata,
        styleOverride: node.styleOverride,
      })
    }
    ;(node.children || []).forEach((child) => walk(child, nextPath))
  }

  if (data?.nodeData) walk(data.nodeData, [])
  return styles
}

export function restoreNodeStylesByTopicPath(data, styles) {
  const next = cloneData(data)

  const walk = (node, path) => {
    const nextPath = [...path, node.topic || 'Untitled']
    const existing = styles.get(nextPath.join(' / '))
    if (existing) {
      node.metadata = existing.metadata
      node.styleOverride = existing.styleOverride
    }
    ;(node.children || []).forEach((child) => walk(child, nextPath))
  }

  if (next.nodeData) walk(next.nodeData, [])
  return next
}
