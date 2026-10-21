import { describe, expect, it } from 'vitest';
import { GameEventsService } from './game-events.service.js';

describe('game event stream', () => {
  it('broadcasts table changes but delivers invitations only to their player', () => {
    const events = new GameEventsService();
    const first: unknown[] = [];
    const second: unknown[] = [];
    const a = events.stream(1).subscribe((event) => first.push(event.data));
    const b = events.stream(2).subscribe((event) => second.push(event.data));

    events.invite(1);
    events.table('chess', 42);

    expect(first).toEqual([
      { kind: 'invite', userId: 1 },
      { kind: 'table', gameSlug: 'chess', tableId: 42 },
    ]);
    expect(second).toEqual([{ kind: 'table', gameSlug: 'chess', tableId: 42 }]);
    a.unsubscribe();
    b.unsubscribe();
  });
});
