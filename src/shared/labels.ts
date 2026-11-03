// The words Valet writes on the page itself. Each can be replaced in `labels:`, for another language or a different
// voice; {name}, {year}, {n} and {scope} fill in. What services and the assistant say comes from them, in their own words.
export const LABELS = {
  homelab: "{name}'s homelab", yourHomelab: 'Your homelab', goodMorning: 'Good morning', goodAfternoon: 'Good afternoon', goodEvening: 'Good evening', goodNight: 'Good night',
  overview: 'Overview', search: 'Type a command, or search services', review: 'Your {year} in review', reviewMore: 'What your homelab got up to this year, in a few screens', reviewGo: 'Play',
  ask: 'Ask {name}', askAnything: 'Ask {name} anything', askAbout: 'Ask about {scope}', allOf: 'All {n}', dismiss: 'Dismiss', message: 'Message {name}', messageHint: 'Message {name}, paste a link or drop a file',
  chatTitle: 'Talk to your homelab',
  thinking: 'Thinking', writing: 'Writing', thought: 'Thought', thoughtFor: 'Thought for {n}s', steps: '{n} steps', worked: 'Worked for {n}s',
  allow: 'Allow', notNow: 'Not now',
};
export type Labels = typeof LABELS;
