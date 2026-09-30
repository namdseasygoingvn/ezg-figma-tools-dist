---
name: ezg-figma-bridge
description: Use for live work in the Figma file the user has open through the ezg-figma-bridge MCP server, including the current selection and viewport, running Plugin API code, checkpoint and undo, export to disk, Dev Mode codegen snippets, and text review glossary rules.
---

# ezg-figma-bridge

Tools for the Figma file the user has open right now. The MCP tab of the EZG plugin must be running in that file.

## When to use

Use the bridge for:

- a live session in the open file
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

## eval

Arguments: `{fileKey, code, description, skillNames?, timeoutMs?}`.

- `code` is an async function body: top-level `await` and `return` work.
- Return node ids, not nodes. Nodes serialize to `{id, type, name}`.
- The result text is capped at 200,000 characters.

### Differences from use_figma

| topic                                          | in `eval`                                                   |
| ---------------------------------------------- | ----------------------------------------------------------- |
| `figma.notify`                                 | works                                                       |
| `setPluginData`                                | allowed                                                     |
| `loadAllPagesAsync`                            | allowed, but slow on big files                              |
| page reset per call                            | none; the user's view never jumps, so set the page yourself |
| atomic                                         | no; a failed script keeps its earlier changes               |
| `placeholder`                                  | does nothing                                                |
| `showUI`, `closePlugin`, `figma.ui`, listeners | blocked                                                     |
| `clientStorage` keys                           | get the prefix `eval/`                                      |

### Helpers

`query`, `matches`, `set`, `createAutoLayout` and `screenshot` are passed in as parameters; use them as plain functions. `placeholder` is not a parameter: it is only a no-op node property.

Prototype methods (`node.query(...)`) are best effort. When they are unavailable, `eval` adds a note (`prototypes: false`), and then only the parameter form works.

## Safety

- Call `checkpoint` before a large edit.
- One `eval` is one undo step. `undo` reverts to the last commit point, so it also undoes the user's own edit if they edited by hand after the `eval`.
- Keep evals small.
- Never write a synchronous infinite loop. A timeout only stops the wait; the plugin stays frozen.
- `eval` runs at once, so write a clear `description`.

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
