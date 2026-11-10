// The wall display's touch mode (`wall.touch`): set around a card a finger may work, so its controls draw big enough to
// hit from an arm's length. `hold`: a press there must be held, for a lock or a garage door.
import { createContext } from 'react';

export const Touch = createContext<{ hold?: boolean } | null>(null);
/** How long a held press takes, in ms; `.touch-tile` draws the same time filling. */
export const HOLD = 800;
