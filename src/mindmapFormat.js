const INDENT_WIDTH = 2

export const starterOutline = `# Intelligent AI Mind Map
## Input
### Paste notes from ChatGPT
### Supports Markdown headings and lists
## AI
### AI-boosted mind generation
### Refine the current map with a short instruction
### Simple format makes future AI edits easy
## Editing
### Enter creates a sibling node
### Tab and Shift+Tab change nesting
### Delete removes the selected node
### Drag, undo, and redo are supported
## Media
### Select a node and insert a screenshot
### Images are stored on the node image field`

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID()
  return `node-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function cleanText(line) {
  return line
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/^#+\s*/, '')
    .trim()
}

function headingLevel(rawLine) {
  const line = rawLine.replace(/\t/g, '  ')
  const heading = line.match(/^(#{1,6})\s+/)
  return heading ? heading[1].length : null
}

function listIndent(rawLine) {
  const line = rawLine.replace(/\t/g, '  ')
  const list = line.match(/^(\s*)([-*+]|\d+[.)])\s+/)
  return list ? Math.floor(list[1].length / INDENT_WIDTH) : null
}

export function outlineToMindData(outline) {
  let currentHeadingLevel = 1
  let listBaseLevel = 1
  const rows = []

  for (const raw of outline.split(/\r?\n/)) {
    const text = cleanText(raw)
    if (!text) continue

    const heading = headingLevel(raw)
    const indent = listIndent(raw)
    let level = null

    if (heading) {
      level = heading
      currentHeadingLevel = heading
      listBaseLevel = heading
    } else if (indent !== null) {
      level = listBaseLevel + indent + 1
    } else {
      level = currentHeadingLevel + 1
      listBaseLevel = currentHeadingLevel
    }

    rows.push({ raw, level, text })
  }

  const rootText = rows[0]?.level === 1 ? rows[0].text : 'Untitled Mind Map'
  const root = { id: 'root', topic: rootText, children: [] }
  const stack = [{ level: 1, node: root }]

  for (const row of rows) {
    if (row.level === 1 && row.text === rootText) continue

    const node = { id: newId(), topic: row.text, children: [] }
    while (stack.length > 1 && stack[stack.length - 1].level >= row.level) {
      stack.pop()
    }

    const parent = stack[stack.length - 1]?.node || root
    parent.children ||= []
    parent.children.push(node)
    stack.push({ level: row.level, node })
  }

  return { nodeData: root }
}

export function mindDataToOutline(data) {
  const root = data?.nodeData || data
  if (!root) return ''

  const lines = []
  const walk = (node, depth) => {
    const topic = String(node.topic || '').trim() || 'Untitled'
    if (depth <= 3) {
      lines.push(`${'#'.repeat(depth)} ${topic}`)
    } else {
      lines.push(`${' '.repeat((depth - 4) * INDENT_WIDTH)}- ${topic}`)
    }
    ;(node.children || []).forEach((child) => walk(child, depth + 1))
  }

  walk(root, 1)
  return lines.join('\n')
}

export function normalizeMindData(data) {
  const root = data?.nodeData || data
  return { nodeData: root || outlineToMindData(starterOutline).nodeData }
}

export function selectedNodeToOutline(node) {
  if (!node) return ''
  return mindDataToOutline({ nodeData: node })
}

export function stripImagesForAI(data) {
  const clone = structuredClone(data)
  const root = clone?.nodeData || clone

  const walk = (node) => {
    if (!node) return
    delete node.image
    ;(node.children || []).forEach(walk)
  }

  walk(root)
  return clone
}
