import { drizzle } from 'drizzle-orm/d1';

import type { Env } from '../env';
import { schema } from './schema';

export * from './schema';

export function db(env: Env) {
  return drizzle(env.DB, { schema });
}
