import 'dotenv/config'
import express from 'express'
import Groq from 'groq-sdk'

const app = express()
const port = Number(process.env.PORT || 8787)

app.use(express.json({ limit: '2mb' }))

const systemPrompt = `Return ONLY a Markdown mind-map outline.
No prose. No code fence. No <think>. No reasoning.
Use only: #, ##, ###, nested "- ", optional "> Summary:", optional [!important]/[!plain]/[!muted].
Preserve unrelated nodes.
Do not invent facts, links, images, citations, or tasks.
No placeholders: New Node, Keyword, 关键词, 结构, 机构, Example, xxx.`

function cleanAIOutline(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
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

async function requestGroq({ apiKey, model, userPrompt }) {
  const groq = new Groq({ apiKey })
  const completion = await groq.chat.completions.create({
    model: model || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    temperature: 0.25,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  })

  return cleanAIOutline(completion.choices?.[0]?.message?.content)
}

async function requestGemini({ apiKey, model, userPrompt }) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model || process.env.GEMINI_MODEL || 'gemini-2.5-flash'}:generateContent`,
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
            parts: [{ text: userPrompt }],
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
    throw new Error(payload.error?.message || 'Gemini request failed.')
  }

  return cleanAIOutline(payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim() || '')
}

app.post('/api/refine', async (req, res) => {
  const {
    source = '',
    instruction = '',
    currentOutline = '',
    apiKey = '',
    model = '',
    provider = 'groq',
  } = req.body || {}
  const resolvedProvider = provider === 'gemini' ? 'gemini' : 'groq'
  const resolvedApiKey =
    apiKey ||
    (resolvedProvider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.GROQ_API_KEY)

  if (!resolvedApiKey) {
    return res.status(400).json({
      error: `No ${resolvedProvider === 'gemini' ? 'Gemini' : 'Groq'} API key. Enter one in API access or set it in .env.`,
    })
  }

  if (!source.trim() && !currentOutline.trim()) {
    return res.status(400).json({ error: 'source or currentOutline is required.' })
  }

  const userPrompt = buildUserPrompt({ source, instruction, currentOutline })

  try {
    const outline = resolvedProvider === 'gemini'
      ? await requestGemini({ apiKey: resolvedApiKey, model, userPrompt })
      : await requestGroq({ apiKey: resolvedApiKey, model, userPrompt })

    res.json({ outline })
  } catch (error) {
    res.status(500).json({ error: error.message || 'AI request failed.' })
  }
})

app.listen(port, () => {
  console.log(`AI mind map proxy listening on http://127.0.0.1:${port}`)
})
