# android-pdf-asset-origin Specification

## Purpose
Constrain Android local PDF and runtime access to a private HTTPS asset origin and the active reader session, preserving offline reading without enabling broad filesystem access or network fallbacks.

## Requirements

### Requirement: Restricted local HTTPS origin
Android PDF runtime assets and the selected PDF SHALL be accessible only at authorized paths under `https://appassets.androidplatform.net`. Static runtime assets SHALL match an exact packaged manifest and document URLs SHALL resolve only to the current session's authorized source. Unknown paths, traversal, encoded separator ambiguity, unauthorized files and stale session URLs SHALL return a denial without falling through to network or general filesystem access. Responses SHALL carry explicit MIME types and `X-Content-Type-Options: nosniff`.

#### Scenario: PDF opens through the asset origin
- **WHEN** a local PDF is selected offline
- **THEN** its viewer assets and PDF bytes load through authorized local HTTPS paths and page rendering and selection remain available

#### Scenario: Unauthorized asset or document request
- **WHEN** a request names an unknown asset, traversal path, another local file or an expired document token
- **THEN** no bytes from that resource are exposed and the request does not reach the network

### Requirement: Restricted WebView permissions and navigation
The Android PDF host SHALL keep file access, file-origin cross-resource access and universal file-origin access disabled, deny unauthorized remote subresources and top-level navigation, and not enable a permissive fallback when loading fails. Document actions SHALL NOT execute embedded scripts or launch external navigation. Any bridge SHALL accept only closed, versioned, frame/origin/session-bound messages from the active host, with finite payload bounds.

#### Scenario: PDF references an external action
- **WHEN** a PDF or unexpected host message attempts a remote request, navigation, popup, filesystem read or unrecognized command
- **THEN** the attempt is denied without invoking host capabilities or weakening WebView settings

### Requirement: Authorized source cleanup
Each source session SHALL authorize only its selected local PDF, revoke that authorization on replacement/unmount and release reader-owned temporary data. Host-owned local files SHALL remain untouched. Native content URI grants SHALL be used only for the selected source, not exposed as a general origin path.

#### Scenario: Android source is replaced
- **WHEN** source B replaces source A while A has outstanding resource requests
- **THEN** A's document URL is no longer authorized, late A results cannot update B and only reader-owned A resources are removed
