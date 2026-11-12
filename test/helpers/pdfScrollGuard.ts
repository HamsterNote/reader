/**
 * Deterministic guard scan for PDF.js navigation calls.
 *
 * A hit is allowed when its file is in ALLOWLIST (each entry carries a reason)
 * or when the same line has a trailing `// pdf-scroll-guard: <reason>`
 * comment. Covering boundary: indirect calls such as
 * `const f = viewer.scrollPageIntoView; f(...)` have no matching token and are
 * NOT detected; add an annotation at the alias site if that pattern appears.
 */
export const SCROLL_CALL =
  /\.scrollPageIntoView\s*\(|\.currentPageNumber\s*=(?!=)/

export const ALLOWLIST: Readonly<Record<string, string>> = {
  'CroppedPdfViewer.ts':
    'PDF.js subclass owns the low-level currentPageNumber/scrollPageIntoView wrapper; every external caller is guarded.',
  'pageActivation.ts':
    'Guard implementation itself performs the checked setter write.'
}

export interface ScannedFile {
  readonly path: string
  readonly text: string
}

/** Counts unescaped quotes so a marker inside a string literal is rejected. */
function insideString(prefix: string): boolean {
  let single = 0
  let double = 0
  for (let index = 0; index < prefix.length; index++) {
    const character = prefix[index]
    if (character === '\\') {
      index++
      continue
    }
    if (character === "'") single++
    else if (character === '"') double++
  }
  return single % 2 === 1 || double % 2 === 1
}

function hasSameLineGuard(line: string, matchIndex: number): boolean {
  const rest = line.slice(matchIndex)
  const marker = rest.indexOf('//')
  if (marker < 0) return false
  const annotation = rest.slice(marker)
  if (!/^\/\/\s*pdf-scroll-guard:\s*\S+/.test(annotation)) return false
  // A marker inside a string literal is not a comment.
  return !insideString(line.slice(0, matchIndex + marker))
}

export function findUnguardedScrollCalls(
  files: readonly ScannedFile[]
): string[] {
  const unguarded: string[] = []
  for (const file of files) {
    const name = file.path.split('/').at(-1) ?? file.path
    if (ALLOWLIST[name]) continue
    file.text.split('\n').forEach((line, index) => {
      const match = SCROLL_CALL.exec(line)
      if (!match || match.index === undefined) return
      if (hasSameLineGuard(line, match.index)) return
      unguarded.push(`${file.path}:${index + 1}: ${line.trim()}`)
    })
  }
  return unguarded
}
