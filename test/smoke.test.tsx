import { createElement } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

function SmokeFixture() {
  return createElement(
    'main',
    null,
    createElement('h1', null, 'Smoke test'),
    createElement('button', { type: 'button' }, 'Ready')
  )
}

describe('test harness smoke test', () => {
  it('renders with jsdom and jest-dom matchers', () => {
    render(createElement(SmokeFixture))

    expect(
      screen.getByRole('heading', { name: 'Smoke test' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ready' })).toBeInTheDocument()
  })
})
