# Message board

A React and TypeScript application using BFF's public HTTP API. This example has
its own Vite development server, build, tests, and dependencies. It does not
import the platform's service or account UI implementations.

Run from the repository root:

```sh
npm ci
npm run dev:message-board
npm run test:message-board
npm run build:message-board
```

To serve both the BFF dashboard and this example with a local backend, run
`npm run dev:web:local` from the repository root (or `npm run dev:local` from
`apps/web`). Open `/bff/app/` for the dashboard and `/bff/demo/` for this app on
the same Vite server. A separate message-board development server is unnecessary.

For just the standalone example, run `npm run dev:local` from this directory,
or `npm run dev:message-board -- --mode local-api` from the repository root. This
mode uses its separate project ID and public key from `src/config.ts`; the local
backend must have the matching project, the example migrations (including
`004_message_titles.sql`), and the required `messages` and `boards` grants. Start
the backend with `npm run dev:backend` from the repository root; its
`LOCAL_DEV=true` binding selects the matching local demo session configuration.

Open the URL printed by Vite to read and search messages without logging in.
Creating a board, posting, or editing a message prompts you to log in as Alice
or Bob, then resumes the selected action. You can return to browsing without
logging in. Logging out returns to the public message list. **Create** opens a full-screen composer
with boards loaded from the `boards` table and labeled `board/:slug`. Title and
plain-text body are required; only the selected `board_id`, session's `user_id`,
trimmed title, and trimmed body are inserted into `messages`. Apply
`migrations/004_message_titles.sql` after the existing migrations to add the
stored title column. Existing messages are titled from the first 200 characters
of their trimmed body; inserts from older clients that omit a title receive
`Untitled`.
The backend enforces ownership; editing another
user's post shows its denial and preserves the draft. Sessions stay in the current
browser tab across page navigation and reloads until they expire. Local and live
projects keep separate stored sessions. Logging out clears the stored session
and revokes it on the server.

Board slugs in message headers, recent posts, and the board list are ordinary
links to `/bff/demo/boards/:slug` on the Mainbrella site (`/boards/:slug` in the
standalone example). These public pages are rendered on the server with the
latest 20 messages for that board, newest first, and work without JavaScript.
The API query filters by board before applying the limit. Missing boards return
404; unavailable data returns 502. Vite development and preview serve these
routes; the Mainbrella deployment uses its site Worker for the same renderer.
Message titles, recent posts, and post links point to
`/bff/demo/boards/:slug/:id` (`/boards/:slug/:id` in the standalone example).
These pages render the selected message on the server, including older posts
outside the latest feed. The query filters by both board and message ID;
missing messages return 404.
A separate static-only host must provide a server using the package's `./server`
export to serve board URLs.

The public project, browser key, table, and API origin are in `src/config.ts`.
These are deliberately public browser values. Backend allowlists and session
issuance remain in `apps/bff/worker`; this example is an API consumer. Changes to
the fixed public demo project or users must also match that backend allowlist.

**+ Create new Board** below **My messages** opens a modal for a required name
(up to 80 characters) and an optional description (up to 2000 characters).
Creating a board inserts its name, description, slug, and the signed-in user's
`user_id` into `boards`. Slugs are the trimmed name lowercased with whitespace
replaced by hyphens, for example `Product Plans` becomes `product-plans`.
Names must produce a slug containing only `a–z`, numbers, and hyphens, starting
and ending with a letter or number. The database enforces unique slugs;
duplicates return an error without adding a suffix or retrying.
New boards appear in the message
composer the next time it opens. Failed requests preserve the form for retry.

Configure the example's schema and board permissions with the Canopy CLI. From
`examples/message-board`, with an installed `canopy` and the project owner's
account key in `MAINBRELLA_API_KEY`, run:

```sh
canopy --migrate
canopy --read-everyone boards
canopy --own-rows boards --owner-column user_id
canopy --browser-keys
canopy --grant boards select --key 673cfd0a-65b7-4029-b823-fca7733e7a96
canopy --grant boards insert --key 673cfd0a-65b7-4029-b823-fca7733e7a96
```

The key ID above belongs to this example's configured browser key. For another
deployment, use the matching key ID from `--browser-keys`. `--own-rows` configures
the table's ownership policy; `--grant` separately permits the browser key to
perform each operation. Both are required for board creation. These commands
are safe to rerun and preserve other key grants. Board schema and permission
setup belong to this example and require no BFF backend migration.

The composer requires `migrations/002_boards.sql` and
`migrations/004_message_titles.sql` to be applied to the project.
Its browser key needs `boards: ['select', 'insert']` and
`messages: ['select', 'insert', 'update']` table grants. The `boards` policy must
allow public selects; the `messages` policy must allow public selects and
own-row inserts/updates with `user_id` as the owner column. These permissions
must be configured on the backend; the composer never changes permissions.
Board-load errors offer retry, and failed posts preserve the title and body.

During default development, Vite proxies `/message-board-api/*` to the live API
with the demo's permitted Mainbrella origin. Local edits therefore use the real
demo database. `dev:local` proxies to `http://localhost:8787` using
the separate local project and browser key. The proxy uses the local browser
key's permitted `http://localhost:5173` origin, even if Vite selects another port.
Production builds call the configured
production API origin directly, and a separate deployment must have its exact
origin allowed on the browser key.

`npm run build:message-board` produces `examples/message-board/dist/`. To preview
it, run `npm run preview -w @canopy/example-message-board`; the built app uses the
production origin rules above.

The Mainbrella site also composes this application's HTML and React entry through
the workspace's `/page` and `/web` exports. `npm run dev:web` serves the same app
at `/bff/demo/`, and `npm run build:web` includes it in the existing site
deployment with the site's cookie preferences. The standalone example does not
include the site's account shell, analytics, or cookie controls.
