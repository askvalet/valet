// A complete community integration in one file: copy it into data/integrations/, add a block to config.yaml
//
//   integrations:
//     quotes:
//       type: quote-of-the-day
//       url: https://zenquotes.io/api/today
//
// and place its widget (`quotes.today`) in the layout. No build step, no imports: Valet hands it its toolkit.
export default ({ z, defineIntegration }) => defineIntegration({
  type: 'quote-of-the-day',
  name: 'Quote of the day',
  config: z.object({ url: z.string().url().default('https://zenquotes.io/api/today') }),
  create(cfg, ctx) {
    const today = async () => (await ctx.http(cfg.url))[0];
    return {
      widgets: {
        today: {
          title: 'Quote', interval: 3_600_000,
          async fetch() {
            const q = await today();
            return { type: 'verse', title: 'Quote of the day', icon: 'book', english: q.q, reference: q.a, summary: { label: 'Quote', value: q.a } };
          },
        },
      },
      tools: {
        quote_of_the_day: {
          description: "Today's quote.", access: 'read', input: z.object({}),
          async run() { const q = await today(); return { data: { quote: q.q, by: q.a } }; },
        },
      },
    };
  },
});
