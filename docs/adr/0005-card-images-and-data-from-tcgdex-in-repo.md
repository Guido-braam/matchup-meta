# Card images and data come from TCGdex and live in the repo

Card images and card data (category, stage, trainer type, HP, attacks and the rest) come from TCGdex, the free open-source card API, because it needs no key, maps the set codes in our lists (`abbreviation.official`, for example MEG → `me01`) and serves images on a predictable URL. We download every card of the Scarlet & Violet and Mega Evolution series, low-resolution images only, into `site/cards/` and commit them, so the site never calls an outside service on a visit. We chose this over linking the TCGdex CDN, which would keep the repo small but makes every visit depend on TCGdex. We chose whole series over "Standard-legal" because TCGdex's legal flag misses reprints that are legal by name (Pokégear 3.0 SVI 186) and the series rule is simple. Permission was not asked; this is a fan site and the maintainer accepts that, as with the sprites in ADR 0004.

## Consequences

- The repo grows by about 100 MB once and about 15 MB a year after; well under GitHub's 1 GB limits. Nothing is deleted at rotation, and deleting would not shrink git history anyway.
- `pricing` and `updated` are left out of the stored data (also inside `variants_detailed`): they change daily and would make every run commit megabytes.
- Card data is fetched only by hand, with the "Refresh cards" workflow (`refresh-cards.yml`, button in the Actions tab) or `python scripts/tcgdex_fetch.py` locally. It only downloads cards it does not have yet. The scheduled data refresh warns in its log when a list in `labs.json` uses a card the index does not know, which is the signal that a new set needs that button.
- A new series (after Mega Evolution) has to be added to the script by hand.
