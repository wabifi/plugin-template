# vendor

`author-types-429ea040.tgz` holds the TypeScript types of Wabifi desktop's plugin API (v1), built
from the desktop's source. `packages/author` re-exports them as `@wabifi/author`, the name your
plugins import them by. They are types only: nothing from the archive ends up in a `plugin.js`.

The archive is licensed under the Apache License 2.0, not this repository's MIT license. Its
`package/LICENSE` and `package/NOTICE.md` hold the license and the upstream copyright notices;
keep them with the archive.
