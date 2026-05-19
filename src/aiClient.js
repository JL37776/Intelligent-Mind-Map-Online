const systemPrompt = `Return ONLY a Markdown mind-map outline.
No prose. No code fence. No <think>. No reasoning.
Use only: #, ##, ###, nested "- ", optional "> Summary:", optional [!important]/[!plain]/[!muted].
Preserve unrelated nodes.
Do not invent facts, links, images, citations, or tasks.
No placeholders: New Node, Keyword, 关键词, 结构, 机构, Example, xxx.`

export function cleanAIOutline(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .replace(/<\/?think>/gi, '')
    .replace(/```(?:md|markdown)?\s*([\s\S]*?)```/gi, '$1')
    .split(/\r?\n/)
    .filter((line) => !/^\s*(okay|first,|the user|i need|i should|so,|putting it|let'?s|analysis:|final:)/i.test(line))
    .join('\n')
    .trim()
}

function buildUserPrompt({ source, instruction, currentOutline }) {
  return [
    instruction
      ? `Editing request:\n${instruction}`
      : 'Convert the material into a clear, well-structured mind map.',
    currentOutline ? `\nCurrent outline:\n${currentOutline}` : '',
    source ? `\nSource material:\n${source}` : '',
  ].join('\n')
}

function groqModel(model) {
  return model || 'llama-3.3-70b-versatile'
}

function geminiModel(model) {
  return model || 'gemini-2.5-flash'
}

async function requestGroq({ source, instruction, currentOutline, apiKey, model }) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: groqModel(model),
      temperature: 0.25,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: buildUserPrompt({ source, instruction, currentOutline }),
        },
      ],
    }),
  })

  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload.error?.message || 'Groq request failed')
  }

  return cleanAIOutline(payload.choices?.[0]?.message?.content)
}

async function requestGemini({ source, instruction, currentOutline, apiKey, model }) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: buildUserPrompt({ source, instruction, currentOutline }) }],
          },
        ],
        generationConfig: {
          temperature: 0.25,
        },
      }),
    },
  )

  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload.error?.message || 'Gemini request failed')
  }

  return cleanAIOutline(payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim() || '')
}

export async function refineOutline({
  source,
  instruction,
  currentOutline,
  apiKey,
  model,
  provider = 'groq',
}) {
  if (apiKey) {
    if (provider === 'gemini') {
      return requestGemini({ source, instruction, currentOutline, apiKey, model })
    }
    return requestGroq({ source, instruction, currentOutline, apiKey, model })
  }

  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || ''
  const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)

  if (!apiBaseUrl && !isLocalHost) {
    throw new Error('Static deployment needs an API key in LLM API, or set VITE_API_BASE_URL to your proxy.')
  }

  const apiPrefix = apiBaseUrl.replace(/\/$/, '')
  const response = await fetch(`${apiPrefix}/api/refine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, instruction, currentOutline, model, provider }),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || 'Refine failed')
  return cleanAIOutline(payload.outline)
}

export async function refineNodeOutline({
  nodeOutline,
  fullOutline,
  instruction,
  apiKey,
  model,
  provider,
}) {
  const scopedInstruction = [
    'Edit ONLY the selected branch.',
    'First heading = selected root. Copy it EXACTLY.',
    'Never rename the root.',
    'Return that root plus its children only.',
    'User examples are instructions, not content.',
    'For explain requests: add 1-2 layers of concise factual child nodes.',
    instruction || 'Improve this branch while keeping it clear and editable.',
  ].join('\n')

  return refineOutline({
    source: fullOutline
      ? `Context outline for reference only. Do not rewrite unrelated nodes:\n${fullOutline}`
      : '',
    instruction: scopedInstruction,
    currentOutline: nodeOutline,
    apiKey,
    model,
    provider,
  })
}
