---
name: ezg-figma-bridge
description: Use for live work in the Figma file the user has open through the ezg-figma-bridge MCP server, including the current selection and viewport, running Plugin API code, checkpoint and undo, export to disk, Dev Mode codegen snippets, and text review glossary rules.
---

# ezg-figma-bridge

Tools for the Figma file the user has open right now. The MCP tab of the EZG plugin must be running in that file.

## When to use

Use the bridge for:

- a live session in the open file
- reading the file's tokens, styles and components, linting it, or building node trees
- the user's current selection or viewport
- events (what changed since the last look)
- exporting nodes to disk on this machine
- plugin data, and big files
- Dev Mode codegen snippets and text review rules

Keep using the official Figma MCP server for `get_design_context`, `search_design_system`, `get_libraries`, `upload_assets`, `create_new_file`, `generate_figma_design`, Code Connect, FigJam and Slides.

## Before you write code

Load the `figma-use` skill first for Plugin API rules; this file only covers what differs. If the `figma-use` skill is not available, use the official MCP resource `skill://figma/figma-use/SKILL.md`.

## Connect

1. Call `files`. It lists every connected file.
2. If it shows none, ask the user to press "Kết nối tới MCP server" in the MCP tab.

`fileKey` in a tool call may be a `fileKey` or a `clientId`. With exactly one connected file it may be omitted. Any number of Claude sessions can use the same file at once.

The port defaults to 39410. To use another port (39410–39419), set `EZG_FIGMA_BRIDGE_PORT` in the MCP server config and the same number in the MCP tab.

## Fast path

1. `inventory` once: pages, variables, styles, components with property keys.
2. `build` for any new tree of nodes. It binds tokens and styles by name, and is atomic.
3. `eval` with `kit` for edits, instances and anything `build` cannot express.
4. `lint` the nodes you touched. Use `fix` for the simple findings; fix the rest, then lint again.
5. `screenshot` (inside `eval`) or `export` to look at the result.

Use `checkpoint` before a large edit, and `journal` to review what a session did.

## eval

Arguments: `{fileKey?, code, description, skillNames?, timeoutMs?, atomic?, pageId?, args?}`.

- `code` is an async function body: top-level `await` and `return` work. It runs in an inner function, so `const set = ...` or `const kit = ...` in your code is legal.
- `args` is any JSON value, up to 8,000,000 characters, separate from the 50,000-character code cap. The code reads it as `args`. Pass build specs, ids and base64 images there, not in `code`; `figma.createImage(figma.base64Decode(args.png))` turns a base64 PNG into an image.
- Return node ids, not nodes. Nodes serialize to `{id, type, name}`; plain objects keep every field.
- The result text is capped at 200,000 characters.

### Timeout and cancel

- At `timeoutMs` the call is cancelled. Every `figma`, `kit` and helper call checks for this, so the code stops at its next such call. A long loop with no such call can check `signal.cancelled` or call `signal.throwIfCancelled()`.
- If the code stops within 10 s, `atomic: true` removes what it created, and the error gives the elapsed time, the last `figma`, `kit` or helper call and the created count. If it finishes within those 10 s, the result comes back with `lateMs` in its stats.
- If it does not stop within 10 s, the error says it is still running. Call `status` until `busy` is false, then read its outcome in `recent` before you retry.
- If the plugin sends no reply or progress at all, the server times out the call and sends a cancel itself.
- Stats give `queueMs` and `queueDepth` (calls ahead of this one, from every session) and `slowFonts` (font loads over 3 s).

### Differences from use_figma

| topic                                          | in `eval`                                                   |
| ---------------------------------------------- | ----------------------------------------------------------- |
| `figma.notify`                                 | works                                                       |
| `setPluginData`                                | allowed                                                     |
| `loadAllPagesAsync`                            | allowed, but slow on big files                              |
| page reset per call                            | none; the user's view never jumps, so set the page yourself |
| atomic                                         | only with `atomic: true` (see below); default keeps changes |
| `placeholder`                                  | does nothing                                                |
| `showUI`, `closePlugin`, `figma.ui`, listeners | blocked                                                     |
| `clientStorage` keys                           | get the prefix `eval/`                                      |

### Helpers

`query`, `matches`, `set`, `createAutoLayout`, `screenshot` and `kit` are passed in as parameters; use them as plain functions. `placeholder` is not a parameter: it is only a no-op node property.

Prototype methods (`node.query(...)`) are best effort. When they are unavailable, `eval` adds a note (`prototypes: false`), and then only the parameter form works.

### kit

One `kit` per `eval`. Every node it creates is tracked for `atomic` and stats.

| member                                         | does                                                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `token(name, collection?)`                     | variable by exact name; throws with candidates when missing or ambiguous                                              |
| `bind(node, map)`                              | bind variables by alias: `fill`, `stroke`, `radius`, `strokeWeight`, `gap`, `padding`, `paddingX`, ... or a raw field |
| `style(kind, nameOrId)`                        | text, paint, effect or grid style                                                                                     |
| `text({chars, style?, parent?, name?, fill?})` | create text; loads the style's font first                                                                             |
| `setText(node, chars)`                         | loads every font in the node, then sets characters                                                                    |
| `loadFonts([{family, style}])`                 | preload fonts in one call                                                                                             |
| `component(nameOrId)`                          | component or set, current page first; throws with candidates                                                          |
| `instance(target, {props?, parent?, name?})`   | instance of a set's default variant, then `props`                                                                     |
| `props(instance, map)`                         | set component properties by friendly name; `"Child/Prop"` targets a nested instance                                   |
| `main(instance)`                               | main component via `getMainComponentAsync`                                                                            |
| `variants(components, opts?)`                  | combine into a set, grid layout (`cols`, `gap`, `padding`), `strip` clears set fills and strokes                      |
| `autoLayout(dir?, props?)`                     | auto layout frame, like `createAutoLayout`                                                                            |

Fonts load once per plugin session, so `kit.text`, `kit.setText`, text properties in `kit.props` and `figma.loadFontAsync` in `eval` all share one cache.

```js
const card = kit.autoLayout("VERTICAL", { name: "Card", itemSpacing: 8 })
await kit.bind(card, { fill: "color/surface", radius: "radius/md" })
await kit.text({
  chars: "Title",
  style: "Heading/M",
  parent: card,
  name: "Title",
})
return card.id
```

### Stats, atomic, pageId

- The result carries `stats`: `elapsedMs`, `queueMs`, `createdCount`, `created` (first 200 ids) and `pageId`.
- `atomic: true` removes the nodes this call created when it fails. It never calls undo and never touches older nodes: edits to existing nodes stay, and the failure data lists the created ids that stayed (`kept`).
- `pageId` puts new top-level nodes on that page instead of the current one.
- A failure reports `line` and `column` in your code (1-based).

## inventory

`{fileKey?, include?, pageIds?, name?}`. `include` is any of `pages`, `variables`, `styles`, `components` (default all). `name` filters item names by case-insensitive substring. Components list their property keys, types, defaults and variant options. Each call reads live data; sections past 2000 items are named in `truncated`. Remote library components are not included.

## build

`{fileKey?, parentId?, pageId?, nodes, atomic?, lint?, timeoutMs?}`. `nodes` is a tree of:

- `type`: FRAME, COMPONENT, COMPONENT_SET, SECTION, RECTANGLE, ELLIPSE, POLYGON, STAR, LINE, TEXT, INSTANCE
- `name`, `ref` (key for the returned `ids`; else the path such as `nodes[0].children[1]`)
- `props`: node properties, applied like `set`
- `layout`: `{mode, gap, padding, wrap, main, cross, width, height}`
- `bind`: alias to variable name, as in `kit.bind`
- `text`: `{chars, style?}` (TEXT); `component`, `setProps` (INSTANCE); `variants` (COMPONENT_SET)
- `children`

It is atomic by default: on failure the created nodes are removed. Pass `lint` (same options as the `lint` tool, without node ids) to get a report for the new tree. Invalid specs fail up front with messages like `nodes[0].children[2]: ...`.

```json
{
  "nodes": [
    {
      "type": "FRAME",
      "name": "Card",
      "ref": "card",
      "layout": { "mode": "VERTICAL", "gap": 8, "padding": 16 },
      "bind": { "fill": "color/surface" },
      "children": [
        {
          "type": "TEXT",
          "name": "Title",
          "text": { "chars": "Title", "style": "Heading/M" }
        }
      ]
    }
  ]
}
```

## lint

`{fileKey?, nodeIds?, pageIds?, rules?, options?, includeInstances?, limit?, fix?}`. With no `rules`, it runs the neutral defaults plus any rule that has `options`.

- Default rules: `generic-name`, `unbound-color`, `text-no-style`, `missing-font`, `variant-conflict`.
- Opt-in rules (name them in `rules` or pass `options`):

| rule             | option                                                   |
| ---------------- | -------------------------------------------------------- |
| `name-pattern`   | `{pattern, flags?, types?}`                              |
| `clip`           | `{allow?}` regex of names allowed to clip                |
| `safe-zone`      | `{top?, bottom?, left?, right?, frame?, types?, names?}` |
| `grid-style`     | `{styleId?, frame?}`                                     |
| `unbound-number` | `{fields?}`                                              |
| `overflow`       | `{tolerance?}`                                           |
| `reuse`          | `{min?}`                                                 |

The report has `checked`, `counts`, `findings` (`rule`, `nodeId`, `path`, `detail`) and `truncated`.

`fix` applies safe fixes in the same call (one undo step), then lints again. The report adds `fixes` (`fixed`, `skipped` with a reason).

| fix              | effect                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `clip: true`     | sets `clipsContent` false on `clip` findings                                                     |
| `styles: true`   | binds `unbound-color` and `text-no-style` nodes to the one local style with exactly equal values |
| `rename: {a: b}` | renames `generic-name` and `name-pattern` findings named exactly `a` to `b`                      |

Several matching styles, mixed values or several paints are skipped, not guessed. Project rules belong in your call arguments; the bridge knows none.

## journal

`{session?, since?, tool?, limit?}`. `session` is `current` (default), `all` or a session id. The journal lists time, tool, file, label, duration, ok, error head, byte sizes and stats of past calls. It never stores code or results. Set `EZG_FIGMA_BRIDGE_JOURNAL` to a path, or `off`.

## status

`{fileKey?}`. Answers at once, outside the plugin queue. `busy` is true while any call from any session is queued or running. `queueDepth` counts them. `jobs` lists each one with `op`, `state` (`queued`, `running`, `cancelling`), `waitMs`, `runMs`, `created` and `last` (the last `figma`, `kit` or helper call); `mine` marks this session's calls. `recent` lists the last 20 finished calls with `outcome` (`ok`, `late`, `failed`, `cancelled`, `rolled-back`) and created ids.

Raw WebSocket clients also get `queue: {depth, waitMs}` on every reply frame, and can send op `cancel` with `{id}` (their own request id).

## icons

`icons_search`, `icons_place` and `icons_tag` use the shared EZG icon library. Their tool descriptions are the full guide.

## Safety

- Call `checkpoint` before a large edit.
- One `eval` is one undo step. `undo` reverts to the last commit point, so it also undoes the user's own edit if they edited by hand after the `eval`.
- Keep evals small.
- Never write a synchronous infinite loop. Cancel only acts at a `figma`, `kit` or helper call, so a loop with none freezes the plugin.
- `eval` runs at once, so write a clear `description`.

## Gotchas

- Call `await page.loadAsync()` before reading a non-current page's children.
- Use `getMainComponentAsync()`; the sync `mainComponent` throws. `query` selectors and `values()` reject `mainComponent`.
- Style ids can end with `,`. Pass them through as given.
- For a rotated node, `x` and `y` are the pre-rotation origin.
- `figma.createText()` defaults to Inter; load the font before setting `characters`, or use `kit.text`.
- Instances made with `createInstance()` or `clone()` in raw code are not tracked for `atomic` rollback. Make them through `kit`.
- Remote library components are not in `inventory`.

## See and change the view

- `view_get` returns the page, the selection and the viewport.
- `view_set` can select nodes, change page, focus, zoom and notify.
- `ui_screenshot` returns a PNG of the EZG Tools plugin window content, not the canvas. Optional `scale` and an absolute `outPath` ending in `.png`.
- It needs a plugin build that has the tool. An old plugin answers `unknown op`.

## Export

`export` takes `nodeIds` (at most 50 per call), `format` (PNG, JPG, SVG, PDF, JSON), optional `scale` (PNG and JPG only) and `outDir`.

- `outDir` is an absolute path. Use a fresh folder: files with the same name are overwritten.
- The server writes the files and returns `{outDir, written: [{nodeId, path, bytes}], failed: [{nodeId, error}]}`.
- A node that cannot be exported is in `failed`, not `written`. The call still succeeds if at least one node was written.
- More than 50 `nodeIds` is rejected. Split the call.
- Bytes never enter the chat.
- The raw plugin op `export` (WebSocket) has no `outDir` and writes no files. It returns `{files: [{nodeId, name, format, base64 | text}], failed: [{nodeId, error}]}`: `base64` for PNG, JPG and PDF, `text` for SVG and JSON. Every row in `files` has data; every error is in `failed`.

## Watch mode

- `events` polls with a `since` cursor.
- `wait` long-polls (default 120 s). Loop on it instead of passing a huge `timeoutMs`, and pass back the returned `nextSeq`. An empty answer prints it as `since: N`.
- After a `close` event or a new server, restart `since` at 0.
- If `dropped` is true, re-read the state with `view_get`.
- `watch` with `document: true` turns on document-wide changes. It is costly; turn it off after.

## Codegen and glossary

- `codegen_set` stores snippets on a node, shown in Dev Mode under the language "MCP". It is stored, not generated live, so set it after the design is final. Snippets are shared plugin data on the node: anyone opening the file sees them.
- `glossary_get` and `glossary_set` read and replace the whole rule list for text review. The list is the current user's only, not team-shared. Always call `glossary_get` first and send back the merged list.
