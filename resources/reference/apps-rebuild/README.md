# /apps rebuild — before and target

Before = the code when the rebuild started (commit 5571c7e). Target = the web plan, the service design, and the finished CLI code.

Open each collection in the running Canvas app:

- 0 · Overview — http://127.0.0.1:5174/?collection=rebuild-0-overview
- 1a · Web journeys: open, add, connect — http://127.0.0.1:5174/?collection=rebuild-1a-web-journeys
- 1b · Web journeys: drag, undo — http://127.0.0.1:5174/?collection=rebuild-1b-web-journeys
- 2a · Web folders and big files — http://127.0.0.1:5174/?collection=rebuild-2a-web-folders
- 2b · Web: how a click runs, the machines, IDs — http://127.0.0.1:5174/?collection=rebuild-2b-web-how-it-runs
- 3 · Service — http://127.0.0.1:5174/?collection=rebuild-3-service
- 4 · CLI — http://127.0.0.1:5174/?collection=rebuild-4-cli
- 5a · What changes for you: web — http://127.0.0.1:5174/?collection=rebuild-5a-web-changes
- 5b · What changes for you: service and CLI, and what stays the same — http://127.0.0.1:5174/?collection=rebuild-5b-service-cli-changes

To load a collection into another workspace: `pnpm canvas create resources/reference/apps-rebuild/<file>.canvas --server http://127.0.0.1:PORT --workspace PATH`.
