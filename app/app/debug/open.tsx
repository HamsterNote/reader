import { App } from '../../App'
import { OpenRoute } from '../../src/debug/OpenRoute'

export default function DebugOpenRoute() {
  return __DEV__ ? <OpenRoute /> : <App />
}
