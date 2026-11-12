HAM-244 native EPUB progress fixture, copied unchanged from the WebBase
reproduction: `createPaginatedEpub(true)` parsed by
`@hamster-note/epub-parser@0.5.1-beta.3`, then serialized using the retired native
reader's chapter text and canonical offset contract.

The sidecar points to chapter 2, paragraph 20 at offset 15279. Reader 3.0.0's
compatibility stream inserts spaces around adjacent spans, so the same source
character is at offset 16459. The full chapter text identifies the source
stream; the fixture deliberately contains repeated sentences/inline spans to
prevent excerpt search from passing accidentally. It contains generated text,
not user data.

`yarn test:run test/epub/native-text-anchor.test.ts` checks the mapping, unchanged
3.0.0 offsets, source validation, DOM paragraph, reflow and immutable sidecar.
`yarn check:native-epub-anchor` restores both coordinate systems in real Chromium
and requires the target paragraph's viewport intersection ratio to exceed zero.

The runtime projection only accepts an entire native source stream that equals
the compatibility stream modulo inserted ASCII spaces. Missing or changed
source text rejects restoration explicitly. No fuzzy search, sidecar migration
or on-disk rewrite is performed; normal navigation subsequently captures a
standard reader anchor.
