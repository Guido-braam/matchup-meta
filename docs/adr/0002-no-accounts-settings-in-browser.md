# No accounts: settings and the API key stay in the visitor's browser

There is no backend and no login. Settings (local frequencies and continent) live in the visitor's browser, with export and import to move them; Advice and Deck chat call the Anthropic API directly with the visitor's own key, which is also only stored in their browser. Without a key those two features are off and the rest works. We accepted losing settings across devices (unless exported) to avoid running a server, storing personal data, or paying for other people's AI usage.

## Consequences

- Export and import carry settings only: never the API key, Advice or Deck chat history.
