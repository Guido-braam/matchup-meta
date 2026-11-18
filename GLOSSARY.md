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

**Card**:
One printed card, identified by its set code and number, for example MEG 104. Two cards with the same name but a different set or number are different cards.
_Avoid_: print, printing

**Card index**:
The small file the site loads to turn a card's set code and number, or its name, into its image and its category, stage and trainer type.
_Avoid_: card database, lookup

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
A visitor's local frequencies and continent. Export and import carry Settings together with My lists and games.
_Avoid_: profile, account, preferences

**Advice**:
A written recommendation of which deck to play, generated with the visitor's own API key.
_Avoid_: coach, recommendation (use Recommended list for the card list)

**Deck chat**:
A conversation about one deck, generated with the visitor's own API key.

### My games

**Battle log**:
The text Pokémon TCG Live gives after a game, which a visitor copies and pastes; written from one player's side, so that player's draws are named and the opponent's are not.
_Avoid_: replay file, game log

**Game**:
One game read from a battle log and saved in the visitor's browser, linked to a list version of My lists.
_Avoid_: match (a Bo3 match is several games), battle

**My lists**:
The lists a visitor saved in Deck Lab to link games to.
_Avoid_: decks, saved decks

**List version**:
One numbered state (v1, v2, …) of a list in My lists; frozen once a game is linked to it, so an edit then adds a version.
_Avoid_: revision, build

**Reconstruction**:
The opponent's cards seen in a game, how many of the 60 are still unknown, and the most similar Regional lists.

**Replay**:
A game shown again step by step, with the board and the battle log side by side.

**Insight**:
One statement about a list's games from a fixed catalogue, always with the number of games and a margin, hidden below a minimum sample.
_Avoid_: tip, advice (Advice is the deck recommendation)
