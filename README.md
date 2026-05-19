# Intelligent AI Mind Map

A local-first demo for turning ChatGPT notes into an editable mind map.

## What it does

- Paste Markdown notes or a simple outline.
- Generate an editable Mind Elixir map.
- Refine the current map through a tiny Groq proxy.
- Edit nodes manually with Mind Elixir shortcuts and drag-and-drop.
- Apply visual skeleton presets without changing Markdown.
- Mark selected nodes as Important, Plain, or Muted.
- Insert screenshots into selected nodes with the Image button or by pasting from the clipboard.
- Save maps locally in IndexedDB.
- Auto-save the active project after changes and on a timed interval.
- Restore the last active project and show recent projects.
- Export PNG, Markdown, and JSON.

## AI format

The AI format is intentionally simple Markdown:

```md
# Root topic
## Main branch
### Sub branch
- Detail node
- Another detail node
```

This makes future AI edits easy. You can ask for changes such as:

```text
Make the pricing branch more concrete, keep everything else the same.
```

Visual styles are deliberately decoupled from Markdown. Markdown controls only
the node hierarchy. Skeleton presets and node emphasis are stored on the mind map
JSON as node metadata/style, so exported Markdown stays clean.

## Run

```bash
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

## Optional Groq setup

Copy `.env.example` to `.env` and set:

```text
GROQ_API_KEY=your_groq_api_key_here
```

The frontend calls `/api/refine`, and the local server keeps the API key out of the browser.

You can also paste a Groq API key into the app's API access panel for a temporary
session. When a key is present, the static frontend can call Groq directly, which
is useful for GitHub Pages deployment. Without a key in the UI, local development
falls back to `/api/refine`.

## Local persistence

The app is local-first. Projects are stored in browser IndexedDB, while the last
active project id is stored in localStorage. This works on static hosting such as
GitHub Pages and does not require a backend for saving, restoring, or recent
projects.

## GitHub Pages

This app can run as a static GitHub Pages site. For AI refine on Pages, enter a
Groq API key in the collapsed `LLM API` panel. Local save, auto-save, recent
projects, screenshots, themes, and prompt presets all stay in the browser.
