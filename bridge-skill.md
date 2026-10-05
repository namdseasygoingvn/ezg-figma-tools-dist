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
6. `run` to chain steps 2, 4 and 5 in one call: `build`, then `lint` and `export` on the ids it returned.
7. `upload` to put local files or URLs into the file; the bytes never enter the chat.

8. `describe` to read a screen as a compact tree instead of writing an `eval` walker.
9. `fonts_check` before a build that uses fonts the user may not have.

Use `checkpoint` before a large edit, and `journal` to review what a session did. Several agents in one file: see Many agents, one file.

Results are compact JSON with no indentation. Failures that have a fix carry a code (see Error codes).

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
- Sessions take turns in one file, and calls from one session run in order. A long `eval` from another session delays you by at most its own run.

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

- The result carries `stats`: `elapsedMs`, `queueMs`, `createdCount`, `created` (first 200 ids) and `pageId`. `createdCount` and `created` list only nodes that still exist, so nodes you remove again do not count.
- `atomic: true` removes the nodes this call created when it fails. It never calls undo and never touches older nodes: edits to existing nodes stay, and the failure data lists the created ids that stayed (`kept`).
- `pageId` puts new top-level nodes on that page instead of the current one.
- A failure reports `line` and `column` (1-based) only when the error is in your code. An error inside a helper or in the bridge has no line, and no line is better than a wrong one.

## inventory

`{fileKey?, include?, pageIds?, name?, detail?}`. `include` is any of `pages`, `variables`, `styles`, `components` (default all). `name` filters item names by case-insensitive substring. Each call reads live data; sections past 2000 items are named in `truncated`. Remote library components are not included.

The default view is compact: variable ids and scopes, style ids and component descriptions are left out, and each component lists its properties as one line per property (`name: TYPE = default`, or the options for a variant). `detail` is a list that adds them back: `ids`, `scopes`, `descriptions`, `props` (full property objects with the keys `kit.props` needs). The result is capped near 20,000 characters; cut sections are named in `truncated`, so narrow with `name`, `include` or `pageIds` instead of asking for more.

It does not wait for other sessions' writes (see Read lane).

## build

`{fileKey?, parentId?, pageId?, nodes, atomic?, ids?, detail?, lint?, expect?, thumbnail?, owner?, async?, timeoutMs?}`. `nodes` is a tree of:

- `type`: FRAME, COMPONENT, COMPONENT_SET, SECTION, RECTANGLE, ELLIPSE, POLYGON, STAR, LINE, TEXT, INSTANCE
- `name`, `ref` (key for the returned `ids`; else the path such as `nodes[0].children[1]`)
- `props`: node properties, applied like `set`
- `layout`: `{mode, gap, padding, wrap, main, cross, width, height}`
- `bind`: alias to variable name, as in `kit.bind`
- `text`: `{chars, style?}` (TEXT); `component`, `setProps` (INSTANCE); `variants` (COMPONENT_SET)
- `children`

The result maps each `ref` to its node id in `ids` and lists the top-level ids in `roots`. `ids: "refs"` (default) returns only nodes that have a `ref`; `ids: "all"` returns every created node. So give a `ref` to every node you will touch again.

It is atomic by default: on failure the created nodes are removed. Before it creates anything, `build` checks every token, style, component and property name and lists all the problems at once, with candidates; nothing is created then, so fix them all in one go. Pass `lint` (same options as the `lint` tool, without node ids) to get a report for the new tree; it comes back as per-rule groups unless `detail: "full"` (see lint). Invalid specs fail up front with messages like `nodes[0].children[2]: ...`.

- `expect` is a list of checks run on the new tree: `no-overflow`, `fonts`, `bound-colors`, `text-styles` (they reuse the lint rules `overflow`, `missing-font`, `unbound-color`, `text-no-style`). The result adds `expect: {passed, failed: [{check, count, nodeIds}]}` with up to 20 ids per check. A failed check does not fail the build and nothing is removed: fix the listed nodes, or `undo`.
- `thumbnail: true` adds a small image (long side up to 512 px) of the first root to the result, so you see it without an `export`.
- `owner` is the label of your claim (see `claim`). A claimed parent of another owner makes the build fail with `CLAIMED`; nothing is created.

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

`{fileKey?, nodeIds?, pageIds?, rules?, options?, includeInstances?, limit?, fix?, detail?}`. With no `rules`, it runs the neutral defaults plus any rule that has `options`.

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

By default (`detail: "summary"`) the report has `checked`, `total` and `groups`, largest first: `{rule, count, examples, nodeIds}` with up to 3 examples (`nodeId`, `path`, `detail`) and the first 30 node ids per rule. Use the `nodeIds` to fix a whole rule at once. `detail: "full"` returns `counts` and every finding (`rule`, `nodeId`, `path`, `detail`) up to `limit`. Both have `truncated`. A `lint` without `fix` does not wait for other sessions' writes (see Read lane).

`fix` applies safe fixes in the same call (one undo step), then lints again. The report adds `fixes` (`fixed`, `skipped` with a reason).

| fix              | effect                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `clip: true`     | sets `clipsContent` false on `clip` findings                                                     |
| `styles: true`   | binds `unbound-color` and `text-no-style` nodes to the one local style with exactly equal values |
| `rename: {a: b}` | renames `generic-name` and `name-pattern` findings named exactly `a` to `b`                      |

Several matching styles, mixed values or several paints are skipped, not guessed. Project rules belong in your call arguments; the bridge knows none.

## journal

`{session?, since?, tool?, limit?}`. `session` is `current` (default), `all` or a session id. The journal lists time, tool, file, label, duration, ok, error head, byte sizes and stats of past calls. Stats keep `createdCount` but never the list of created ids. It never stores code or results. A `run` is one journal entry; its inner steps are not listed one by one. Set `EZG_FIGMA_BRIDGE_JOURNAL` to a path, or `off`.

## run

`{fileKey?, steps, continueOnError?, async?}`. Runs up to 20 steps in order in one call. A step is `{tool, args?, as?}`. `tool` is one of `eval`, `build`, `lint`, `inventory`, `export`, `upload`, `view_get`, `view_set`, `icons_search`, `icons_place`, `checkpoint`, `status`. Each step calls the same tool with the same validation, so its arguments are exactly that tool's arguments. A step takes the call's `fileKey` unless it sets its own.

- `as` names a step's result. A later string arg that is exactly `$name` or `$name.path.0.field` is replaced by that value from the result of the earlier step named `name`. Write `$$text` for a literal `$text`. A ref to an unknown name or path fails that step.
- The run stops at the first failing step; `continueOnError: true` keeps going. A failed run is an error result that still holds every step's outcome.
- The result is `{steps: [{tool, as?, ok, ms, result | error}]}`. Each step is cut near 20,000 characters, but `as` refs see the full result. Images that steps return (for example from `export`) come back too.

```json
{
  "steps": [
    {
      "tool": "build",
      "as": "b",
      "args": { "nodes": [{ "type": "FRAME", "name": "Card", "ref": "card" }] }
    },
    { "tool": "lint", "args": { "nodeIds": ["$b.roots.0"] } },
    {
      "tool": "export",
      "args": {
        "nodeIds": ["$b.ids.card"],
        "format": "PNG",
        "outDir": "/tmp/out"
      }
    }
  ]
}
```

Use `run` when the next step does not need your judgment. If a step's output decides what to do next, call the tools one by one.

## upload

`{fileKey?, paths?, urls?, mode?, nodeId?, parentId?, pageId?, scaleMode?, owner?, async?}`. Puts files into the open file. The server reads the bytes, so only paths and URLs pass through the chat.

- Sources: `paths` are absolute paths on the machine that runs Claude Code; `urls` are `http` or `https`. PNG, JPG, GIF and SVG, up to 32 MB each and 20 sources per call. Give at least one source.
- `mode: "node"` (default) makes one node per source: a rectangle with an image fill, or vector nodes for SVG, under `parentId` or on `pageId` (default the current page).
- `mode: "fill"` sets one image as the fill of the existing node `nodeId`, and takes exactly one source. `scaleMode` is `FILL`, `FIT`, `CROP` or `TILE`.
- The result is `{placed: [{name, nodeId, ...}], failed: [{name, error}]}`. A source that cannot be read or placed is in `failed`; the call succeeds if at least one is placed.
- `owner` is the label of your claim, as in `build`. A parent (or, for `fill`, a `nodeId`) claimed by another owner fails with `CLAIMED`.
- An old plugin answers `unknown op: upload`; ask the user to reopen the EZG Tools plugin.

## Many agents, one file

Several agents (for example subagents of one Claude Code session) can work in one file. They share one MCP server, so the `owner` label tells them apart.

1. Lead agent: `inventory`, `fonts_check`, then create one frame (or page) per worker.
2. Each worker: `claim` its frame with a unique `owner`. Pass the same `owner` to `build` and `upload`. Read with `describe`. Batch steps with `run`. Run long steps with `async` and `job_wait`.
3. Figma still runs one write at a time per file. Parallel agents save model time, not Figma time.
4. Never export in parallel. Check `status.exportStuck` first.

`eval` is not claim-checked: it can edit anything. Stay inside your own claim by hand.

## claim

`{fileKey?, nodeIds, owner, ttlMs?, release?}`. Holds frames or pages so other agents cannot `build` or `upload` into them. `owner` is required and must be unique per agent; a claim belongs to the owner label within one session.

- The result is `{granted, conflicts, claims}`. A node held by another owner is in `conflicts` (with `owner` and `expiresInMs`) and is not granted. `claims` lists yours.
- A claim covers the node and everything under it. Claim the top frame of your work.
- A claim expires after `ttlMs` (default 10 min, max 60 min). A successful `build` or `upload` with your `owner` renews it. The plugin is not told when a session ends, so rely on the expiry.
- `release: true` gives up the listed nodes.
- Only `build` and `upload` check claims. They fail with `CLAIMED`, and nothing is created.

## describe

`{fileKey?, nodeIds, depth?, maxNodes?}`. Reads 1 to 20 nodes as a compact tree: `id`, `name`, `type`, `box` `[x, y, w, h]`, `layout`, `fill` and `stroke` (variable name, hex, `image` or `N fills`), `radius`, `text` (up to 80 characters, `style`, `font`), `component` and `props` for instances, `children`. Use it before editing a screen instead of writing an `eval` walker.

- `depth` defaults to 3, max 8. `maxNodes` defaults to 300, max 2000.
- `more` on a node counts children not shown; `truncated` is true when `maxNodes` cut the tree. Call `describe` again on the child ids to go deeper.
- It is a read: it does not wait for other sessions' writes (see Read lane).

## fonts_check

`{fileKey?, fonts?, nodeIds?, textStyles?}`. Gives at least one source: `fonts` as `"Family Style"` strings, text nodes under `nodeIds`, and `textStyles: true` for the file's local text styles. The result is `{needed, missing, availableCount}`. `missing` lists fonts this Figma user does not have. The bridge cannot install fonts: pick another font or ask the user. Call it before a `build` that sets fonts.

## async and job_wait

`eval`, `build`, `export`, `upload` and `run` accept `async: true`. The call returns `{jobId, tool}` at once and the work goes on in the queue.

- `job_wait` `{jobId, timeoutMs?}` returns the job's own result with a first note `job j3 (eval) took 4.2 s`. After `timeoutMs` (default 60 s, max 120 s) it answers `{jobId, state: "running", ms}`: call it again.
- Jobs live in server memory for 30 min, at most 50. A server restart loses them. An unknown id is an error (`no job j3 ...`).
- `async` does not change the order: calls still run one at a time per file. Use it so a long step does not hold your turn.

## Read lane

`inventory` and `lint` without `fix` run at once, not in the write queue, so they answer while another session's `eval` is running. They can see that `eval`'s half-finished state. If you need a settled view, call `status` until `busy` is false, then read. `lint` with `fix` is a write and queues.

## status

`{fileKey?}`. Answers at once, outside the plugin queue. `busy` is true while any call from any session is queued or running. `queueDepth` counts them. `jobs` lists each one with `op`, `state` (`queued`, `running`, `cancelling`), `waitMs`, `runMs`, `created` and `last` (the last `figma`, `kit` or helper call); `mine` marks this session's calls. `recent` lists the last 20 finished calls with `outcome` (`ok`, `late`, `failed`, `cancelled`, `rolled-back`) and created ids.

If `status` shows `exportStuck`, a render in the plugin has hung. Do not retry exports. Ask the user to close and reopen the EZG Tools plugin.

Raw WebSocket clients also get `queue: {depth, waitMs}` on every reply frame, and can send op `cancel` with `{id}` (their own request id).

## icons

`icons_search`, `icons_place` and `icons_tag` use the shared EZG icon library. Their tool descriptions are the full guide.

## Error codes

A failure with a known fix prints as `[CODE] message`, then `Fix: ...`. Follow the fix before you retry.

| code                  | fix                                                                                |
| --------------------- | ---------------------------------------------------------------------------------- |
| `TOKEN_NOT_FOUND`     | Use a name from `inventory` variables; see the close names.                        |
| `TOKEN_AMBIGUOUS`     | Pass the collection: `kit.token(name, collection)`.                                |
| `STYLE_NOT_FOUND`     | Use a style name from `inventory` styles.                                          |
| `COMPONENT_NOT_FOUND` | Use a component name from `inventory` components.                                  |
| `PROP_NOT_FOUND`      | Use a property from `inventory` components `props`.                                |
| `FONT_LOAD_FAILED`    | The font is not installed for this user; pick another or ask them to install.      |
| `EXPORT_STUCK`        | Ask the user to close and reopen the EZG Tools plugin; do not retry exports.       |
| `BUILD_SPEC_INVALID`  | Fix every listed problem, then call `build` again.                                 |
| `UPLOAD_UNSUPPORTED`  | Use PNG, JPG, GIF or SVG.                                                          |
| `CLAIMED`             | Another agent holds this part of the file; work in your own claimed frame or wait. |
| `FONT_MISSING`        | Install the font or choose an available one (`fonts_check` lists them).            |

Errors without a code are plain messages.

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
- Never call `exportAsync` or `screenshot` in `Promise.all`. Renders run one at a time per file, so `await` them in a loop.

## See and change the view

- `view_get` returns the page, the selection and the viewport.
- `view_set` can select nodes, change page, focus, zoom and notify.
- `ui_screenshot` returns a PNG of the EZG Tools plugin window content, not the canvas. Optional `scale` and an absolute `outPath` ending in `.png`.
- It needs a plugin build that has the tool. An old plugin answers `unknown op`.

## Export

`export` takes `nodeIds` (at most 50 per call), `format` (PNG, JPG, SVG, PDF, JSON), optional `scale` (PNG and JPG only) and `outDir`. Options:

- `contentsOnly` and `useAbsoluteBounds` are passed to Figma's export settings.
- `width` or `height` (PNG and JPG only; not both) sets the output size and replaces `scale`.
- `colorProfile` is `DOCUMENT`, `SRGB` or `DISPLAY_P3_V4`.
- `warnings` in the result lists nodes that need a look: a hidden node, or a raster file under 1 KiB (likely empty).

- `outDir` is an absolute path. Use a fresh folder: files with the same name are overwritten.
- A single export may be large (a 4x screen is tens of MB). Frames over the WebSocket limit travel in parts; this is automatic.
- The server writes the files and returns `{outDir, written: [{nodeId, path, bytes}], failed: [{nodeId, error}], warnings?: [{nodeId, warning}]}`.
- A node that cannot be exported is in `failed`, not `written`. The call still succeeds if at least one node was written.
- More than 50 `nodeIds` is rejected. Split the call.
- Bytes never enter the chat.
- Renders run one at a time per file, but the server writes one file while the plugin renders the next (at most 2 requests in flight), so many nodes in one call is the fast path. Do not start a second export or `screenshot` to speed it up, and do not retry one that is slow; check `status` instead.
- The raw plugin op `export` (WebSocket) has no `outDir` and writes no files. It returns `{files: [{nodeId, name, format, base64 | text}], failed: [{nodeId, error}], warnings?}`: `base64` for PNG, JPG and PDF, `text` for SVG and JSON. Every row in `files` has data; every error is in `failed`.

## Watch mode

- `events` polls with a `since` cursor.
- `wait` long-polls (default 120 s). Loop on it instead of passing a huge `timeoutMs`, and pass back the returned `nextSeq`. An empty answer prints it as `since: N`.
- After a `close` event or a new server, restart `since` at 0.
- If `dropped` is true, re-read the state with `view_get`.
- `watch` with `document: true` turns on document-wide changes. It is costly; turn it off after.

## Codegen and glossary

- `codegen_set` stores snippets on a node, shown in Dev Mode under the language "MCP". It is stored, not generated live, so set it after the design is final. Snippets are shared plugin data on the node: anyone opening the file sees them.
- `glossary_get` and `glossary_set` read and replace the whole rule list for text review. The list is the current user's only, not team-shared. Always call `glossary_get` first and send back the merged list.
