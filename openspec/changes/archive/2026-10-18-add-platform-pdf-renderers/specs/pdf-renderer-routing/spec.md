# Spec Delta

## Purpose

Define observable local PDF routing and lifecycle behavior across iOS, Android, and Web, while preserving the existing EPUB entry contract and keeping engine-specific reading state independent.

## ADDED Requirements

### Requirement: Content-directed renderer dispatch
The reader SHALL select a separate PDF reading path for detected local PDF bytes and retain the existing EPUB path for detected EPUB bytes. Filename and MIME hints SHALL NOT override validated content. PDF fixed-page navigation SHALL NOT require EPUB chapter, CFI, reflow, or IntermediateDocument conversion. Other currently supported formats SHALL retain their existing routing.

#### Scenario: Misleading filename
- **WHEN** a valid local PDF is supplied with an EPUB filename or missing MIME
- **THEN** it opens in the PDF path, while an EPUB named `.pdf` continues to the EPUB path

#### Scenario: Existing EPUB consumer
- **WHEN** a consumer opens an EPUB with the current supported public API
- **THEN** the existing EPUB renderer, navigation and reading flow behavior remain available

### Requirement: Native candidate dispatch has a five-byte limit
Native dispatch SHALL validate local file/content scheme, then known positive integer size, then the 32 MiB bound, before reading at most five prefix bytes matching `%PDF-` at offset zero. Failed prerequisites SHALL prohibit the read. The probe SHALL return only a boolean candidate decision, never source bytes or an authorization for later reading, copying, transfer, or session creation. Non-PDF candidates SHALL still require every existing Foliate CSP/private bridge/complete-source gate unchanged. PDF candidates SHALL require their independent platform PDF capability before further access, and their engine SHALL validate complete content. Remote sources SHALL incur zero requests. Retired probes SHALL not read again or affect new sources.

#### Scenario: Dispatch prerequisites fail
- **WHEN** the scheme is remote or invalid, size is unknown or invalid, or size exceeds 32 MiB
- **THEN** no signature bytes are read and neither renderer is authorized

#### Scenario: Candidate probe does not authorize a renderer
- **WHEN** the probe matches a misnamed PDF without MIME while Foliate is unavailable, or returns false for a non-PDF source
- **THEN** its only result is PDF versus Foliate candidate selection; an unavailable selected capability reports unsupported without further reads, copies, transfers or sessions

### Requirement: Controlled local PDF source and stable state
The reader SHALL accept local PDF input without opening a picker itself, expose idle/loading/ready/categorized-error through the surrounding reader contract, and report ready only after a PDF page is displayed and valid page metadata exists. Native PDF sources SHALL retain the existing 32 MiB limit. Remote HTTP(S) sources SHALL be rejected without requests. Unreadable, corrupt and encrypted/password-required files SHALL report stable read, invalid/render or drm/unsupported errors and clear stale content. No password prompt or remote fallback is required in this phase.

#### Scenario: Local PDF opens offline
- **WHEN** the host supplies a readable, unencrypted local PDF within platform limits with the network unavailable
- **THEN** the PDF opens and exposes its page count and current page through the reader UI

#### Scenario: Rejected PDF inputs
- **WHEN** a source is unreadable, corrupt, encrypted, remote, or above the native bound
- **THEN** the current source reaches a stable categorized error, never reports ready, and does not display a previous source's pages

### Requirement: Source ownership and session isolation
Source replacement, clearing or unmount SHALL dispose reader-owned resources and invalidate old page, thumbnail, selection and error events. Cleanup SHALL NOT delete the host-owned file or revoke a host-owned blob URI. PDF and EPUB SHALL share outer lifecycle semantics but SHALL NOT share engine locations, render tasks, caches or selection identities.

#### Scenario: PDF is replaced by EPUB while loading
- **WHEN** EPUB B replaces opening PDF A and A later emits page, thumbnail, selection or error results
- **THEN** only B can update UI/state callbacks and A's reader-owned resources are released without modifying either host source

#### Scenario: Old document input remains compatible
- **WHEN** an existing reader consumer supplies only its supported IntermediateDocument input
- **THEN** that input retains its existing behavior and no original PDF bytes are inferred or synthesized from it
