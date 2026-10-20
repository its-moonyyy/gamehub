import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/** The table id column is a Postgres `int4`: nothing above this can exist. */
const MAX_INT4 = 2_147_483_647;

/**
 * Parses a table id from the URL.
 *
 * `ParseIntPipe` alone was not enough: `99999999999999999999` parsed happily
 * and was then rejected by Postgres itself, so the API answered with a 500.
 * An id outside the column's range can never name a table, so it is a 400.
 */
@Injectable()
export class TableIdPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const id = Number(value);
    if (!Number.isInteger(id) || id < 1 || id > MAX_INT4) {
      throw new BadRequestException('Validation failed (table id is invalid)');
    }
    return id;
  }
}
