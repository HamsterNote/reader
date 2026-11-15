import type { PdfIdentity } from './contracts'

export type PdfHandoffPhase =
  | 'WEB_ACTIVE'
  | 'WEB_DRAINING'
  | 'WEB_DRAIN_FAILED'
  | 'NATIVE_REFRESHING'
  | 'NATIVE_ACTIVE'
  | 'NATIVE_DRAINING'
  | 'NATIVE_DRAIN_FAILED'
  | 'WEB_REFRESHING'
  | 'CLOSED'

export type PdfHandoffTarget = 'native' | 'web' | 'closed'

export type PdfHandoffState = Readonly<{
  fileId: string
  paneId: string
  phase: PdfHandoffPhase
  target: PdfHandoffTarget | null
  owner: PdfIdentity | null
  epoch: number
  web: PdfIdentity
  native: PdfIdentity | null
  nextWeb: PdfIdentity | null
}>

export type PdfHandoffTransition = Readonly<{
  phase: PdfHandoffPhase
  target: PdfHandoffTarget | null
  owner: PdfIdentity | null
  epoch: number
}>

function sameIdentity(left: PdfIdentity | null, right: PdfIdentity): boolean {
  return (
    left !== null &&
    left.fileId === right.fileId &&
    left.paneId === right.paneId &&
    left.sessionId === right.sessionId &&
    left.generation === right.generation
  )
}

export class PdfHandoffCoordinator {
  private state: PdfHandoffState
  private readonly transitions: PdfHandoffTransition[] = []

  constructor(web: PdfIdentity) {
    this.state = Object.freeze({
      fileId: web.fileId,
      paneId: web.paneId,
      phase: 'WEB_ACTIVE',
      target: null,
      owner: web,
      epoch: 0,
      web,
      native: null,
      nextWeb: null
    })
    this.record()
  }

  get snapshot(): PdfHandoffState {
    return this.state
  }

  get trace(): readonly PdfHandoffTransition[] {
    return this.transitions
  }

  requestNative(native: PdfIdentity): boolean {
    if (sameIdentity(this.state.native, native)) return false
    if (this.state.phase !== 'WEB_ACTIVE') {
      if (this.state.phase === 'WEB_DRAINING' && this.state.native) {
        this.state = Object.freeze({ ...this.state, target: 'native' })
        this.record()
      }
      return false
    }
    this.state = Object.freeze({
      ...this.state,
      phase: 'WEB_DRAINING',
      target: 'native',
      native,
      nextWeb: null
    })
    this.record()
    return true
  }

  requestWeb(nextWeb: PdfIdentity): boolean {
    const phase = this.state.phase
    if (phase === 'WEB_REFRESHING' && sameIdentity(this.state.web, nextWeb)) {
      return false
    }
    if (phase === 'WEB_DRAINING' || phase === 'WEB_DRAIN_FAILED') {
      const retry = phase === 'WEB_DRAIN_FAILED'
      this.state = Object.freeze({
        ...this.state,
        phase: retry ? 'WEB_DRAINING' : this.state.phase,
        target: 'web',
        nextWeb
      })
      this.record()
      return retry
    }
    if (phase === 'NATIVE_DRAINING' || phase === 'NATIVE_DRAIN_FAILED') {
      const retry = phase === 'NATIVE_DRAIN_FAILED'
      this.state = Object.freeze({
        ...this.state,
        phase: retry ? 'NATIVE_DRAINING' : phase,
        target: 'web',
        nextWeb
      })
      this.record()
      return retry
    }
    if (phase !== 'NATIVE_ACTIVE' && phase !== 'NATIVE_REFRESHING') {
      return false
    }
    this.state = Object.freeze({
      ...this.state,
      phase: 'NATIVE_DRAINING',
      target: 'web',
      nextWeb
    })
    this.record()
    return true
  }

  requestClosed(): boolean {
    const phase = this.state.phase
    if (phase === 'CLOSED') return false
    if (phase === 'WEB_ACTIVE') {
      this.state = Object.freeze({
        ...this.state,
        phase: 'WEB_DRAINING',
        target: 'closed'
      })
      this.record()
      return true
    }
    if (phase === 'WEB_DRAINING' || phase === 'WEB_DRAIN_FAILED') {
      const retry = phase === 'WEB_DRAIN_FAILED'
      this.state = Object.freeze({
        ...this.state,
        phase: retry ? 'WEB_DRAINING' : phase,
        target: 'closed'
      })
      this.record()
      return retry
    }
    if (phase === 'NATIVE_DRAINING' || phase === 'NATIVE_DRAIN_FAILED') {
      const retry = phase === 'NATIVE_DRAIN_FAILED'
      this.state = Object.freeze({
        ...this.state,
        phase: retry ? 'NATIVE_DRAINING' : phase,
        target: 'closed'
      })
      this.record()
      return retry
    }
    if (phase === 'NATIVE_ACTIVE' || phase === 'NATIVE_REFRESHING') {
      this.state = Object.freeze({
        ...this.state,
        phase: 'NATIVE_DRAINING',
        target: 'closed'
      })
      this.record()
      return true
    }
    return false
  }

  webDrainFailed(identity: PdfIdentity): void {
    if (
      this.state.phase !== 'WEB_DRAINING' ||
      !sameIdentity(this.state.owner, identity)
    ) {
      return
    }
    this.state = Object.freeze({ ...this.state, phase: 'WEB_DRAIN_FAILED' })
    this.record()
  }

  webDrained(identity: PdfIdentity): void {
    if (
      this.state.phase !== 'WEB_DRAINING' ||
      !sameIdentity(this.state.owner, identity)
    ) {
      return
    }
    const target = this.state.target
    const nextWeb = this.state.nextWeb
    const native = this.state.native
    let phase: PdfHandoffPhase = 'CLOSED'
    if (target === 'native' && native) phase = 'NATIVE_REFRESHING'
    else if (target === 'web' && nextWeb) phase = 'WEB_REFRESHING'
    else if (native) phase = 'NATIVE_DRAINING'
    this.state = Object.freeze({
      ...this.state,
      phase,
      owner: null,
      epoch: this.state.epoch + 1,
      web: target === 'web' && nextWeb ? nextWeb : this.state.web
    })
    this.record()
  }

  nativeRefreshed(identity: PdfIdentity): boolean {
    if (
      this.state.phase !== 'NATIVE_REFRESHING' ||
      !sameIdentity(this.state.native, identity)
    ) {
      return false
    }
    this.state = Object.freeze({
      ...this.state,
      phase: 'NATIVE_ACTIVE',
      owner: identity,
      epoch: this.state.epoch + 1
    })
    this.record()
    return true
  }

  nativeDrainFailed(identity: PdfIdentity): void {
    if (
      this.state.phase !== 'NATIVE_DRAINING' ||
      !sameIdentity(this.state.owner, identity)
    ) {
      return
    }
    this.state = Object.freeze({ ...this.state, phase: 'NATIVE_DRAIN_FAILED' })
    this.record()
  }

  nativeDrained(identity: PdfIdentity): void {
    if (
      this.state.phase !== 'NATIVE_DRAINING' ||
      !sameIdentity(this.state.native, identity)
    ) {
      return
    }
    const nextWeb = this.state.nextWeb
    this.state = Object.freeze({
      ...this.state,
      phase:
        this.state.target === 'web' && nextWeb ? 'WEB_REFRESHING' : 'CLOSED',
      owner: null,
      epoch: this.state.epoch + 1,
      web: this.state.target === 'web' && nextWeb ? nextWeb : this.state.web
    })
    this.record()
  }

  webReady(identity: PdfIdentity): void {
    if (
      this.state.phase !== 'WEB_REFRESHING' ||
      !sameIdentity(this.state.web, identity)
    ) {
      return
    }
    this.state = Object.freeze({
      ...this.state,
      phase: 'WEB_ACTIVE',
      target: null,
      owner: identity,
      native: null,
      nextWeb: null,
      epoch: this.state.epoch + 1
    })
    this.record()
  }

  retryWebDrain(): boolean {
    if (this.state.phase !== 'WEB_DRAIN_FAILED') return false
    this.state = Object.freeze({ ...this.state, phase: 'WEB_DRAINING' })
    this.record()
    return true
  }

  retryNativeDrain(): boolean {
    if (this.state.phase !== 'NATIVE_DRAIN_FAILED') return false
    this.state = Object.freeze({ ...this.state, phase: 'NATIVE_DRAINING' })
    this.record()
    return true
  }

  invalidate(): void {
    if (this.state.phase === 'CLOSED') return
    this.state = Object.freeze({
      ...this.state,
      phase: 'CLOSED',
      target: 'closed',
      owner: null,
      epoch: this.state.epoch + 1
    })
    this.record()
  }

  canAccept(identity: PdfIdentity): boolean {
    return (
      (this.state.phase === 'WEB_ACTIVE' ||
        this.state.phase === 'NATIVE_ACTIVE') &&
      sameIdentity(this.state.owner, identity)
    )
  }

  assertWriter(identity: PdfIdentity): void {
    const phase = this.state.phase
    const drainable =
      phase === 'WEB_ACTIVE' ||
      phase === 'WEB_DRAINING' ||
      phase === 'WEB_DRAIN_FAILED' ||
      phase === 'NATIVE_ACTIVE' ||
      phase === 'NATIVE_DRAINING' ||
      phase === 'NATIVE_DRAIN_FAILED'
    if (!drainable || !sameIdentity(this.state.owner, identity)) {
      throw new Error(
        `stale lease: ${identity.sessionId}@${identity.generation}`
      )
    }
  }

  private record(): void {
    this.transitions.push(
      Object.freeze({
        phase: this.state.phase,
        target: this.state.target,
        owner: this.state.owner,
        epoch: this.state.epoch
      })
    )
  }
}
