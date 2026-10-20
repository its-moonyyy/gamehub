import { describe, expect, it } from 'vitest';
import { ONLINE_WINDOW_MS, seatStatus } from './presence.js';

const NOW = 1_700_000_000_000;

const seenAgo = (ms: number) => new Date(NOW - ms);

describe('seatStatus', () => {
  it('is green for a player who just called the API', () => {
    expect(
      seatStatus(seenAgo(1_000), {
        ready: false,
        phase: 'preflop',
        isViewer: false,
        now: NOW,
      }),
    ).toBe('online');
  });

  it('is red once a player has gone quiet for longer than the window', () => {
    expect(
      seatStatus(seenAgo(ONLINE_WINDOW_MS + 1), {
        ready: false,
        phase: 'preflop',
        isViewer: false,
        now: NOW,
      }),
    ).toBe('offline');
  });

  it('is red for an account that was never seen', () => {
    expect(
      seatStatus(null, {
        ready: true,
        phase: 'waiting',
        isViewer: false,
        now: NOW,
      }),
    ).toBe('offline');
  });

  it('is amber while a waiting game is stuck on an online player', () => {
    expect(
      seatStatus(seenAgo(2_000), {
        ready: false,
        phase: 'waiting',
        isViewer: false,
        now: NOW,
      }),
    ).toBe('not-ready');
  });

  it('is green for a ready player, and mid-hand for everybody', () => {
    const recent = seenAgo(2_000);
    expect(
      seatStatus(recent, {
        ready: true,
        phase: 'waiting',
        isViewer: false,
        now: NOW,
      }),
    ).toBe('online');
    // Ready flags reset when a hand starts: being here is what counts then.
    expect(
      seatStatus(recent, {
        ready: false,
        phase: 'preflop',
        isViewer: false,
        now: NOW,
      }),
    ).toBe('online');
  });

  it('never calls the viewer offline — the request proves they are here', () => {
    expect(
      seatStatus(null, {
        ready: false,
        phase: 'waiting',
        isViewer: true,
        now: NOW,
      }),
    ).toBe('not-ready');
    expect(
      seatStatus(seenAgo(ONLINE_WINDOW_MS * 10), {
        ready: true,
        phase: 'waiting',
        isViewer: true,
        now: NOW,
      }),
    ).toBe('online');
  });

  it('keeps a player online right up to the edge of the window', () => {
    expect(
      seatStatus(seenAgo(ONLINE_WINDOW_MS), {
        ready: true,
        phase: 'waiting',
        isViewer: false,
        now: NOW,
      }),
    ).toBe('online');
  });
});
