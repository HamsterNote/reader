# Historical painting 0.8.4 development artifact

The retained archive was built from HamsterNote/painting PR #48, commit 57a82fb0d40fa090cfdfd86bfa62ba8a584902f7. It includes the public `/toolbar` export and has no reader-specific patches.

It is no longer referenced by package.json or yarn.lock. Reader 3.0.0 now declares exact peer and development dependency `@hamster-note/painting: 0.9.0`, using the published npm package. Hosts must explicitly provide painting 0.9.0. Do not publish the historical 0.8.4 candidate as part of this release; painting 0.9.0 is already published. See `docs/file-workspace.md` for the current installation contract.
