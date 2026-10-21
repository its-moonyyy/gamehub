import { apiBaseUrl, getToken } from './api'

export type GameEvent =
  | { kind: 'table'; gameSlug: string; tableId: number }
  | { kind: 'invite' }
  | { kind: 'sync' }

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline'

const listeners = new Set<(event: GameEvent) => void>()
const statusListeners = new Set<(status: ConnectionStatus) => void>()
let status: ConnectionStatus = 'connecting'
let controller: AbortController | null = null
let retryTimer: number | null = null

function dispatch(event: GameEvent) {
  for (const listener of listeners) listener(event)
}

function setStatus(next: ConnectionStatus) {
  if (status === next) return
  status = next
  for (const listener of statusListeners) listener(next)
}

async function connect() {
  const token = getToken()
  if (!token || listeners.size === 0 || controller) return
  const current = new AbortController()
  controller = current

  try {
    const response = await fetch(`${apiBaseUrl}/events`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      signal: current.signal,
      cache: 'no-store',
    })
    if (!response.ok || !response.body) throw new Error('Event stream unavailable')
    setStatus('live')
    dispatch({ kind: 'sync' })

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n')
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const packet = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = packet.split('\n').filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart()).join('\n')
        if (data) {
          try {
            const event = JSON.parse(data) as GameEvent
            if (event.kind === 'table' || event.kind === 'invite') dispatch(event)
          } catch {
            // An invalid packet cannot break the live connection.
          }
        }
        boundary = buffer.indexOf('\n\n')
      }
    }
  } catch {
    // The slower fallback refresh remains active while the stream reconnects.
    if (!current.signal.aborted) setStatus(navigator.onLine ? 'reconnecting' : 'offline')
  } finally {
    if (controller === current) controller = null
    if (!current.signal.aborted && listeners.size > 0) {
      retryTimer = window.setTimeout(() => {
        retryTimer = null
        void connect()
      }, 2000)
    }
  }
}

export function subscribeConnectionStatus(listener: (status: ConnectionStatus) => void): () => void {
  statusListeners.add(listener)
  listener(status)
  return () => { statusListeners.delete(listener) }
}

/** One authenticated connection shared by the lobby, rooms and social badge. */
export function subscribeGameEvents(listener: (event: GameEvent) => void): () => void {
  listeners.add(listener)
  void connect()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      controller?.abort()
      controller = null
      if (retryTimer != null) window.clearTimeout(retryTimer)
      retryTimer = null
    }
  }
}
