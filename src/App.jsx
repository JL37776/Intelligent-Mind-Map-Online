import React, { useEffect, useMemo, useRef, useState } from 'react'
import MindElixir from 'mind-elixir'
import 'mind-elixir/style.css'
import { toPng } from 'html-to-image'
import {
  Download,
  Bell,
  ChevronDown,
  FileDown,
  FileUp,
  HardDrive,
  ImagePlus,
  KeyRound,
  PanelLeftClose,
  PanelLeftOpen,
  Crosshair,
  Maximize2,
  ZoomIn,
  ZoomOut,
  Save,
  Sparkles,
  Trash2,
  Plus,
  Wand2,
} from 'lucide-react'
import {
  mindDataToOutline,
  normalizeMindData,
  outlineToMindData,
  stripImagesForAI,
  starterOutline,
} from './mindmapFormat'
import {
  deleteMap,
  defaultPromptPresets,
  listMaps,
  loadActiveProjectId,
  loadDefaultPromptPresetId,
  loadMap,
  loadPromptPresets,
  saveActiveProjectId,
  saveDefaultPromptPresetId,
  saveMap,
  savePromptPresets,
} from './storage'
import { refineNodeOutline, refineOutline } from './aiClient'
import {
  applyNodeEmphasis,
  applySkeletonPreset,
  collectNodeStylesByTopicPath,
  emphasisOptions,
  getMindTheme,
  restoreNodeStylesByTopicPath,
  skeletonPresets,
} from './stylePresets'

const DEFAULT_SKELETON = 'bright'
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
const SEEN_VERSION_KEY = 'intelligent-ai-mind-map-seen-version'
const providerDefaults = {
  groq: 'llama-3.3-70b-versatile',
  gemini: 'gemini-2.5-flash',
}
const initialData = applySkeletonPreset(
  outlineToMindData(starterOutline),
  DEFAULT_SKELETON,
)
const AUTOSAVE_DELAY = 1400
const TIMED_SAVE_INTERVAL = 30000

function downloadText(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  }, [])
}

function titleFromData(data) {
  return data?.nodeData?.topic || 'Untitled Mind Map'
}

function normalizeThemeId(id) {
  if (skeletonPresets[id]) return id
  if (id === 'contrast') return 'mono'
  if (id === 'product' || id === 'study' || id === 'executive') return 'colorful'
  return DEFAULT_SKELETON
}

function formatSavedTime(value) {
  if (!value) return 'Not saved yet'
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value))
}

function getSelectedNodeObject(mind) {
  const selected = mind?.currentNode || mind?.currentNodes?.[0]
  return selected?.nodeObj || null
}

function getSelectedNodeId(mind, fallbackId) {
  return getSelectedNodeObject(mind)?.id || fallbackId || null
}

function findNodeById(node, id) {
  if (!node || !id) return null
  if (node.id === id) return node
  for (const child of node.children || []) {
    const found = findNodeById(child, id)
    if (found) return found
  }
  return null
}

function findNodePathById(node, id, path = []) {
  if (!node || !id) return null
  const nextPath = [...path, node]
  if (node.id === id) return nextPath
  for (const child of node.children || []) {
    const found = findNodePathById(child, id, nextPath)
    if (found) return found
  }
  return null
}

function nodeContextOutline(data, targetId, contextMode) {
  if (contextMode === 'full') return mindDataToOutline(stripImagesForAI(data))
  const depth = Number(contextMode)
  if (!Number.isFinite(depth) || depth <= 0) return ''

  const path = findNodePathById(data.nodeData, targetId)
  if (!path) return ''
  const contextRoot = path[Math.max(0, path.length - 1 - depth)]
  return mindDataToOutline(stripImagesForAI({ nodeData: contextRoot }))
}

function replaceNodeById(node, id, replacement) {
  if (!node || !id) return false
  if (node.id === id) {
    node.topic = replacement.topic
    node.children = replacement.children || []
    node.image = replacement.image || node.image
    node.hyperLink = replacement.hyperLink || node.hyperLink
    node.note = replacement.note || node.note
    node.metadata = {
      ...(node.metadata || {}),
      ...(replacement.metadata || {}),
      aiRefined: true,
      emphasis: 'important',
    }
    return true
  }

  for (const child of node.children || []) {
    if (replaceNodeById(child, id, replacement)) return true
  }
  return false
}

function mergeImagesByTopicPath(nextNode, previousNode) {
  if (!nextNode || !previousNode) return
  if (!nextNode.image && previousNode.image) nextNode.image = previousNode.image

  const previousChildren = previousNode.children || []
  ;(nextNode.children || []).forEach((child) => {
    const matchingPrevious = previousChildren.find((item) => item.topic === child.topic)
    if (matchingPrevious) mergeImagesByTopicPath(child, matchingPrevious)
  })
}

async function imageFileToNodeImage(file) {
  const dataUrl = await readFileAsDataUrl(file)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const maxWidth = 320
      const ratio = Math.min(1, maxWidth / img.width)
      resolve({
        url: dataUrl,
        width: Math.round(img.width * ratio),
        height: Math.round(img.height * ratio),
        fit: 'contain',
      })
    }
    img.onerror = reject
    img.src = dataUrl
  })
}

export default function App() {
  const mapRef = useRef(null)
  const mindRef = useRef(null)
  const fileInputRef = useRef(null)
  const importInputRef = useRef(null)
  const selectedNodeIdRef = useRef(null)
  const nodeRefineTargetIdRef = useRef(null)
  const promptPresetsRef = useRef(defaultPromptPresets)
  const bootstrappedRef = useRef(false)
  const dirtyRef = useRef(false)
  const autosaveTimerRef = useRef(null)
  const sourceSyncedFromMapRef = useRef(false)
  const [source, setSource] = useState(starterOutline)
  const [sourceMode, setSourceMode] = useState('raw')
  const [autoUpdateMap, setAutoUpdateMap] = useState(true)
  const [outline, setOutline] = useState(starterOutline)
  const [mindData, setMindData] = useState(initialData)
  const [skeletonId, setSkeletonId] = useState(DEFAULT_SKELETON)
  const [apiProvider, setApiProvider] = useState('groq')
  const [apiKey, setApiKey] = useState('')
  const [apiModel, setApiModel] = useState(providerDefaults.groq)
  const [promptPresets, setPromptPresets] = useState(defaultPromptPresets)
  const [fullPromptPresetId, setFullPromptPresetId] = useState(defaultPromptPresets[0].id)
  const [defaultNodePresetId, setDefaultNodePresetId] = useState(defaultPromptPresets[0].id)
  const [presetName, setPresetName] = useState('')
  const [presetPrompt, setPresetPrompt] = useState('')
  const [editingPresetId, setEditingPresetId] = useState(null)
  const [nodeRefineTarget, setNodeRefineTarget] = useState('No node selected')
  const [nodeContextMode, setNodeContextMode] = useState('1')
  const [isNodeBusy, setIsNodeBusy] = useState(false)
  const [nodeRefineMenu, setNodeRefineMenu] = useState(null)
  const [tooltip, setTooltip] = useState(null)
  const [toast, setToast] = useState(null)
  const [maps, setMaps] = useState([])
  const [activeId, setActiveId] = useState('demo-map')
  const [selectedTopic, setSelectedTopic] = useState('No node selected')
  const [status, setStatus] = useState('Ready')
  const [isLeftOpen, setIsLeftOpen] = useState(true)
  const [isBusy, setIsBusy] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [showUpdateNotice, setShowUpdateNotice] = useState(false)
  const [zoomPercent, setZoomPercent] = useState(100)
  const [collapsedPanels, setCollapsedPanels] = useState({})
  const [showIntro, setShowIntro] = useState(() => {
    return sessionStorage.getItem('intelligent-ai-mind-map-intro') !== 'seen'
  })

  const activeTitle = useMemo(() => titleFromData(mindData), [mindData])

  useEffect(() => {
    const presets = loadPromptPresets()
    const defaultPresetId = loadDefaultPromptPresetId()
    setPromptPresets(presets)
    setFullPromptPresetId(presets[0]?.id || defaultPromptPresets[0].id)
    setDefaultNodePresetId(
      presets.some((preset) => preset.id === defaultPresetId)
        ? defaultPresetId
        : presets[0]?.id || defaultPromptPresets[0].id,
    )
    bootstrapFromLocalStorage()
  }, [])

  useEffect(() => {
    promptPresetsRef.current = promptPresets
  }, [promptPresets])

  useEffect(() => {
    const seenVersion = localStorage.getItem(SEEN_VERSION_KEY)
    if (seenVersion !== APP_VERSION) setShowUpdateNotice(true)
  }, [])

  useEffect(() => {
    if (!bootstrappedRef.current || sourceSyncedFromMapRef.current) {
      sourceSyncedFromMapRef.current = false
      return
    }
    if (!autoUpdateMap) return

    const timer = window.setTimeout(() => {
      const current = normalizeMindData(mindRef.current?.getData() || mindData)
      const styleSnapshot = collectNodeStylesByTopicPath(current)
      const next = restoreNodeStylesByTopicPath(
        outlineToMindData(source),
        styleSnapshot,
      )
      refreshMind(next, 'Synced from raw text', skeletonId, { center: false, syncSource: false })
    }, 450)

    return () => window.clearTimeout(timer)
  }, [source, autoUpdateMap])

  useEffect(() => {
    if (!bootstrappedRef.current) return
    dirtyRef.current = true
    window.clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = window.setTimeout(() => {
      autoSaveCurrentMap('Auto-saved')
    }, AUTOSAVE_DELAY)

    return () => window.clearTimeout(autosaveTimerRef.current)
  }, [source, mindData, skeletonId, activeId])

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (dirtyRef.current) autoSaveCurrentMap('Timed save complete')
    }, TIMED_SAVE_INTERVAL)

    const handleBeforeUnload = () => {
      if (activeId) saveActiveProjectId(activeId)
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [activeId, source, mindData, skeletonId])

  useEffect(() => {
    if (!showIntro) return
    const timer = window.setTimeout(() => {
      sessionStorage.setItem('intelligent-ai-mind-map-intro', 'seen')
      setShowIntro(false)
    }, 3400)

    return () => window.clearTimeout(timer)
  }, [showIntro])

  useEffect(() => {
    const handlePaste = async (event) => {
      const items = Array.from(event.clipboardData?.items || [])
      const imageItem = items.find((item) => item.type.startsWith('image/'))
      if (!imageItem) return

      event.preventDefault()
      const file = imageItem.getAsFile()
      if (file) await applyImageFileToSelectedNode(file, 'Screenshot pasted')
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  })

  useEffect(() => {
    const closeMenu = () => setNodeRefineMenu(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [])

  useEffect(() => {
    const target = mapRef.current
    if (!target) return undefined

    const handleContextMenuCapture = (event) => {
      handleMapContextMenu(event)
    }

    target.addEventListener('contextmenu', handleContextMenuCapture, true)
    return () => {
      target.removeEventListener('contextmenu', handleContextMenuCapture, true)
    }
  })

  useEffect(() => {
    const handleKeydown = (event) => {
      const tagName = event.target?.tagName
      const isTyping =
        tagName === 'INPUT' || tagName === 'TEXTAREA' || event.target?.isContentEditable
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f' || isTyping) {
        return
      }

      const targetId = getSelectedNodeId(mindRef.current, selectedNodeIdRef.current)
      if (!targetId) return
      event.preventDefault()
      refineWithDefaultPreset(targetId)
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [apiProvider, apiKey, apiModel, nodeContextMode, mindData, skeletonId, defaultNodePresetId, promptPresets])

  useEffect(() => {
    const handleMouseOver = (event) => {
      const trigger = event.target?.closest?.('[data-tooltip]')
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      setTooltip({
        text: trigger.dataset.tooltip,
        x: rect.left + rect.width / 2,
        y: rect.bottom + 8,
      })
    }

    const handleMouseOut = (event) => {
      if (!event.target?.closest?.('[data-tooltip]')) return
      setTooltip(null)
    }

    window.addEventListener('mouseover', handleMouseOver)
    window.addEventListener('mouseout', handleMouseOut)
    return () => {
      window.removeEventListener('mouseover', handleMouseOver)
      window.removeEventListener('mouseout', handleMouseOut)
    }
  }, [])

  useEffect(() => {
    if (!toast || toast.persistent) return
    const timer = window.setTimeout(() => setToast(null), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!mapRef.current || mindRef.current) return

    const mind = new MindElixir({
      el: mapRef.current,
      direction: MindElixir.LEFT,
      draggable: true,
      contextMenu: {
        focus: true,
        link: true,
        extend: [
          {
            name: 'AI refine node',
            key: 'AI',
            onclick: (event) => {
              setNodeRefineTargetFromEvent(event)
            },
          },
        ],
      },
      toolBar: true,
      nodeMenu: true,
      keypress: true,
      locale: 'en',
      overflowHidden: false,
      mainLinkStyle: 2,
      mouseSelectionButton: 0,
      theme: getMindTheme(skeletonId),
      before: {
        finishEdit() {
          queueSyncFromMind('Edited')
          return true
        },
        addChild() {
          queueSyncFromMind('Node added')
          return true
        },
        insertSibling() {
          queueSyncFromMind('Node added')
          return true
        },
        removeNode() {
          queueSyncFromMind('Node removed')
          return true
        },
        moveNode() {
          queueSyncFromMind('Node moved')
          return true
        },
      },
    })

    mind.init(mindData)
    mind.bus.addListener('selectNode', (node) => {
      const nodeObj = node?.nodeObj || node
      selectedNodeIdRef.current = nodeObj?.id || null
      nodeRefineTargetIdRef.current = nodeObj?.id || nodeRefineTargetIdRef.current
      setNodeRefineTarget(nodeObj?.topic || nodeRefineTarget)
      setSelectedTopic(nodeObj?.topic || 'No node selected')
    })
    mind.bus.addListener('selectNodes', (nodes) => {
      const firstNode = nodes?.[0]?.nodeObj || nodes?.[0]
      selectedNodeIdRef.current = firstNode?.id || null
      setSelectedTopic(
        nodes?.length ? `${nodes.length} nodes selected` : 'No node selected',
      )
    })
    mind.bus.addListener('operation', () => {
      queueSyncFromMind('Updated')
    })

    mindRef.current = mind
  }, [mindData])

  function handleMapContextMenu(event) {
    const topicEl = event.target?.closest?.('me-tpc')
    const nodeId = topicEl?.nodeObj?.id
    if (!nodeId) return

    event.preventDefault()
    event.stopPropagation()
    setNodeRefineTargetById(nodeId, 'Right-click target ready for AI refine')
    setNodeRefineMenu({
      x: event.clientX,
      y: event.clientY,
      nodeId,
      topic: topicEl.nodeObj?.topic || 'Selected node',
    })
  }

  function queueSyncFromMind(message) {
    window.clearTimeout(queueSyncFromMind.timer)
    queueSyncFromMind.timer = window.setTimeout(() => {
      if (!mindRef.current) return
      const next = applySkeletonPreset(
        normalizeMindData(mindRef.current.getData()),
        skeletonId,
      )
      const nextOutline = mindDataToOutline(next)
      setMindData(next)
      setOutline(nextOutline)
      sourceSyncedFromMapRef.current = true
      setSource(nextOutline)
      setStatus(message)
    }, 120)
  }

  function setNodeRefineTargetById(nodeId, message = 'Node selected for AI refine') {
    const current = normalizeMindData(mindRef.current?.getData() || mindData)
    const target = findNodeById(current.nodeData, nodeId)
    if (!target) {
      setStatus('Node refine target was not found')
      return
    }
    nodeRefineTargetIdRef.current = nodeId
    selectedNodeIdRef.current = nodeId
    setNodeRefineTarget(target.topic)
    setStatus(message)
  }

  function setNodeRefineTargetFromEvent(event) {
    const topicEl = event.target?.closest?.('me-tpc')
    const nodeId = topicEl?.nodeObj?.id || getSelectedNodeId(mindRef.current, selectedNodeIdRef.current)
    if (nodeId) setNodeRefineTargetById(nodeId, 'Right-click target ready for AI refine')
  }

  async function runNodeMenuAction(action, nodeId) {
    const mind = mindRef.current
    const target = mind?.findEle?.(nodeId)
    if (!mind || !target) return

    setNodeRefineMenu(null)
    mind.selectNode(target)
    selectedNodeIdRef.current = nodeId

    try {
      if (action === 'addChild') await mind.addChild(target)
      if (action === 'addSibling') await mind.insertSibling('after', target)
      if (action === 'addParent') await mind.insertParent(target)
      if (action === 'edit') await mind.beginEdit(target)
      if (action === 'remove') await mind.removeNodes([target])
      if (action === 'focus') mind.focusNode(target)
      if (action === 'cancelFocus') mind.cancelFocus()
      if (action === 'moveUp') await mind.moveUpNode(target)
      if (action === 'moveDown') await mind.moveDownNode(target)
      if (action !== 'edit') queueSyncFromMind('Node action applied')
    } catch (error) {
      setStatus(error.message || 'Node action failed')
    }
  }

  function refreshMind(
    nextData,
    message = 'Map refreshed',
    nextSkeletonId = skeletonId,
    options = {},
  ) {
    const normalized = applySkeletonPreset(
      normalizeMindData(nextData),
      nextSkeletonId,
    )
    const nextOutline = mindDataToOutline(normalized)
    setMindData(normalized)
    setOutline(nextOutline)
    if (options.syncSource !== false) {
      sourceSyncedFromMapRef.current = true
      setSource(nextOutline)
    }
    if (mindRef.current) {
      mindRef.current.changeTheme(getMindTheme(nextSkeletonId), false)
      mindRef.current.refresh(normalized)
      if (options.center !== false) mindRef.current.toCenter()
    }
    setStatus(message)
  }

  function centerMap() {
    mindRef.current?.toCenter()
    setStatus('Centered')
  }

  function showToast(type, title, message, persistent = false) {
    setToast({ type, title, message, persistent })
  }

  function setMapZoom(nextScale) {
    const mind = mindRef.current
    if (!mind) return
    const clamped = Math.max(0.3, Math.min(1.8, nextScale))
    mind.scale(clamped)
    setZoomPercent(Math.round(clamped * 100))
    setStatus(`Zoom ${Math.round(clamped * 100)}%`)
  }

  function zoomMap(direction) {
    const current = mindRef.current?.scaleVal || zoomPercent / 100
    setMapZoom(current + direction * 0.1)
  }

  function fitMap() {
    const mind = mindRef.current
    if (!mind) return
    mind.scaleFit?.()
    setZoomPercent(Math.round((mind.scaleVal || 1) * 100))
    setStatus('Fit to view')
  }

  function dismissUpdateNotice() {
    localStorage.setItem(SEEN_VERSION_KEY, APP_VERSION)
    setShowUpdateNotice(false)
  }

  function selectApiProvider(provider) {
    setApiProvider(provider)
    setApiModel(providerDefaults[provider] || providerDefaults.groq)
  }

  function togglePanel(panelId) {
    setCollapsedPanels((current) => ({
      ...current,
      [panelId]: !current[panelId],
    }))
  }

  function panelClass(baseClass, panelId) {
    return `${baseClass} ${collapsedPanels[panelId] ? 'panel-collapsed' : ''}`
  }

  async function refreshMapList() {
    const nextMaps = await listMaps()
    setMaps(nextMaps)
    return nextMaps
  }

  async function bootstrapFromLocalStorage() {
    const recentMaps = await refreshMapList()
    const activeProjectId = loadActiveProjectId()
    const preferred = activeProjectId
      ? await loadMap(activeProjectId)
      : recentMaps[0]

    if (preferred) {
      setActiveId(preferred.id)
      setSource(preferred.source || preferred.outline || starterOutline)
      const preferredSkeletonId = normalizeThemeId(preferred.skeletonId)
      setSkeletonId(preferredSkeletonId)
      setLastSavedAt(preferred.updatedAt || null)
      refreshMind(
        preferred.mindData || outlineToMindData(preferred.outline || starterOutline),
        'Restored from local cache',
        preferredSkeletonId,
      )
    }

    window.setTimeout(() => {
      bootstrappedRef.current = true
    }, 0)
  }

  function buildCurrentRecord() {
    const current = normalizeMindData(mindRef.current?.getData() || mindData)
    return {
      id: activeId,
      title: titleFromData(current),
      source,
      outline: mindDataToOutline(current),
      mindData: current,
      skeletonId,
    }
  }

  async function autoSaveCurrentMap(message) {
    if (!activeId || !bootstrappedRef.current) return
    const record = buildCurrentRecord()
    await saveMap(record)
    const savedAt = new Date().toISOString()
    setLastSavedAt(savedAt)
    dirtyRef.current = false
    await refreshMapList()
    setStatus(message)
  }

  function generateFromOutline() {
    const current = normalizeMindData(mindRef.current?.getData() || mindData)
    const styleSnapshot = collectNodeStylesByTopicPath(current)
    const next = restoreNodeStylesByTopicPath(
      outlineToMindData(source),
      styleSnapshot,
    )
    refreshMind(next, 'Generated from outline')
  }

  async function refineWithGroq() {
    setIsBusy(true)
    setStatus(`Asking ${apiProvider}...`)
    showToast('progress', 'Refining full map', `Using ${apiProvider}`, true)
    try {
      const selectedPreset =
        promptPresets.find((preset) => preset.id === fullPromptPresetId) ||
        promptPresets[0] ||
        defaultPromptPresets[0]
      const refinedOutline = await refineOutline({
        source,
        instruction: selectedPreset.prompt,
        provider: apiProvider,
        apiKey,
        model: apiModel,
        currentOutline: mindDataToOutline(
          stripImagesForAI(mindRef.current?.getData() || mindData),
        ),
      })
      const current = normalizeMindData(mindRef.current?.getData() || mindData)
      const styleSnapshot = collectNodeStylesByTopicPath(current)
      const next = restoreNodeStylesByTopicPath(
        outlineToMindData(refinedOutline),
        styleSnapshot,
      )
      setOutline(refinedOutline)
      setSource(refinedOutline)
      refreshMind(next, `Refined with ${apiProvider}`)
      showToast('success', 'Full map refined', activeTitle)
    } catch (error) {
      const message = error.message || 'Full map refine failed'
      setStatus(message)
      showToast('error', 'Refine failed', message, true)
    } finally {
      setIsBusy(false)
    }
  }

  async function refineSelectedNode(prompt, targetOverrideId = null) {
    const targetId =
      targetOverrideId ||
      nodeRefineTargetIdRef.current ||
      getSelectedNodeId(mindRef.current, selectedNodeIdRef.current)

    if (!targetId) {
      const message = 'Right-click or select a node before node AI refine'
      setStatus(message)
      showToast('error', 'No node selected', message)
      return
    }

    const current = normalizeMindData(mindRef.current?.getData() || mindData)
    const target = findNodeById(current.nodeData, targetId)
    if (!target) {
      const message = 'Node refine target was not found'
      setStatus(message)
      showToast('error', 'Refine failed', message)
      return
    }

    setIsNodeBusy(true)
    setStatus(`Refining node: ${target.topic}`)
    showToast('progress', 'Refining sub-branch', `${target.topic} with ${apiProvider}`, true)
    try {
      const refinedOutline = await refineNodeOutline({
        nodeOutline: mindDataToOutline({ nodeData: target }),
        fullOutline: nodeContextOutline(current, targetId, nodeContextMode),
        instruction: prompt,
        provider: apiProvider,
        apiKey,
        model: apiModel,
      })
      const refinedNode = outlineToMindData(refinedOutline).nodeData
      refinedNode.id = target.id
      mergeImagesByTopicPath(refinedNode, target)
      refinedNode.metadata = {
        ...(target.metadata || {}),
        ...(refinedNode.metadata || {}),
        aiRefined: true,
        emphasis: 'important',
      }
      const next = structuredClone(current)
      replaceNodeById(next.nodeData, targetId, refinedNode)
      refreshMind(next, `AI refined node: ${target.topic}`)
      setNodeRefineTarget(refinedNode.topic || target.topic)
      nodeRefineTargetIdRef.current = targetId
      showToast('success', 'Refine complete', refinedNode.topic || target.topic)
    } catch (error) {
      const message = error.message || 'Node refine failed'
      setStatus(message)
      showToast('error', 'Refine failed', message, true)
    } finally {
      setIsNodeBusy(false)
    }
  }

  function refineWithDefaultPreset(targetOverrideId = null) {
    const defaultPreset =
      promptPresetsRef.current.find((preset) => preset.id === defaultNodePresetId) ||
      promptPresetsRef.current[0] ||
      defaultPromptPresets[0]
    refineSelectedNode(defaultPreset.prompt, targetOverrideId)
  }

  async function saveCurrentMap() {
    const record = buildCurrentRecord()
    await saveMap(record)
    const savedAt = new Date().toISOString()
    setLastSavedAt(savedAt)
    dirtyRef.current = false
    await refreshMapList()
    setStatus('Saved locally')
  }

  async function loadSavedMap(id) {
    const record = await loadMap(id)
    if (!record) return
    setActiveId(record.id)
    setSource(record.source || record.outline || '')
    const recordSkeletonId = normalizeThemeId(record.skeletonId)
    setSkeletonId(recordSkeletonId)
    setLastSavedAt(record.updatedAt || null)
    dirtyRef.current = false
    saveActiveProjectId(record.id)
    refreshMind(record.mindData, 'Loaded', recordSkeletonId)
  }

  async function removeSavedMap(id) {
    await deleteMap(id)
    await refreshMapList()
    if (id === activeId) newMap()
    setStatus('Deleted local map')
  }

  async function exportPng() {
    if (!mindRef.current?.nodes) return
    setStatus('Exporting PNG...')
    const dataUrl = await toPng(mindRef.current.nodes, {
      cacheBust: true,
      pixelRatio: 2,
    })
    const link = document.createElement('a')
    link.download = `${activeTitle}.png`
    link.href = dataUrl
    link.click()
    setStatus('PNG exported')
  }

  function exportJson() {
    const current = normalizeMindData(mindRef.current?.getData() || mindData)
    downloadText(`${activeTitle}.json`, JSON.stringify(current, null, 2))
    setStatus('JSON exported')
  }

  function exportMarkdown() {
    const current = normalizeMindData(mindRef.current?.getData() || mindData)
    downloadText(`${activeTitle}.md`, mindDataToOutline(current), 'text/markdown')
    setStatus('Markdown exported')
  }

  async function importJson(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const text = await file.text()
    refreshMind(JSON.parse(text), 'JSON imported')
  }

  async function applyImageFileToSelectedNode(file, message = 'Image inserted') {
    const mind = mindRef.current
    if (!file || !mind) return

    const selectedId = getSelectedNodeId(mind, selectedNodeIdRef.current)
    if (!selectedId) {
      setStatus('Select a node before inserting an image')
      return
    }

    try {
      const current = normalizeMindData(mind.getData())
      const target = findNodeById(current.nodeData, selectedId)
      if (!target) {
        setStatus('Selected node was not found')
        return
      }

      target.image = await imageFileToNodeImage(file)
      refreshMind(current, message)
      selectedNodeIdRef.current = selectedId
    } catch (error) {
      setStatus(error.message || 'Image insert failed')
    }
  }

  async function insertImage(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    await applyImageFileToSelectedNode(file)
  }

  function applySkeleton(nextSkeletonId) {
    setSkeletonId(nextSkeletonId)
    const current = normalizeMindData(mindRef.current?.getData() || mindData)
    refreshMind(current, `${skeletonPresets[nextSkeletonId].label} skeleton applied`, nextSkeletonId)
  }

  function markSelectedNode(emphasis) {
    const selectedId = getSelectedNodeId(mindRef.current, selectedNodeIdRef.current)
    if (!selectedId) {
      setStatus('Select a node before applying emphasis')
      return
    }

    const current = normalizeMindData(mindRef.current?.getData() || mindData)
    const { data, didApply } = applyNodeEmphasis(
      current,
      selectedId,
      emphasis,
      skeletonId,
    )

    if (!didApply) {
      setStatus('Selected node was not found')
      return
    }

    refreshMind(data, `${emphasisOptions.find((item) => item.id === emphasis)?.label} style applied`)
  }

  function savePreset() {
    const name = presetName.trim()
    const prompt = presetPrompt.trim()
    if (!name || !prompt) {
      setStatus('Preset name and prompt are required')
      return
    }

    const nextPresets = editingPresetId
      ? promptPresets.map((preset) =>
          preset.id === editingPresetId ? { ...preset, name, prompt } : preset,
        )
      : [
          ...promptPresets,
          {
            id: `preset-${Date.now()}`,
            name,
            prompt,
          },
        ]

    setPromptPresets(nextPresets)
    savePromptPresets(nextPresets)
    setPresetName('')
    setPresetPrompt('')
    setEditingPresetId(null)
    setStatus(editingPresetId ? 'Preset updated' : 'Preset added')
  }

  function editPreset(preset) {
    setEditingPresetId(preset.id)
    setPresetName(preset.name)
    setPresetPrompt(preset.prompt)
  }

  function deletePreset(id) {
    const nextPresets = promptPresets.filter((preset) => preset.id !== id)
    const nextDefaultId =
      id === defaultNodePresetId
        ? nextPresets[0]?.id || defaultPromptPresets[0].id
        : defaultNodePresetId
    setPromptPresets(nextPresets)
    setDefaultNodePresetId(nextDefaultId)
    savePromptPresets(nextPresets)
    saveDefaultPromptPresetId(nextDefaultId)
    if (editingPresetId === id) {
      setEditingPresetId(null)
      setPresetName('')
      setPresetPrompt('')
    }
    setStatus('Preset deleted')
  }

  function markDefaultPreset(id) {
    setDefaultNodePresetId(id)
    saveDefaultPromptPresetId(id)
    setStatus('Default node refine preset updated')
  }

  function usePreset(preset) {
    refineSelectedNode(preset.prompt)
  }

  function usePresetFromMenu(preset, nodeId) {
    setNodeRefineMenu(null)
    refineSelectedNode(preset.prompt, nodeId)
  }

  function newMap() {
    const id = `map-${Date.now()}`
    setActiveId(id)
    setLastSavedAt(null)
    setSource(starterOutline)
    saveActiveProjectId(id)
    refreshMind(initialData, 'New map')
  }

  async function openLatestMap() {
    const latest = maps[0]
    if (!latest) {
      setStatus('No recent project to open')
      return
    }
    await loadSavedMap(latest.id)
  }

  return (
    <main className={`app-shell app-theme-${skeletonId} ${isLeftOpen ? '' : 'left-collapsed'}`}>
      {showIntro && (
        <section className="intro-overlay" aria-label="Welcome">
          <div className="intro-grid" />
          <div className="intro-card">
            <span className="intro-kicker">AI-boosted mind generation</span>
            <h1>Intelligent AI Mind Map</h1>
            <p>Mind maps that boost your mind.</p>
            <div className="intro-sparkline">
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>
        </section>
      )}
      <aside className="sidebar">
        <div className="brand-row">
          <div>
            <h1>Intelligent AI Mind Map</h1>
            <p>AI-boosted mind generation.</p>
          </div>
          <button
            className="icon-button"
            type="button"
            data-tooltip="Collapse the left control panel"
            aria-label="Collapse the left control panel"
            onClick={() => setIsLeftOpen(false)}
          >
            <PanelLeftClose size={18} />
          </button>
        </div>

        <section className={panelClass('saved-panel', 'recent')}>
          <button className="section-heading" type="button" onClick={() => togglePanel('recent')}>
            <h2>Recent projects</h2>
            <span>
              <HardDrive size={15} />
              <ChevronDown size={15} />
            </span>
          </button>
          <div className="map-list panel-body">
            {maps.length === 0 ? (
              <p className="empty-state">No recent projects yet.</p>
            ) : (
              maps.map((map) => (
                <div
                  className={`map-row ${map.id === activeId ? 'active' : ''}`}
                  key={map.id}
                >
                  <button
                    type="button"
                    onClick={() => loadSavedMap(map.id)}
                  >
                    <span>{map.title}</span>
                    <small>{formatSavedTime(map.updatedAt)}</small>
                  </button>
                  <button
                    className="icon-button subtle"
                    type="button"
                    aria-label={`Delete local project: ${map.title}`}
                    onClick={() => removeSavedMap(map.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        <section className={panelClass('settings-panel project-panel', 'project')}>
          <button className="section-heading" type="button" onClick={() => togglePanel('project')}>
            <h2>Project</h2>
            <span>
              <Save size={15} />
              <ChevronDown size={15} />
            </span>
          </button>
          <div className="project-actions panel-body">
            <button type="button" onClick={saveCurrentMap} data-tooltip="Save the current project locally">
              <Save size={16} />
              Save
            </button>
            <button type="button" onClick={openLatestMap} data-tooltip="Open the most recent local project">
              <FileUp size={16} />
              Open
            </button>
            <button type="button" onClick={newMap} data-tooltip="Create a new mind map project">
              <Plus size={16} />
              Add
            </button>
          </div>
        </section>

        <section className={panelClass('settings-panel full-map-panel', 'fullMap')}>
          <button className="section-heading" type="button" onClick={() => togglePanel('fullMap')}>
            <h2>Full map</h2>
            <span>
              <Wand2 size={15} />
              <ChevronDown size={15} />
            </span>
          </button>
          <div className="panel-body panel-stack">
          <div className="segmented-tabs">
            <button
              className={sourceMode === 'raw' ? 'active' : ''}
              type="button"
              data-tooltip="Paste rough notes, raw text, or unstructured material"
              onClick={() => setSourceMode('raw')}
            >
              Raw content
            </button>
            <button
              className={sourceMode === 'llm' ? 'active' : ''}
              type="button"
              data-tooltip="Paste structured notes from ChatGPT or another LLM"
              onClick={() => setSourceMode('llm')}
            >
              GPT/LLM paste
            </button>
          </div>
          <textarea
            id="source"
            className="source-textarea"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder={
              sourceMode === 'raw'
                ? 'Add raw notes, meeting notes, article excerpts, or rough ideas...'
                : 'Paste structured notes from ChatGPT, Claude, Gemini, or another LLM...'
            }
            spellCheck="false"
          />
          <div className="format-hint">
            Use Markdown only for structure: <code>#</code>, <code>##</code>,{' '}
            <code>- item</code>. Mark node style after generation with{' '}
            <strong>Important</strong>, <strong>Plain</strong>, or{' '}
            <strong>Muted</strong>. Style marks are separate from Markdown.
          </div>
          <select
            aria-label="Full map prompt preset"
            value={fullPromptPresetId}
            onChange={(event) => setFullPromptPresetId(event.target.value)}
          >
            {promptPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
          <label className="checkbox-row">
            <input
              checked={autoUpdateMap}
              onChange={(event) => setAutoUpdateMap(event.target.checked)}
              type="checkbox"
            />
            <span>Auto update map from raw text</span>
          </label>
          <div className="full-map-actions">
            <button type="button" onClick={generateFromOutline} data-tooltip="Update the mind map from the current raw text">
              <Wand2 size={16} />
              Update map
            </button>
            <button
              type="button"
              onClick={refineWithGroq}
              disabled={isBusy}
              data-tooltip="Use the selected prompt preset to refine the full map"
            >
              <Sparkles size={16} />
              {isBusy ? 'Refining...' : 'Prompt refine full map'}
            </button>
          </div>
          </div>
        </section>

        <section className={panelClass('settings-panel node-ai-panel', 'nodeAi')}>
          <button className="section-heading" type="button" onClick={() => togglePanel('nodeAi')}>
            <h2>Node AI refine</h2>
            <span>
              <Sparkles size={15} />
              <ChevronDown size={15} />
            </span>
          </button>
          <div className="panel-body panel-stack">
          <div className="target-pill">
            <span>Target</span>
            <strong>{nodeRefineTarget}</strong>
          </div>
          <div className="node-ai-actions">
            <label className="context-depth-row">
              <span>Context</span>
              <select
                aria-label="Node refine context depth"
                value={nodeContextMode}
                onChange={(event) => setNodeContextMode(event.target.value)}
              >
                <option value="0">Selected only</option>
                <option value="1">Parent level</option>
                <option value="2">2 levels up</option>
                <option value="3">3 levels up</option>
                <option value="full">Full map</option>
              </select>
            </label>
          </div>

          <input
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
            placeholder="Preset name"
          />
          <textarea
            className="compact-textarea"
            value={presetPrompt}
            onChange={(event) => setPresetPrompt(event.target.value)}
            placeholder="Preset prompt"
            spellCheck="false"
          />
          <button
            type="button"
            onClick={savePreset}
            data-tooltip={editingPresetId ? 'Update the selected prompt preset' : 'Add a new reusable prompt preset'}
          >
            <Plus size={16} />
            {editingPresetId ? 'Update Preset' : 'Add Preset'}
          </button>
          <div className="preset-table">
            <div className="preset-table-head">
              <span>Default</span>
              <span>Preset list</span>
              <span>Actions</span>
            </div>
            {promptPresets.map((preset) => (
              <div className="preset-table-row" key={preset.id}>
                <label className="default-preset-radio">
                  <input
                    checked={defaultNodePresetId === preset.id}
                    onChange={() => markDefaultPreset(preset.id)}
                    type="radio"
                  />
                  <span>Default</span>
                </label>
                <button
                  className="preset-name-button"
                  type="button"
                  disabled={isNodeBusy}
                  data-tooltip={`Run preset on selected node: ${preset.name}`}
                  onClick={() => usePreset(preset)}
                >
                  {preset.name}
                </button>
                <div className="preset-actions">
                  <button
                  className="mini-button"
                  type="button"
                  onClick={() => editPreset(preset)}
                >
                    Edit
                  </button>
                  <button
                  className="mini-button danger"
                  type="button"
                  onClick={() => deletePreset(preset.id)}
                >
                    Del
                  </button>
                </div>
              </div>
            ))}
          </div>
          </div>
        </section>

        <details className="settings-panel api-details">
          <summary data-tooltip="Open model and API key settings">
            <span>LLM API</span>
            <KeyRound size={15} />
          </summary>
          <select
            aria-label="AI provider"
            value={apiProvider}
            onChange={(event) => selectApiProvider(event.target.value)}
          >
            <option value="groq">Groq</option>
            <option value="gemini">Gemini</option>
          </select>
          <input
            aria-label={`${apiProvider} API key`}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={`Optional ${apiProvider === 'gemini' ? 'Gemini' : 'Groq'} API key for this session`}
            type="password"
          />
          <input
            aria-label={`${apiProvider} model`}
            value={apiModel}
            onChange={(event) => setApiModel(event.target.value)}
            placeholder={apiProvider === 'gemini' ? 'Gemini model' : 'Groq model'}
          />
        </details>
      </aside>

      <section className={`workspace workspace-theme-${skeletonId}`}>
        <header className="toolbar">
          {!isLeftOpen && (
            <button
              className="icon-button"
              type="button"
              data-tooltip="Open the left control panel"
              aria-label="Open the left control panel"
              onClick={() => setIsLeftOpen(true)}
            >
              <PanelLeftOpen size={18} />
            </button>
          )}
          <div className="title-block">
            <strong>{activeTitle}</strong>
            <span>{selectedTopic}</span>
          </div>
          <div className="style-controls">
            <div className="theme-quick-switch" aria-label="Quick theme">
              {Object.entries(skeletonPresets).map(([id, preset]) => (
                <button
                  className={skeletonId === id ? 'active' : ''}
                  key={id}
                  type="button"
                  data-tooltip={`Switch canvas theme to ${preset.label}`}
                  onClick={() => applySkeleton(id)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="segmented-control" aria-label="Node emphasis">
              {emphasisOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  data-tooltip={`Mark the selected node as ${option.label}`}
                  onClick={() => markSelectedNode(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="toolbar-actions">
            <button type="button" onClick={centerMap} data-tooltip="Reset the view to the center of the mind map">
              <Crosshair size={16} />
              Center
            </button>
            <button type="button" onClick={() => zoomMap(-1)} data-tooltip="Zoom out">
              <ZoomOut size={16} />
              {zoomPercent}%
            </button>
            <button type="button" onClick={() => zoomMap(1)} data-tooltip="Zoom in">
              <ZoomIn size={16} />
              Zoom
            </button>
            <button type="button" onClick={fitMap} data-tooltip="Fit the whole mind map into view">
              <Maximize2 size={16} />
              Fit
            </button>
            <button type="button" onClick={() => fileInputRef.current?.click()} data-tooltip="Insert an image into the selected node">
              <ImagePlus size={16} />
              Image
            </button>
            <button type="button" onClick={exportPng} data-tooltip="Export the current mind map as PNG">
              <Download size={16} />
              PNG
            </button>
            <button type="button" onClick={exportMarkdown} data-tooltip="Export the current mind map as Markdown">
              <FileDown size={16} />
              MD
            </button>
            <button type="button" onClick={exportJson} data-tooltip="Export the current mind map as JSON">
              <FileDown size={16} />
              JSON
            </button>
            <button type="button" onClick={() => importInputRef.current?.click()} data-tooltip="Import a saved JSON mind map">
              <FileUp size={16} />
              Import
            </button>
          </div>
        </header>

        <div className={`map-stage theme-${skeletonId}`}>
          <div id="mind-map" ref={mapRef} />
          {nodeRefineMenu && (
            <div
              className="node-refine-context-menu"
              style={{ left: nodeRefineMenu.x, top: nodeRefineMenu.y }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="context-menu-title">{nodeRefineMenu.topic}</div>
              <button type="button" onClick={() => runNodeMenuAction('addChild', nodeRefineMenu.nodeId)}>
                Add child <kbd>Tab</kbd>
              </button>
              <button type="button" onClick={() => runNodeMenuAction('addSibling', nodeRefineMenu.nodeId)}>
                Add sibling <kbd>Enter</kbd>
              </button>
              <button type="button" onClick={() => runNodeMenuAction('addParent', nodeRefineMenu.nodeId)}>
                Add parent <kbd>Ctrl+Enter</kbd>
              </button>
              <button type="button" onClick={() => runNodeMenuAction('edit', nodeRefineMenu.nodeId)}>
                Edit node
              </button>
              <button type="button" onClick={() => runNodeMenuAction('remove', nodeRefineMenu.nodeId)}>
                Remove node <kbd>Del</kbd>
              </button>
              <div className="context-menu-separator" />
              <button type="button" onClick={() => runNodeMenuAction('focus', nodeRefineMenu.nodeId)}>
                Focus mode
              </button>
              <button type="button" onClick={() => runNodeMenuAction('cancelFocus', nodeRefineMenu.nodeId)}>
                Cancel focus mode
              </button>
              <button type="button" onClick={() => runNodeMenuAction('moveUp', nodeRefineMenu.nodeId)}>
                Move up
              </button>
              <button type="button" onClick={() => runNodeMenuAction('moveDown', nodeRefineMenu.nodeId)}>
                Move down
              </button>
              <div className="context-menu-separator" />
              <button
                className="context-ai-primary"
                type="button"
                onClick={() => {
                  setNodeRefineMenu(null)
                  refineWithDefaultPreset(nodeRefineMenu.nodeId)
                }}
                data-tooltip="Quickly refine this node with the first saved prompt preset"
              >
                <Sparkles size={15} />
                AI Refine Default
                <kbd>Ctrl+F</kbd>
              </button>
              <div className="context-ai-submenu-host">
                <button className="context-ai-submenu-trigger" type="button">
                  AI Refine presets
                  <span>›</span>
                </button>
                <div className="context-menu-list context-submenu">
                  {promptPresets.map((preset) => (
                    <div className="context-preset-row" key={preset.id}>
                      <button
                        type="button"
                        data-tooltip={`Refine this node with preset: ${preset.name}`}
                        onClick={() => usePresetFromMenu(preset, nodeRefineMenu.nodeId)}
                      >
                        {preset.name}
                      </button>
                      <label>
                        <input
                          checked={defaultNodePresetId === preset.id}
                          onChange={() => markDefaultPreset(preset.id)}
                          type="radio"
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className="status-bar">
          <span>{status}</span>
          <span>Last saved: {formatSavedTime(lastSavedAt)}</span>
          <span>Shortcuts: Enter, Tab, Shift+Tab, Delete, Ctrl+Z, Ctrl+Y, drag nodes, Ctrl+V image</span>
        </footer>
      </section>

      <input
        ref={fileInputRef}
        hidden
        type="file"
        accept="image/*"
        onChange={insertImage}
      />
      <input
        ref={importInputRef}
        hidden
        type="file"
        accept="application/json,.json"
        onChange={importJson}
      />
      {tooltip && (
        <div
          className="global-tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text}
        </div>
      )}
      {showUpdateNotice && (
        <div className="update-notice" role="dialog" aria-modal="true" aria-label="App update">
          <div className="update-notice-panel">
            <Bell size={18} />
            <div>
              <strong>Updated</strong>
              <p>New version loaded: {APP_VERSION}</p>
            </div>
            <button type="button" onClick={dismissUpdateNotice}>
              Got it
            </button>
          </div>
        </div>
      )}
      {toast && (
        <div className={`refine-toast refine-toast-${toast.type}`} role="alert">
          <div>
            <strong>{toast.title}</strong>
            <p>{toast.message}</p>
          </div>
          <button type="button" onClick={() => setToast(null)}>
            OK
          </button>
        </div>
      )}
    </main>
  )
}
