import { router, useLocalSearchParams } from 'expo-router'
import { useEffect } from 'react'

import { firstParam, type DebugRouteParams } from './route'

export function OpenRoute({ enabled = true }: { enabled?: boolean }) {
  const params = useLocalSearchParams<DebugRouteParams>()
  const fileId = firstParam(params.fileId)
  const path = __DEV__ ? firstParam(params.path) : undefined
  const layout = firstParam(params.layout)
  useEffect(() => {
    // Reuse the existing index and its store. On a cold link dismissTo
    // replaces the link screen when there is no index in the stack yet.
    router.dismissTo({
      pathname: '/',
      params: enabled ? { fileId, path, layout } : {}
    })
  }, [enabled, fileId, path, layout])
  return null
}
