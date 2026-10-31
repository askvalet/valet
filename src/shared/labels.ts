// The words Valet writes on the page itself. Each can be replaced in `labels:`, for another language or a different
// voice; {name}, {year}, {n} and {scope} fill in. What services and the assistant say comes from them, in their own words.
export const LABELS = {
  goodMorning: 'Good morning', goodAfternoon: 'Good afternoon', goodEvening: 'Good evening', goodNight: 'Good night',
  overview: 'Overview', search: 'Search services and actions', review: 'Your {year} in review',
  ask: 'Ask {name}…', askAnything: 'Ask {name} anything…', askAbout: 'Ask about {scope}…', allOf: 'All {n}', askWhy: 'Ask why', dismiss: 'Dismiss', message: 'Message {name}', messageHint: 'Message {name}, paste a link or drop a file',
  chatTitle: 'What would you like to know?', chatHint: 'Ask about anything on your homepage.',
  thinking: 'Thinking', writing: 'Writing', thought: 'Thought', thoughtFor: 'Thought for {n}s', steps: '{n} steps', worked: 'Worked for {n}s',
  allow: 'Allow', notNow: 'Not now',
};
export type Labels = typeof LABELS;
