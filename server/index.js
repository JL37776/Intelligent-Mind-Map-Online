import 'dotenv/config'
import express from 'express'
import Groq from 'groq-sdk'

const app = express()
const port = Number(process.env.PORT || 8787)

app.use(express.json({ limit: '2mb' }))

const systemPrompt = `You are a mind map editing assistant.
Only output a Markdown outline. Do not explain. Do not wrap the answer in a code block.
Required format:
# Root topic [!important]
> Summary: Optional one-line node summary.
## Main branch
### Sub branch [!plain]
- Detail node [!muted]
- [Link] URL
- [ ] task
- [Image] visual note

Rules:
1. Heading and list nesting represent mind map hierarchy.
2. Keep every node short, clear, and easy to edit.
3. Avoid empty structural nodes like "Overview", "Summary", or "Conclusion".
4. When the user asks for a change, preserve unrelated branches and only revise the relevant part.
5. Use [!important], [!plain], or [!muted] at the end of a node when emphasis matters.
6. Put summaries on the line after the node as "> Summary: ...".
7. Images, links, and tasks may be represented as plain node text, such as [Image] screenshot note, [Link] URL, or [ ] task.`

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

  return completion.choices?.[0]?.message?.content?.trim() || ''
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

  return payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim() || ''
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
