<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Filesystem metadata and directories

Check `/capabilities` for `files.list`, `stat`, `mkdir`, `delete`, `move` and `chmod`
before using these additive routes. Every route requires the same exact `id` and
`createdAt` as file transfer, with account ownership, paid lease and generation
rechecked before launch. They share the four-operation pool, 30-second deadline
and idle renewal. No start is consumed. Root is accepted for list/stat only.
Paths must be well-formed UTF-8, absolute and at most 4096 bytes; empty, dot,
parent and NUL segments are rejected. Intermediate symlinks resolve inside the
owned guest. These are guest filesystem controls, not a `/workspace` jail.

`GET /containers/files/list` accepts `path`, optional `limit` (1–1000, default 100)
and `offset` (0–1,000,000, default 0). Entries are one level deep, sorted by UTF-8
filename bytes; child symlinks are not followed. A directory path may itself be
a symlink. Response: `{path, entries, nextOffset}`; null means the final page.
Pagination rescans the directory; changes between requests may duplicate or omit
entries. Sorting/scanning is bounded by the deadline, metadata by 1 MiB. Non-UTF-8
names return 409 `unsupported_file_name` rather than unusable replacement paths.

Each entry includes `name`, `path`, `type`, `size` in bytes, octal `mode`, numeric
`uid`/`gid`, and `modifiedAt` with second precision. Types include `file`,
`directory`, `symlink`, `fifo`, `socket`, `character`, `block` and `other`.
Symlinks include `linkTarget`. `GET /containers/files/stat` returns one entry and
inspects the link itself by default, including broken links. The optional query
`followSymlinks=true` dereferences it; a missing target returns 404.

Mutations return `{path, ok: true}`, plus `destination` for move or `mode` for chmod:

- `POST /containers/files/mkdir` takes JSON `{path, recursive?: boolean, mode?: string}`.
  Default final-directory mode is `0700`; missing parents require `recursive: true`.
  Parent modes follow the guest umask. Recursive creation of an existing non-symlink
  directory succeeds; existing leaf symlinks or non-directories conflict.
- `DELETE /containers/files/remove` takes query `path` and optional `recursive=true`.
  By default directories must be empty. A symlink is removed without deleting its
  target. Missing paths return 404. Recursive deletion can partly complete before
  interruption; inspect state before retrying.
- `POST /containers/files/move` takes JSON `{path, destination}`. The destination
  must be unused and its parent must exist. No overwrite or directory nesting.
  Symlinks are moved as links. Moves into the source subtree are rejected. Across
  filesystems, interruption can leave both source and destination; reconcile first.
- `PATCH /containers/files/chmod` takes query `path` and JSON `{mode: "0644"}`.
  Modes must be four octal characters from `0000` to `0777`; no owner changes,
  recursive chmod or setting special bits. Leaf symlinks are rejected.

Cookie mutations require a trusted Origin; Bearer automation may omit it. Unknown
and duplicate parameters and unexpected JSON fields are rejected. Operations
require bash, GNU coreutils, findutils and sed in the guest. A lost mutation
response can hide completed or partial effects; SDK helpers never retry them.
Documented errors include 404 `file_not_found`, 403 `file_access_denied`, 409
`not_directory`, `file_exists`, `directory_not_empty`, `symlink_not_allowed` or
`container_not_running`, 413 `directory_too_large`, 429 `execution_limit`, and
503 `files_unavailable`. Watchers and programmatic PTY remain separate work.
