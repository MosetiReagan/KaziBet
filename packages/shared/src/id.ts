import { randomUUID } from 'node:crypto';
import { UUID } from './types.js';

export function generateId(): UUID {
  return randomUUID();
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidId(id: string): id is UUID {
  return UUID_REGEX.test(id);
}
