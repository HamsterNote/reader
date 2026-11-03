import { createContext } from 'react'

/** Mounted pages register cancellation, independent of page visibility and history targets. */
export const DrawingInputContext = createContext<Set<() => void> | null>(null)
