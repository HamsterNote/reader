import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { NavigationAction } from '@react-navigation/native'

type RouteName = 'Library' | 'Reader'
type HeaderOptions = {
  title?: string
  headerRight?: () => ReactNode
}
type BeforeRemoveEvent = {
  data: { action: NavigationAction }
  preventDefault: () => void
}
type Navigation = {
  navigate: (route: RouteName) => void
  popToTop: () => void
  dispatch: (action: NavigationAction) => void
  addListener: (
    event: 'beforeRemove',
    listener: (event: BeforeRemoveEvent) => void
  ) => () => void
  setOptions: (options: HeaderOptions) => void
}
type NavigationContextValue = {
  route: RouteName
  navigation: Navigation
}

const NavigationContext = createContext<NavigationContextValue | null>(null)
const fallbackNavigation: Navigation = {
  navigate: () => undefined,
  popToTop: () => undefined,
  dispatch: () => undefined,
  addListener: () => () => undefined,
  setOptions: () => undefined
}

export function MockNavigationContainer({
  children,
  initialRouteName = 'Library',
  showBack = true
}: {
  children: ReactNode
  initialRouteName?: RouteName
  showBack?: boolean
}) {
  const [route, setRoute] = useState(initialRouteName)
  const [options, setOptions] = useState<HeaderOptions>({})
  const listeners = useRef(new Set<(event: BeforeRemoveEvent) => void>())
  const dispatch = useCallback((action: NavigationAction): void => {
    let prevented = false
    const event: BeforeRemoveEvent = {
      data: { action },
      preventDefault: () => {
        prevented = true
      }
    }
    for (const listener of listeners.current) listener(event)
    if (!prevented) setRoute('Library')
  }, [])
  const navigation = useMemo<Navigation>(
    () => ({
      navigate: setRoute,
      popToTop: () => dispatch({ type: 'POP_TO_TOP' }),
      dispatch,
      addListener: (_event, listener) => {
        listeners.current.add(listener)
        return () => listeners.current.delete(listener)
      },
      setOptions: (next) => setOptions((current) => ({ ...current, ...next }))
    }),
    [dispatch]
  )
  const context = useMemo(() => ({ route, navigation }), [route, navigation])
  return (
    <NavigationContext.Provider value={context}>
      <div data-testid='native-stack-header'>
        <span>{options.title}</span>
        {route === 'Reader' && showBack ? (
          <button onClick={() => dispatch({ type: 'GO_BACK' })}>返回</button>
        ) : null}
        {route === 'Reader' ? options.headerRight?.() : null}
      </div>
      {initialRouteName === 'Reader' && route === 'Library' ? null : children}
    </NavigationContext.Provider>
  )
}

function useMockNavigation(): Navigation {
  return useContext(NavigationContext)?.navigation ?? fallbackNavigation
}

export const nativeNavigationMock = {
  NavigationContainer: MockNavigationContainer,
  useNavigation: useMockNavigation
}

export const nativeStackNavigationMock = {
  createNativeStackNavigator: () => ({
    Navigator: ({ children }: { children: ReactNode }) => <>{children}</>,
    Screen: ({
      name,
      options,
      children
    }: {
      name: RouteName
      options?: HeaderOptions
      children: ReactNode | (() => ReactNode)
    }) => {
      const context = useContext(NavigationContext)
      const optionsRef = useRef(options)
      optionsRef.current = options
      useEffect(() => {
        if (context?.route === name && optionsRef.current) {
          context.navigation.setOptions(optionsRef.current)
        }
      }, [context?.route, context?.navigation, name])
      if (context?.route !== name) return null
      return typeof children === 'function' ? children() : children
    }
  })
}
