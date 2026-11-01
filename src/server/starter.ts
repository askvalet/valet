// A fresh install's config.yaml: a working page that needs no keys, with the next steps in comments.
export const STARTER = `# Valet. Save this file and the page updates by itself; a mistake is reported and the last good version keeps running.
# Every option: docs/configuration.md. To check this file: node dist/server.js config check

title: Home
# greeting: Sam                   # "Sam's homelab"
welcome: true                     # the getting-started card. Delete this line when you're done with it.

# Without sign-in Valet only shows things. To use its controls, turn on sign-in, or say your network is private:
# auth: { mode: local }           # also: oidc, proxy
# auth: { mode: none, trustNetwork: true }

integrations:
  news:
    type: hackernews
    limit: 6
  # An app with a JSON API, no code needed:
  # speedtest:
  #   type: api
  #   url: http://speedtest:8080/api/speedtest/latest
  #   headers: { Authorization: "Bearer \${SPEEDTEST_TOKEN}" }      # secrets go in .env
  #   title: Speedtest
  #   icon: wifi
  #   stats:
  #     - { label: Down, value: data.download|round, unit: " Mbps" }
  #     - { label: Up, value: data.upload|round, unit: " Mbps" }
  # Up/down for anything with a web page:
  # services:
  #   type: http
  #   targets:
  #     - { name: Router, url: http://192.168.1.1 }

links:
  Start:
    - { name: Valet docs, url: https://github.com/IbrahimIrfan/valet/blob/master/docs/configuration.md }

layout:
  - title: Start
    widgets: [links.start, news.stories]
`;
