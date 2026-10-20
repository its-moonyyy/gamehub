/**
 * Presence, as the seat dots show it. There are no sockets in this app: a
 * player counts as online while their requests keep arriving (the lobby and
 * the rooms poll), and drop to offline once they stop.
 */

/** How recently a player must have called the API to count as online. */
export const ONLINE_WINDOW_MS = 30_000;

/**
 * `online` — green, the player is here;
 * `offline` — red, nothing heard from them inside the window;
 * `not-ready` — orange, they are here but a waiting game is stuck on them.
 */
export type SeatStatus = 'online' | 'offline' | 'not-ready';

export function seatStatus(
  lastSeenAt: Date | null,
  options: {
    /** The seat's ready flag for the upcoming hand or race. */
    ready: boolean;
    /** `waiting` is the only phase where readying up is the blocker. */
    phase: string;
    /** The viewer's own seat is online by definition — they just called. */
    isViewer: boolean;
    now?: number;
  },
): SeatStatus {
  const { ready, phase, isViewer, now = Date.now() } = options;

  if (!isViewer) {
    if (lastSeenAt == null || now - lastSeenAt.getTime() > ONLINE_WINDOW_MS) {
      return 'offline';
    }
  }

  // Mid-hand or mid-race everyone who is here is playing: readying up only
  // matters in the waiting room, where it is what holds the game up.
  return phase === 'waiting' && !ready ? 'not-ready' : 'online';
}
