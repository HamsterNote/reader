import { createContext } from 'react'

/** Scope page controllers to the currently opened document, including empty pages. */
export const DrawingDocumentContext = createContext<unknown>(null)
