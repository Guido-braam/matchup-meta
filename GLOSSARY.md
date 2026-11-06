# Matchup Meta

A public fan site that ranks Pokémon TCG decks by how well they do against the decks a player expects to meet, using tournament data from Trainerhill and Limitless.

## Language

### Decks and lists

**Deck**:
A named archetype as the data sources group it, for example by its main Pokémon.
_Avoid_: archetype (in the UI), build

**List**:
One concrete 60-card list for a deck.
_Avoid_: decklist variant, build

**Consensus list**:
The list that reflects the cards most players of a deck run, across all events worldwide.
_Avoid_: standard list, stock list

**Recommended list**:
The list the model expects to perform best for a deck, across all events worldwide.
_Avoid_: ML list, optimal list

**Matchup**:
The win, loss and tie record of one deck against one other deck.

### Events and share

**Regional**:
A Regional Championship whose results feed the share and the lists.
_Avoid_: tournament, event (when a Regional is meant)

**Share**:
The weighted fraction of top players at Regionals who played a deck.
_Avoid_: meta share, popularity, frequency

**Season**:
The Play! Pokémon season, counted from 1 August. The site shows one season: the current one once it has a Regional, otherwise the previous one.
_Avoid_: format, year

**Continent**:
One of the five Play! Pokémon zones (North America, Latin America, Europe, Oceania, Middle East & South Africa) that a visitor plays in; Regionals there count more towards share.
_Avoid_: region, zone

**Worldwide**:
The continent choice in which every Regional counts equally; the default.
_Avoid_: global, all regions

### Your meta

**Frequency level**:
How often a visitor expects to meet a deck, on a scale from Never to Very often.
_Avoid_: frequency percentage, weight, share

**Default frequency level**:
The frequency level that follows from a deck's share for the chosen continent.

**Local frequency**:
A frequency level the visitor set themselves, replacing the default for that deck.
_Avoid_: override, custom weight

**My meta**:
The complete set of frequency levels a visitor plays against.
_Avoid_: local meta, field

**Expected winrate**:
A deck's winrate averaged over its matchups, weighted by My meta.

**Tier list**:
All decks ranked into tiers by expected winrate.

### Visitor

**Settings**:
A visitor's local frequencies and continent; the only thing export and import carry.
_Avoid_: profile, account, preferences

**Advice**:
A written recommendation of which deck to play, generated with the visitor's own API key.
_Avoid_: coach, recommendation (use Recommended list for the card list)

**Deck chat**:
A conversation about one deck, generated with the visitor's own API key.
