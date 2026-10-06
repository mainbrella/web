<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Images

`GET /containers` includes `imageCatalog: [{id, name}]` for images actually
published by the deployment. Catalog definitions alone do not guarantee availability.
Supported catalog IDs are `node`, `python`, `rust`, `go`, and `devops` when advertised.
`POST /containers` accepts either `{"catalogId":"python"}` or
`{"imageId":"<owned-ready-image-id>"}`, never both. An omitted body uses the
Node image. These choices do not change plan resource sizes or deadlines.

| Method and path | Result |
| --- | --- |
| `GET /images` | Owned images, `buildsEnabled`, build `limits`, and monthly `usage`. |
| `POST /images` | Multipart `name`, text `dockerfile`, and optional file `context`; returns 202 `{image}`. Builds must be enabled. |
| `GET /images/{id}` | Owned image `{image}` with status `queued`, `building`, `publishing`, `ready`, or `failed`. |
| `GET /images/{id}/logs` | `{logs, status}` for an owned build. |
| `DELETE /images/{id}` | Deletes an owned image; active builds cannot be deleted. Existing running containers remain. |

Dockerfiles must start with `FROM mainbrella:base` (after optional comments), use
one build stage, and be at most 16 KiB. Optional context is a `.tar.gz` file of at
most 512 KiB. Read returned limits instead of assuming allowance; currently up to
10 builds per UTC month, 3 saved images, and a 300-second build deadline.
Launch custom images only after status is `ready`; inspect logs for a failed build.
