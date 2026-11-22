import { useLocalSearchParams } from 'expo-router'
import { useMemo } from 'react'

import { App } from '../../App'
import { debugRouteFromParams, type DebugRouteParams } from './route'

export function OpenRoute() {
  const { fileId, path, layout } = useLocalSearchParams<DebugRouteParams>()
  const debugRoute = useMemo(
    () => debugRouteFromParams({ fileId, path, layout }),
    [fileId, path, layout]
  )
  return <App debugRoute={debugRoute} />
}
