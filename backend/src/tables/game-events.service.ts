import { Injectable, type MessageEvent } from '@nestjs/common';
import { interval, map, merge, Observable, Subject } from 'rxjs';
import { filter } from 'rxjs/operators';

export type GameEvent =
  | { kind: 'table'; gameSlug: string; tableId: number }
  | { kind: 'invite'; userId: number };

/** Lightweight invalidation stream; clients fetch their own masked snapshots. */
@Injectable()
export class GameEventsService {
  private readonly changes = new Subject<GameEvent>();

  stream(userId: number): Observable<MessageEvent> {
    return merge(
      this.changes.pipe(
        filter((change) => change.kind === 'table' || change.userId === userId),
        map((change) => ({ data: change })),
      ),
      interval(15_000).pipe(map(() => ({ data: { kind: 'heartbeat' } }))),
    );
  }

  table(gameSlug: string, tableId: number): void {
    this.changes.next({ kind: 'table', gameSlug, tableId });
  }

  invite(userId: number): void {
    this.changes.next({ kind: 'invite', userId });
  }
}
