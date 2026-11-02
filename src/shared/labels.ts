// The words Valet writes on the page itself. Each can be replaced in `labels:`, for another language or a different
// voice; {name}, {year}, {n} and {scope} fill in. What services and the assistant say comes from them, in their own words.
export const LABELS = {
  homelab: "{name}'s homelab", yourHomelab: 'Your homelab', goodMorning: 'Good morning', goodAfternoon: 'Good afternoon', goodEvening: 'Good evening', goodNight: 'Good night',
  overview: 'Overview', search: 'Search services and actions', review: 'Your {year} in review',
  ask: 'Ask {name}', askAnything: 'Ask {name} anything', askAbout: 'Ask about {scope}', allOf: 'All {n}', dismiss: 'Dismiss', message: 'Message {name}', messageHint: 'Message {name}, paste a link or drop a file',
  chatTitle: 'Talk to your homelab', chatHint: 'Reads freely, changes nothing without asking',
  thinking: 'Thinking', writing: 'Writing', thought: 'Thought', thoughtFor: 'Thought for {n}s', steps: '{n} steps', worked: 'Worked for {n}s',
  allow: 'Allow', notNow: 'Not now',
};
export type Labels = typeof LABELS;
