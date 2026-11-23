import { useRoute, type RouteProp } from 'expo-router/react-navigation'
import { useMemo } from 'react'

import { App } from '../App'
import { debugRouteFromParams, type DebugRouteParams } from '../src/debug/route'

export default function Index() {
  const { params } = useRoute<RouteProp<{ index: DebugRouteParams }, 'index'>>()
  const target = useMemo(
    () =>
      params &&
      debugRouteFromParams({
        ...params,
        path: __DEV__ ? params.path : undefined
      }),
    [params]
  )
  return <App debugRoute={target} />
}
