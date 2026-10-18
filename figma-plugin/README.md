# Kept for Figma

Your saved fonts and pairs from Kept, inside Figma.

- **Pairs:** apply a pair to selected text layers (Auto picks heading, body and caption by text size), insert a pair card, or create Figma text styles from a pair.
- **Fonts:** your bookmarked fonts, or every font Figma can use. Apply one to selected text (keeping bold as bold and italic as italic) or insert a full specimen.
- **Load from Kept:** in Kept, open Library → Backup → Download a backup, then load that file here. Bookmarks, pairs, notes and shelves come across. Loading again only adds what's new.

Everything is stored in Figma on your computer. Nothing is uploaded.

## Try it in Figma

1. Download this `figma-plugin` folder.
2. Open the **Figma desktop app** and any design file.
3. Menu → **Plugins → Development → Import plugin from manifest…** and pick `manifest.json` in this folder.
4. Run it from **Plugins → Development → Kept**.

## Files

| File | What it is |
|---|---|
| `manifest.json` | Plugin settings |
| `code.js` | Works on the canvas: reads fonts, applies them, inserts cards and styles |
| `ui.html` | The plugin window |

No build step: the files run as they are.

## Publishing

When it's ready: Plugins → Development → Kept → **Publish**. Figma assigns a real plugin ID (replace the placeholder `id` in `manifest.json` with it) and reviews the plugin before it appears in the Community.
