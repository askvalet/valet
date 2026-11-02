// A fixture stands in for a service: the integration's real code runs against it, so what's on the page is what Valet
// would really draw. Everything here is invented. Never paste a recorded response from a real service.
export type Answer = (url: string, init: any) => unknown;

export interface Fixture {
  /** Goes through the integration's own config schema. */
  config: Record<string, unknown>;
  /** The fake network: gets the URL and init of every ctx.http call, answers with the body (or a Response). */
  http?: Answer;
  /** Other states of a widget: the same code against another answer or config. `state` names it on the page. */
  states?: { widget?: string; state: string; label: string; config?: Record<string, unknown>; http?: Answer }[];
  /** Pictures: what ctx.image(ref) becomes. /art/… are demo/art files; anything else is drawn. */
  image?: (ref: string) => string;
  /** Runs before create(), for what can't go through ctx.http (a socket, a file). Undone after. */
  before?: () => void | (() => void) | Promise<void | (() => void)>;
  /** Fetch each widget this many times first, as a page would over time, so graphs built up by polling have a line. */
  warm?: number;
  /** Why the screenshot shows hand-made data rather than this integration's own code, if it must. */
  note?: string;
}
