# HAM-268 S01–S13 acceptance record

Fill one row after each run. `verifier` is the operator or agent, `device` is
the exact simulator/phone, `sha` is the tested commit, and `raw output` is a
file produced by `scripts/ham268-regression.sh` or the Mac handoff bundle.
Do not mark a row passed from a Linux test when the criterion requires UIKit,
PDFKit, a gesture, or a real device.

| Case | Current state | Verifier | Device/environment | SHA | Criterion | Raw output / attachment |
| --- | --- | --- | --- | --- | --- | --- |
| S01 | Passed on Mac simulator; real-device pending | Mac operator | iPhone 18 Pro Simulator / iOS 27.2 | `ae14e46` | Native first page visible, page count and ready events correct | Mac evidence bundle; real-device run pending |
| S02 | Passed on Mac simulator | Mac operator | iPhone 18 Pro Simulator / iOS 27.2 | `ae14e46` | 50/100/200% navigation reaches target slot once | `S02` Mac evidence |
| S03 | Pending real device | Mac operator | iPhone 16 Pro | `74b6603` | Selection, popover, comment and highlight commit once | pending unlocked-device log |
| S04 | Pending real device | Mac operator | iPhone 16 Pro | `74b6603` | Page 1→12 drag retains canonical text/rectangles and stops at release | pending unlocked-device log |
| S05 | Pending device decision | Human + Mac operator | iPad + Pencil (A), or B follow-up | `74b6603` | Handle geometry and text lens match shared specification | pending A/B decision |
| S06 | Pending real device | Mac operator | iPhone 16 Pro + Web reference | `74b6603` | Edit/reopen highlights and comments preserve IDs and associations | pending unlocked-device log |
| S07 | Linux controller coverage; UIKit drawing pending | Agent + Mac operator | Linux; iOS simulator/phone | `74b6603` | Unified annotation/painting history and real draw behavior | focused tests; Mac drawing log pending |
| S08 | Passed renderer geometry; editor UI pending Mac | Mac operator | iPhone 18 Pro Simulator / iOS 27.2 | `74b6603` | Hidden/cropped pages, group edit, confirm, undo and no hidden slots after reopen | `S08` evidence; 4.6 run pending |
| S09 | Linux partial; lifecycle pending Mac | Agent + Mac operator | Linux; iOS simulator | `74b6603` | Layout/Text switch and progress resume within safe-line rule | focused tests; Mac lifecycle log pending |
| S10 | Linux partial; lifecycle pending Mac | Agent + Mac operator | Linux; iOS simulator | `74b6603` | debounce/flush, failure retry and close barrier preserve latest data | focused tests; Mac lifecycle log pending |
| S11 | Linux partial; native error paths pending Mac | Agent + Mac operator | Linux; iOS simulator | `74b6603` | corrupt/permission/encrypted classifications and clean file switch | focused tests; Mac error log pending |
| S12 | Linux contract; four-state Mac run pending | Agent + Mac operator | Linux; iOS simulator | `74b6603` | OCR off/success/failure/file switch states satisfy provider contract | `native-ocr.test.ts`; Mac four-state log pending |
| S13 | Linux partial; native file switch pending Mac | Agent + Mac operator | Linux; iOS simulator | `74b6603` | storageId/pane isolation and save-failure file switching | focused tests; Mac file-switch log pending |

Known Mac build prerequisite: after adding Swift files, run
`cd app/ios && pod install --no-repo-update` before `yarn host:ios` when the
existing Pods project does not contain `ReaderPdfViewport`.
