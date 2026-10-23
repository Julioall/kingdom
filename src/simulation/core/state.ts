import engine from '../engine.js';
import { makePerson } from '../individuals/lifecycle.js';
export type PersonState = ReturnType<typeof makePerson>;
export type WorldState = Omit<ReturnType<typeof engine.createWorld>, 'people'> & { people: PersonState[] };
export interface WorldConfig { scenario: 'genesis'; }
export const defaultWorldConfig: WorldConfig = { scenario: 'genesis' };
