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
4. `lint` the nodes you touched. Fix findings, then lint again.
5. `screenshot` (inside `eval`) or `export` to look at the result.

Use `checkpoint` before a large edit, and `journal` to review what a session did.

## eval

Arguments: `{fileKey, code, description, skillNames?, timeoutMs?, atomic?, pageId?}`.

- `code` is an async function body: top-level `await` and `return` work. It runs in an inner function, so `const set = ...` or `const kit = ...` in your code is legal.
- Return node ids, not nodes. Nodes serialize to `{id, type, name}`.
- The result text is capped at 200,000 characters.

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
| `component(nameOrId)`                          | component or set, current page first; throws with candidates                                                          |
| `instance(target, {props?, parent?, name?})`   | instance of a set's default variant, then `props`                                                                     |
| `props(instance, map)`                         | set component properties by friendly name; `"Child/Prop"` targets a nested instance                                   |
| `main(instance)`                               | main component via `getMainComponentAsync`                                                                            |
| `variants(components, opts?)`                  | combine into a set, grid layout (`cols`, `gap`, `padding`), `strip` clears set fills and strokes                      |
| `autoLayout(dir?, props?)`                     | auto layout frame, like `createAutoLayout`                                                                            |

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

`{fileKey?, nodeIds?, pageIds?, rules?, options?, includeInstances?, limit?}`. With no `rules`, it runs the neutral defaults plus any rule that has `options`.

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

The report has `checked`, `counts`, `findings` (`rule`, `nodeId`, `path`, `detail`) and `truncated`. Project rules belong in your call arguments; the bridge knows none.

## journal

`{session?, since?, tool?, limit?}`. `session` is `current` (default), `all` or a session id. The journal lists time, tool, file, label, duration, ok, error head, byte sizes and stats of past calls. It never stores code or results. Set `EZG_FIGMA_BRIDGE_JOURNAL` to a path, or `off`.

## Safety

- Call `checkpoint` before a large edit.
- One `eval` is one undo step. `undo` reverts to the last commit point, so it also undoes the user's own edit if they edited by hand after the `eval`.
- Keep evals small.
- Never write a synchronous infinite loop. A timeout only stops the wait; the plugin stays frozen.
- `eval` runs at once, so write a clear `description`.

## Gotchas

- Call `await page.loadAsync()` before reading a non-current page's children.
- Use `getMainComponentAsync()`; the sync `mainComponent` throws.
- Style ids can end with `,`. Pass them through as given.
- For a rotated node, `x` and `y` are the pre-rotation origin.
- `figma.createText()` defaults to Inter; load the font before setting `characters`, or use `kit.text`.
- Instances made with `createInstance()` or `clone()` in raw code are not tracked for `atomic` rollback. Make them through `kit`.
- Remote library components are not in `inventory`.

## See and change the view

- `view_get` returns the page, the selection and the viewport.
- `view_set` can select nodes, change page, focus, zoom and notify.

## Export

`export` takes `nodeIds`, `format` (PNG, JPG, SVG, PDF, JSON), optional `scale` (PNG and JPG only) and `outDir`.

- `outDir` is an absolute path. Use a fresh folder: files with the same name are overwritten.
- The server writes the files and returns their paths and any per-node failures.
- Bytes never enter the chat.

## Watch mode

- `events` polls with a `since` cursor.
- `wait` long-polls (default 120 s). Loop on it instead of passing a huge `timeoutMs`, and pass back the returned `nextSeq`. An empty answer prints it as `since: N`.
- After a `close` event or a new server, restart `since` at 0.
- If `dropped` is true, re-read the state with `view_get`.
- `watch` with `document: true` turns on document-wide changes. It is costly; turn it off after.

## Codegen and glossary

- `codegen_set` stores snippets on a node, shown in Dev Mode under the language "MCP". It is stored, not generated live, so set it after the design is final. Snippets are shared plugin data on the node: anyone opening the file sees them.
- `glossary_get` and `glossary_set` read and replace the whole rule list for text review. The list is the current user's only, not team-shared. Always call `glossary_get` first and send back the merged list.
