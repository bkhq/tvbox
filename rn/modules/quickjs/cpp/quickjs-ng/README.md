# quickjs-ng (vendored)

- Upstream: https://github.com/quickjs-ng/quickjs
- Tag: `v0.16.2` (release tarball `archive/refs/tags/v0.16.2.tar.gz`)
- License: MIT, see `LICENSE`

Only the engine sources needed by `../qjs_bridge.c` are copied, unmodified:
`quickjs.c`, `dtoa.c`, `libregexp.c`, `libunicode.c` and the headers they
include (including the generated `builtin-*.h`). `quickjs-libc`, the CLI,
tests and the JS sources of the builtins are not vendored.

To upgrade, download the new release tarball, copy the same file list over
and update `VERSION` and this note.
