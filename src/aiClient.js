const systemPrompt = `You are a mind map editing assistant.
Only output a Markdown outline. Do not explain. Do not wrap the answer in a code block.
Required format:
# Root topic
## Main branch
### Sub branch
- Detail node
- Another detail node

Rules:
1. Heading and list nesting represent mind map hierarchy.
2. Keep every node short, clear, and easy to edit.
3. Avoid empty structural nodes like "Overview", "Summary", or "Conclusion".
4. When the user asks for a change, preserve unrelated branches and only revise the relevant part.
5. Images, links, and tasks may be represented as plain node text, such as [Image] screenshot note, [Link] URL, or [ ] task.`

function buildUserPrompt({ source, instruction, currentOutline }) {
  return [
    instruction
      ? `Editing request:\n${instruction}`
      : 'Convert the material into a clear, well-structured mind map.',
    currentOutline ? `\nCurrent outline:\n${currentOutline}` : '',
    source ? `\nSource material:\n${source}` : '',
  ].join('\n')
}

export async function refineOutline({
  source,
  instruction,
  currentOutline,
  apiKey,
  model,
}) {
  if (apiKey) {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || 'llama-3.3-70b-versatile',
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

    return payload.choices?.[0]?.message?.content?.trim() || ''
  }

  const response = await fetch('/api/refine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, instruction, currentOutline, model }),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || 'Refine failed')
  return payload.outline || ''
}

export async function refineNodeOutline({
  nodeOutline,
  fullOutline,
  instruction,
  apiKey,
  model,
}) {
  const scopedInstruction = [
    'You are refining exactly one selected mind map node branch.',
    'Only output the Markdown outline for that selected node branch.',
    'Do not output the full map.',
    'Keep the first heading as the selected node root.',
    instruction || 'Improve this branch while keeping it clear and editable.',
  ].join('\n')

  return refineOutline({
    source: fullOutline
      ? `Full map context for reference only. Do not rewrite it:\n${fullOutline}`
      : '',
    instruction: scopedInstruction,
    currentOutline: nodeOutline,
    apiKey,
    model,
  })
}
