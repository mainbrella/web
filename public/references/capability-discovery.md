<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Capability discovery

`GET /capabilities` is public and accepts no query parameters. Its `apiVersion`
identifies the contract. Execution/file limits come from the runtime's shared
constants. Unsupported persistence, filesystem watchers and network
policy features are explicit. `previews.supported` requires explicit enablement,
an isolated preview domain, a routing database and the runtime binding. It is
enabled in the qualified production configuration. Preview links use opaque bearer tokens,
so `previews.signedUrls` remains false. `images.customBuilds` reflects configured build
credentials; it does not establish build-service health. Resources currently
advertise all five machine sizes. Regions are not selectable.

Use authenticated `GET /containers` for account allowances, usage, running
generations and the deployed `imageCatalog`. New generations include
`imageDigest`, the server-resolved image reference; older generations may omit it.
Capability discovery does not contact Stripe or reserve a start.
