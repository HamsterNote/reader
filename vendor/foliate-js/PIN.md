# foliate-js vendored copy

- Source: https://github.com/johnfactotum/foliate-js
- Commit: `78914aef4466eb960965702401634c2cb348e9b1`
- License: MIT (see `LICENSE`)
- Files: `epub.js`, `epubcfi.js`, `paginator.js`, `overlayer.js`, `progress.js`, `text-walker.js`, `fixed-layout.js`

The source tarball was fetched from
`https://codeload.github.com/johnfactotum/foliate-js/tar.gz/78914aef4466eb960965702401634c2cb348e9b1`
and copied with the reader patches listed below. The reference repository `native-reader` pins the same commit.

## reader patch (HAM-129)

`paginator.js`: opt-in `manual-navigation` disables touch, selection-edge and
focus-triggered navigation; `before-reflow` notifies the adapter before viewport,
font or image layout changes; ignore zero-size viewport renders; always release
the navigation lock after a failed turn. Other consumers retain default gestures.
The patched hash is recorded in MANIFEST.md and checked by the asset test.

## reader lifecycle patch (HAM-229)

`paginator.js`: `setStyles` captures its section view and checks that identity
before its animation-frame and fonts-ready callbacks access it. Same-container
file replacement destroys the old renderer immediately after restore-ready;
late callbacks must not dereference the destroyed view or mutate a new section.
The packaged WebView roundtrip browser test covers this teardown path. The
patched hash is recorded in MANIFEST.md and the asset integrity test.
