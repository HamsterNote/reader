import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ViewportPaginationControls } from '../../src/components/reading/ViewportPaginationControls'

function Harness() {
  const [ready, setReady] = useState(true)
  const [busy, setBusy] = useState(false)
  const [count, setCount] = useState(0)
  return (
    <div style={{ padding: 40 }}>
      <button
        id='disable'
        type='button'
        onClick={() => {
          setReady(false)
          setBusy(true)
        }}
      >
        disable
      </button>
      <button
        id='enable'
        type='button'
        onClick={() => {
          setReady(true)
          setBusy(false)
        }}
      >
        enable
      </button>
      <div data-testid='count' style={{ padding: 8 }}>
        {count}
      </div>
      <ViewportPaginationControls
        navigation={{ busy, canPrevious: true, canNext: true }}
        ready={ready}
        theme='light'
        onPrevious={() => setCount((value) => value + 1)}
        onNext={() => setCount((value) => value + 1)}
      />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
