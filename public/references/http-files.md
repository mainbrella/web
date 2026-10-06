<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## HTTP files

File requests require an owned, running, paid generation, checked again immediately
before the guest process starts. Send raw bytes with `Content-Type: application/octet-stream`
for PUT; consume GET as bytes (`response.arrayBuffer()` in JavaScript), not JSON or text.
Both uploads and downloads are limited to 1 MiB. Oversized uploads are rejected before
writing, and oversized reads return an error without partial data. Paths must be absolute,
at most 4096 UTF-8 bytes, with no NUL, empty, `.` or `..` segments. URL-encode all query values.
Paths refer to the owned guest filesystem; `/workspace` is a convention, not an access boundary.

GET reads regular files and follows symlinks inside the guest. PUT writes a temporary
file beside the destination and atomically replaces it; it rejects directories and
existing symlinks. New files use mode 0600; replacement preserves permission bits.
Parent directories are not created automatically. Use the capability-gated
directory operations below when supported by the deployment.

Runtime file operations are bounded by 30 seconds and the hard container deadline,
share the four-command execution pool, and renew idle activity. Disconnect or stop
requests cancellation. A lost response may hide a completed write; read to reconcile
before retrying. Files are ephemeral and disappear when the machine stops. Custom
images must retain `/bin/sh` and GNU coreutils, supplied by Mainbrella's base image.

```js
// sandbox is the running creation identity; apiKey stays in a server environment.
const query = new URLSearchParams({
  id: sandbox.containerId, createdAt: sandbox.createdAt, path: '/workspace/input.bin',
});
const url = `https://api.mainbrella.com/containers/files?${query}`;
const headers = { Authorization: `Bearer ${apiKey}` };
const upload = await fetch(url, {
  method: 'PUT', headers: { ...headers, 'Content-Type': 'application/octet-stream' },
  body: new Uint8Array([0, 128, 255]),
});
if (!upload.ok) throw new Error(`Upload failed: ${upload.status}`);
const download = await fetch(url, { headers });
if (!download.ok) throw new Error(`Download failed: ${download.status}`);
const bytes = new Uint8Array(await download.arrayBuffer());
```
