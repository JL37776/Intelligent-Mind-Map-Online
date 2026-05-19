const INDENT_WIDTH = 2

export const starterOutline = `# Intelligent AI Mind Map [!important]
> Summary: Raw text is the editable source for hierarchy, emphasis, summaries, links, tasks, and media notes.
## Input [!important]
> Summary: Paste rough notes, AI output, meeting notes, or an article excerpt here.
### Markdown hierarchy
- Use #, ##, ### for main structure
- Use nested - items for deeper branches
### Raw sync [!plain]
- Editing this text updates the mind map automatically
- Dragging or editing nodes writes the outline back here
## AI instructions [!important]
> Summary: AI should preserve this format and only output the outline.
### Emphasis markers
- Mark important nodes with [!important] [!important]
- Mark neutral nodes with [!plain] [!plain]
- Mark low-priority nodes with [!muted] [!muted]
### Summary markers
- Add a node summary on the next line
  > Summary: This sentence becomes the node summary
### Content markers
- [Link] https://example.com
- [ ] Follow-up task
- [Image] Screenshot or visual reference note
## Editing [!plain]
### Select a node and apply Important, Plain, or Muted
### Use Center to bring the map back into view
### Export PNG, Markdown, or JSON
## Low priority ideas [!muted]
> Summary: Keep nice-to-have branches visible without letting them dominate the map.
### Add shortcuts cheatsheet later
### Add more visual presets later`

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID()
  return `node-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function cleanText(line) {
  return line
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/^\s*#+\s*/, '')
    .replace(/\s+\[!(important|plain|muted)\]\s*$/i, '')
    .trim()
}

function lineEmphasis(line) {
  return line.match(/\[!(important|plain|muted)\]\s*$/i)?.[1]?.toLowerCase() || null
}

function lineSummary(line) {
  return line.match(/^\s*>\s*(?:summary|sumary):\s*(.+)$/i)?.[1]?.trim() || null
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
    const summary = lineSummary(raw)
    if (summary) {
      rows.push({ summary })
      continue
    }

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

    rows.push({ raw, level, text, emphasis: lineEmphasis(raw) })
  }

  const rootText = rows[0]?.level === 1 ? rows[0].text : 'Untitled Mind Map'
  const root = { id: 'root', topic: rootText, children: [] }
  const stack = [{ level: 1, node: root }]

  let lastNode = null
  for (const row of rows) {
    if (row.summary) {
      if (lastNode) {
        lastNode.metadata = { ...(lastNode.metadata || {}), summary: row.summary }
      }
      continue
    }

    if (row.level === 1 && row.text === rootText) {
      lastNode = root
      continue
    }

    const node = { id: newId(), topic: row.text, children: [] }
    if (row.emphasis) node.metadata = { emphasis: row.emphasis }
    while (stack.length > 1 && stack[stack.length - 1].level >= row.level) {
      stack.pop()
    }

    const parent = stack[stack.length - 1]?.node || root
    parent.children ||= []
    parent.children.push(node)
    lastNode = node
    stack.push({ level: row.level, node })
  }

  const rootRow = rows.find((row) => row.level === 1 && row.text === rootText)
  if (rootRow?.emphasis) root.metadata = { ...(root.metadata || {}), emphasis: rootRow.emphasis }

  return { nodeData: root }
}

export function mindDataToOutline(data) {
  const root = data?.nodeData || data
  if (!root) return ''

  const lines = []
  const walk = (node, depth) => {
    const topic = String(node.topic || '').trim() || 'Untitled'
    const emphasis = node.metadata?.emphasis ? ` [!${node.metadata.emphasis}]` : ''
    const summary = node.metadata?.summary || node.summary
    const summaryIndent = depth <= 3 ? '' : ' '.repeat((depth - 3) * INDENT_WIDTH)
    if (depth <= 3) {
      lines.push(`${'#'.repeat(depth)} ${topic}${emphasis}`)
    } else {
      lines.push(`${' '.repeat((depth - 4) * INDENT_WIDTH)}- ${topic}${emphasis}`)
    }
    if (summary) lines.push(`${summaryIndent}> Summary: ${summary}`)
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
