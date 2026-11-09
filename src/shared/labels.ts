// The words Valet writes on the page itself. Each can be replaced in `labels:`, for another language or a different
// voice; {name}, {year}, {n} and {scope} fill in. What services and the assistant say comes from them, in their own words.
export const LABELS = {
  homelab: "{name}'s homelab", yourHomelab: 'Your homelab', goodMorning: 'Good morning', goodAfternoon: 'Good afternoon', goodEvening: 'Good evening', goodNight: 'Good night',
  overview: 'Overview', search: 'Type a command, or search services', review: 'Your {year} in review', reviewMore: 'What your homelab got up to this year, in a few screens', reviewGo: 'Play',
  ask: 'Ask {name}', askAnything: 'Ask {name} anything', askAbout: 'Ask about {scope}', allOf: 'All {n}', dismiss: 'Dismiss', message: 'Message {name}', messageHint: 'Message {name}, paste a link or drop a file',
  chatTitle: 'Talk to your homelab',
  working: 'Working', thinking: 'Thinking', writing: 'Writing', thought: 'Thought', thoughtFor: 'Thought for {n}s', steps: '{n} steps', worked: 'Worked for {n}s',
  allow: 'Allow', notNow: 'Not now',
  wall: 'Wall display', paused: 'Paused',
  context: '{used} of {total} tokens', contextUsed: '{used} tokens so far', contextFull: 'Long chats get slower and lose track of how they started.',
  contextAuto: 'When it fills up, the oldest messages are summarised to make room. A new chat starts clean and answers faster.', newChat: 'Start a new chat',
  compacted: 'Earlier messages summarised to make room', compactedOut: 'Earlier messages left out to make room',
  voiceStart: 'Speak', voiceStop: 'Stop and write it down', voiceListening: 'Listening', voiceWriting: 'Writing it down', voiceCancel: 'Cancel',
  voiceRead: 'Read aloud', voiceSilence: 'Stop reading',
};
export type Labels = typeof LABELS;
