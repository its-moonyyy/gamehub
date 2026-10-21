import { useEffect } from 'react'
import { subscribeGameEvents } from './game-events'

/** Live invalidation, deadline wakeup and a slow fallback for missed events. */
export function useLiveTable(
  tableId: string,
  refresh: () => Promise<void>,
  deadline: number | null,
  serverNow: number | null,
  fetchedAt: number,
) {
  useEffect(() => {
    const unsubscribe = subscribeGameEvents((event) => {
      if (event.kind === 'sync' || (event.kind === 'table' && event.tableId === Number(tableId))) {
        void refresh()
      }
    })
    const interval = window.setInterval(() => {
      if (!document.hidden) void refresh()
    }, 20_000)
    const onReturn = () => void refresh()
    window.addEventListener('focus', onReturn)
    window.addEventListener('online', onReturn)
    return () => {
      unsubscribe()
      window.clearInterval(interval)
      window.removeEventListener('focus', onReturn)
      window.removeEventListener('online', onReturn)
    }
  }, [tableId, refresh])

  useEffect(() => {
    if (deadline == null) return
    const delay = Math.max(100, deadline - (serverNow ?? Date.now()) - (Date.now() - fetchedAt) + 100)
    const timer = window.setTimeout(() => void refresh(), delay)
    return () => window.clearTimeout(timer)
  }, [deadline, serverNow, fetchedAt, refresh])
}
