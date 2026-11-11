# painting 0.8.4 development artifact

Official `@hamster-note/painting` npm pack artifact built from HamsterNote/painting PR #48, commit 57a82fb0d40fa090cfdfd86bfa62ba8a584902f7. Includes the public `/toolbar` export. No reader-specific patches or source fork.

This archive is only a devDependency. Published reader declares exact peer `@hamster-note/painting: 0.8.4`, without a local file runtime dependency. Moving painting from a transitive runtime dependency to an explicit required peer is a packaging compatibility change, so reader advances to **3.0.0**. Hosts must declare painting 0.8.4 directly. Publish painting 0.8.4 before reader 3.0.0. Do not publish reader until painting's review completes. Archive integrity is recorded in yarn.lock; regenerate it from the reviewed painting commit if #48 changes before merge.
