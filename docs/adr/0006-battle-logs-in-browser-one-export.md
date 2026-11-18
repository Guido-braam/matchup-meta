# Battle logs and My lists stay in the browser, with one export for everything

Status: proposed (spec `.scratch/battle-logs/spec.md`)

Games pasted from Pokémon TCG Live and the lists they are played with are stored in the visitor's browser (IndexedDB, because hundreds of raw logs do not fit in localStorage), like Settings in ADR 0002. There is still no backend. We keep the raw log, player names included, so a better parser can read old games again; names are not shown in the app.

The data model is ready for an opt-in upload to a master dataset later (a random id per list, a log hash per game, a schema and parser version, sides stored as me/opponent, cards as Card index ids), but nothing is uploaded now.

This amends ADR 0002: export and import now carry Settings, My lists and games in one file, still never the API key, Advice or Deck chat. Importing a Settings-only file from before keeps working.

## Consequences

- Safari deletes site data after 7 days without a visit unless the site is on the home screen, so the site asks for persistent storage, suggests the home screen on iPhone and reminds the visitor to export.
- An export file now holds other players' PTCGL names from the raw logs.
- Uploading later needs its own ADR (server, consent, stripping names).
