import Dexie from 'dexie'

export const db = new Dexie('intelligent-ai-mind-map')
const activeProjectKey = 'intelligent-ai-mind-map-active-project'
const promptPresetsKey = 'intelligent-ai-mind-map-prompt-presets'
const defaultPromptPresetKey = 'intelligent-ai-mind-map-default-prompt-preset'

export const defaultPromptPresets = [
  {
    id: 'explain-node',
    name: 'Explain',
    prompt: 'Explain this node by adding 2-4 concise child nodes that clarify meaning, background, or why it matters. Keep the selected node title unchanged.',
  },
  {
    id: 'expand-node',
    name: 'Expand',
    prompt: 'Expand this node with 3-5 useful child nodes. Keep the selected node title unchanged. Keep labels short and concrete.',
  },
  {
    id: 'simplify-node',
    name: 'Simplify',
    prompt: 'Simplify this branch. Merge repeated points and keep only the essential structure.',
  },
  {
    id: 'actionize-node',
    name: 'Actionize',
    prompt: 'Turn this branch into actionable steps with clear, practical child nodes.',
  },
]

db.version(1).stores({
  maps: 'id, title, updatedAt',
})

export async function saveMap(record) {
  const now = new Date().toISOString()
  const existing = record.id ? await db.maps.get(record.id) : null
  await db.maps.put({
    ...record,
    updatedAt: now,
    createdAt: record.createdAt || existing?.createdAt || now,
  })
  localStorage.setItem(activeProjectKey, record.id)
}

export async function listMaps() {
  return db.maps.orderBy('updatedAt').reverse().toArray()
}

export async function loadMap(id) {
  return db.maps.get(id)
}

export async function deleteMap(id) {
  return db.maps.delete(id)
}

export function saveActiveProjectId(id) {
  localStorage.setItem(activeProjectKey, id)
}

export function loadActiveProjectId() {
  return localStorage.getItem(activeProjectKey)
}

export function loadPromptPresets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(promptPresetsKey) || 'null')
    if (!Array.isArray(parsed) || !parsed.length) return defaultPromptPresets
    const existingIds = new Set(parsed.map((preset) => preset.id))
    const missingDefaults = defaultPromptPresets.filter((preset) => !existingIds.has(preset.id))
    return [...missingDefaults, ...parsed]
  } catch {
    return defaultPromptPresets
  }
}

export function savePromptPresets(presets) {
  localStorage.setItem(promptPresetsKey, JSON.stringify(presets))
}

export function loadDefaultPromptPresetId() {
  return localStorage.getItem(defaultPromptPresetKey) || defaultPromptPresets[0].id
}

export function saveDefaultPromptPresetId(id) {
  localStorage.setItem(defaultPromptPresetKey, id)
}
