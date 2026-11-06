"""Welke decklist werkt het best? Analyse op de Regionals-data van Limitless Labs.

Gebruik:
    python -I labs_ml.py                                  # alle decks met 300+ lijsten
    python -I labs_ml.py --decks dragapult-ex,n-zoroark   # specifieke decks

Leest de CSV's die limitless_labs_fetch.py in labs_data\\ zet en schrijft een verslag naar
labs_data\\ml_report.txt. Met --app-dir roept limitless_labs_fetch.py dit script zelf aan;
de resultaten komen dan in labs.json, zodat de app per deck een lijst voor jouw meta kan aanraden.

Per deck een logistische regressie op gameniveau (alleen numpy):
    kans op winst = matchup tegen het deck van de tegenstander
                  + sterkte van beide spelers (resultaten op hun andere Regionals)
                  + effect van de kaartkeuzes (aantal kopieën ten opzichte van het gemiddelde)
                  + effect van de kaartkeuzes per veelvoorkomende tegenstander
Elk effect wordt richting 0 getrokken (L2), zodat weinig data weinig zegt. Gelijkspel telt
als 1/3 winst, net als in de app. Recente events tellen zwaarder; verder weegt elk Regional even
zwaar, waar het ook gespeeld is (ADR 0003).

Drie toetsen op events die het model niet gezien heeft:
  1. Train op alle andere regionals en voorspel de overgebleven regional (voor elke regional):
     voorspelt het model met kaartkeuzes de uitslagen beter dan zonder? De regularisatie is de
     sterkste die binnen 1 standaardfout van de beste blijft (voorzichtig, de 1-SE-regel).
  2. Vooruit in de tijd: train alleen op eerdere regionals en voorspel de volgende, zoals bij een
     echt toernooi. Ook de spelerssterkte komt dan alleen uit eerdere regionals.
     Een deck krijgt alleen een aanbevolen lijst als toets 1 én toets 2 een duidelijk signaal geven.
  3. Winnen de lijsten die het model het hoogst inschat in werkelijkheid ook vaker?
Plus twee controles op spelerssterkte, omdat sterke spelers vaak ook betere lijsten kiezen:
  - Wonnen spelers met een hoog ingeschatte lijst ook vaker op hun andere Regionals?
  - Spelers die hetzelfde deck op meerdere Regionals speelden: deden ze het beter met de lijst
    die het model hoger inschat? (1 = het lijsteffect klopt, 0 = het is alleen spelerssterkte)
"""
import argparse
import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
TIE = 1 / 3
MIN_LIST_SHARE = 0.03   # kaart moet in minstens 3% van de lijsten zitten
MIN_DEVIATING = 30      # en minstens 30 lijsten moeten afwijken van het meest gespeelde aantal
OPP_MIN_GAMES = 80      # tegenstanders met minder games vallen samen onder "overig"
INTER_MIN_GAMES = 500   # kaartkeuze x tegenstander alleen voor tegenstanders met zoveel games
LAMBDAS = [10, 30, 100, 300, 1000, 3000]
INTER_FACTOR = 3        # interacties worden 3x zo sterk naar 0 getrokken als hoofdeffecten
SKILL_PRIOR = 10        # spelerssterkte: alsof er 10 extra games van 50% bij komen
MIN_LISTS = 300         # decks met minder lijsten krijgen geen advies
MIN_PAST = 3            # vooruit-toets: alleen events met minstens 3 eerdere events om op te trainen
MIN_TEST_GAMES = 50     # en minstens 50 games van het deck op het toets-event
pp = lambda x: f"{x * 100:+.1f}"


def load(folder):
    st = pd.read_csv(os.path.join(folder, "standings.csv"), dtype={"event_id": str})
    m = pd.read_csv(os.path.join(folder, "matches.csv"), dtype={"event_id": str})
    dl = pd.read_csv(os.path.join(folder, "decklists.csv"), dtype={"event_id": str, "number": str})
    ev = pd.read_csv(os.path.join(folder, "events.csv"), dtype={"event_id": str})
    for df in (st, dl):
        df["key"] = df["event_id"] + "/" + df["player"].astype(str)
    return st, m, dl, ev


def skill_table(st):
    """Sterkte per inschrijving: winrate van dezelfde speler op zijn andere Regionals (0 = onbekend)."""
    g = st.assign(score=st.wins + st.ties / 3, games=st.wins + st.losses + st.ties)
    tot = g.groupby("player")[["score", "games"]].sum()
    other = tot.loc[g.player].to_numpy() - g[["score", "games"]].to_numpy()
    skill = (other[:, 0] + SKILL_PRIOR / 2) / (other[:, 1] + SKILL_PRIOR) - 0.5
    return pd.DataFrame({"skill": skill, "known": (other[:, 1] > 0).astype(float)}, index=g.key)


def skill_table_past(st, past):
    """Zoals skill_table, maar alleen met resultaten van de events in `past` (wat je vóór het toernooi weet)."""
    g = st.assign(score=st.wins + st.ties / 3, games=st.wins + st.losses + st.ties)
    tot = g[g.event_id.isin(past)].groupby("player")[["score", "games"]].sum()
    t = tot.reindex(g.player).fillna(0).to_numpy()
    own = np.where(g.event_id.isin(past).to_numpy()[:, None], g[["score", "games"]].to_numpy(), 0)
    other = t - own
    skill = (other[:, 0] + SKILL_PRIOR / 2) / (other[:, 1] + SKILL_PRIOR) - 0.5
    return pd.DataFrame({"skill": skill, "known": (other[:, 1] > 0).astype(float)}, index=g.key)


def deck_games(deck, st, m, dl, ev, skill):
    entries = st[(st.deck_id == deck) & (st.has_decklist == 1)]
    lists = (dl[dl.key.isin(entries.key)]
             .pivot_table(index="key", columns="card_key", values="count", aggfunc="sum", fill_value=0))
    weight = ev.set_index("event_id")["recency"]
    sides = []
    for me, opp, my_deck, opp_deck, win in (("player1", "player2", "deck1", "deck2", 1),
                                            ("player2", "player1", "deck2", "deck1", 2)):
        g = m[(m[my_deck] == deck) & m[opp].notna() & (m.winner >= 0)]
        sides.append(pd.DataFrame({
            "event": g.event_id.to_numpy(),
            "key": (g.event_id + "/" + g[me].astype("Int64").astype(str)).to_numpy(),
            "opp_key": (g.event_id + "/" + g[opp].astype("Int64").astype(str)).to_numpy(),
            "opp_deck": g[opp_deck].fillna("").to_numpy(),
            "y": np.where(g.winner == win, 1.0, np.where(g.winner == 0, TIE, 0.0)),
        }))
    games = pd.concat(sides, ignore_index=True)
    games = games[games.key.isin(lists.index)].reset_index(drop=True)
    mirror = (games.opp_deck == deck).to_numpy()
    games["w_eval"] = np.where(mirror, 0.5, 1.0)  # spiegelpartijen staan er twee keer in
    games["w"] = games.event.map(weight).to_numpy() * games.w_eval
    for col, src in (("skill", "key"), ("opp_skill", "opp_key")):
        s = skill.reindex(games[src])
        games[col] = s.skill.fillna(0).to_numpy()
        games[col.replace("skill", "known")] = s.known.fillna(0).to_numpy()
    counts = games.opp_deck.value_counts()
    games["opp_cat"] = games.opp_deck.where(games.opp_deck.map(counts) >= OPP_MIN_GAMES, "overig")
    return lists, games


def card_features(lists):
    incl = (lists > 0).mean()
    deviating = (lists != lists.mode().iloc[0]).sum()
    keep = (incl >= MIN_LIST_SHARE) & (deviating >= MIN_DEVIATING)
    return list(lists.columns[keep])


class Design:
    """Kolommen: [intercept | tegenstander | sterkte (4) | kaarten | kaarten x grote tegenstander ...]."""

    def __init__(self, games, lists, cards, inter):
        self.opps = sorted(games.opp_cat.unique())
        self.cards = cards
        self.mean = lists[cards].mean().to_numpy()
        self.inter = inter
        self.k0 = 1 + len(self.opps) + 4          # eerste kaartkolom
        self.n_main = self.k0 + len(cards)          # einde van de hoofdeffecten

    def matrix(self, games, lists):
        n = len(games)
        xc = lists.loc[games.key, self.cards].to_numpy(float) - self.mean
        parts = [np.ones((n, 1)),
                 np.stack([(games.opp_cat == o).to_numpy(float) for o in self.opps], 1),
                 games[["skill", "known", "opp_skill", "opp_known"]].to_numpy(float), xc]
        parts += [xc * (games.opp_cat == o).to_numpy(float)[:, None] for o in self.inter]
        return np.hstack(parts)

    def penalty(self, lam, cols):
        p = np.array([0.0] + [2.0] * len(self.opps) + [1.0] * 4 + [lam] * len(self.cards)
                     + [lam * INTER_FACTOR] * (len(self.cards) * len(self.inter)))
        return p[:cols]

    def field_vector(self, xc, shares):
        """Kaartkeuzes als coëfficiëntvector: hoofdeffect + effect per tegenstander naar aandeel in het veld."""
        c = np.zeros((len(xc), self.k0 + len(self.cards) * (1 + len(self.inter))))
        c[:, self.k0:self.n_main] = xc
        for j, o in enumerate(self.inter):
            k = self.n_main + j * len(self.cards)
            c[:, k:k + len(self.cards)] = xc * shares.get(o, 0.0)
        return c


def fit(X, y, w, lam, b=None, iters=100):
    """Logistische regressie met L2 via Newton; y mag een fractie zijn (gelijkspel = 1/3)."""
    b = np.zeros(X.shape[1]) if b is None else b.copy()
    for _ in range(iters):
        p = 1 / (1 + np.exp(-(X @ b)))
        g = X.T @ (w * (p - y)) + lam * b
        H = (X * (w * p * (1 - p))[:, None]).T @ X + np.diag(lam)
        step = np.linalg.solve(H, g)
        b -= step
        if np.abs(step).max() < 1e-8:
            break
    return b, H


def logloss(X, b, y):
    p = np.clip(1 / (1 + np.exp(-(X @ b))), 1e-9, 1 - 1e-9)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def clustered(values, weights, clusters):
    """Gewogen gemiddelde met standaardfout, geclusterd per speler (zijn games hangen samen)."""
    n = weights.sum()
    tot = pd.Series(values * weights).groupby(clusters).sum()
    wt = pd.Series(weights).groupby(clusters).sum()
    mean = tot.sum() / n
    return mean, (tot - mean * wt).std() * np.sqrt(len(tot)) / n


def field_shares(games):
    return (games.groupby("opp_cat").w.sum() / games.w.sum()).to_dict()


def forward_test(deck, st, m, dl, ev, order, fwd_skill, lam, wi):
    """Toets 2: per event alleen trainen op de eerdere events en dat event voorspellen."""
    cities = ev.set_index("event_id")["name"].str.split().str[-1]
    parts, tests = [], []
    for e, sk in fwd_skill.items():
        past = order[:order.index(e)]
        lists, games = deck_games(deck, st, m, dl, ev, sk)
        games = games[games.event.isin(past + [e])].reset_index(drop=True)
        ent = st.set_index("key").loc[lists.index]
        train = lists[ent.event_id.isin(past).to_numpy()]
        gtr, gte = games[games.event != e], games[games.event == e]
        if len(gte) < MIN_TEST_GAMES or len(train) < MIN_DEVIATING:
            continue
        cards = card_features(train)
        if not cards:
            continue
        counts = gtr.opp_cat.value_counts()
        inter = [o for o in counts.index if o not in ("overig", deck) and counts[o] >= INTER_MIN_GAMES] if wi else []
        d = Design(gtr, train, cards, inter)
        Xtr, Xte = d.matrix(gtr, lists), d.matrix(gte, lists)
        ytr, wtr, yte = gtr.y.to_numpy(), gtr.w.to_numpy(), gte.y.to_numpy()
        bb, _ = fit(Xtr[:, :d.k0], ytr, wtr, d.penalty(0, d.k0))
        bf, _ = fit(Xtr, ytr, wtr, d.penalty(lam, Xtr.shape[1]))
        idx = lists.index[ent.event_id.to_numpy() == e]
        q = pd.Series(0, index=idx)
        if len(idx) >= 4:
            xc = lists.loc[idx, cards].to_numpy(float) - d.mean
            score = d.field_vector(xc, field_shares(gtr)) @ bf
            q[:] = pd.qcut(pd.Series(score).rank(method="first"), 4, labels=False).to_numpy() + 1
        parts.append(pd.DataFrame({"key": gte.key.to_numpy(), "w": gte.w_eval.to_numpy(), "y": yte,
                                   "d": logloss(Xte[:, :d.k0], bb, yte) - logloss(Xte, bf, yte),
                                   "q": q.reindex(gte.key).to_numpy()}))
        tests.append(cities.get(e, e))
    if not parts:
        return None
    a = pd.concat(parts, ignore_index=True)
    w, keys, qs = a.w.to_numpy(), a.key.to_numpy(), a.q.to_numpy()
    gain, se = clustered(a.d.to_numpy(), w, keys)
    rates = [clustered(a.y.to_numpy()[qs == k], w[qs == k], keys[qs == k]) for k in (1, 2, 3, 4)]
    return gain, se, rates, tests


def within_player(ent):
    """Helling van resultaat (boven verwachting) op lijstscore, binnen spelers met meerdere inschrijvingen."""
    multi = ent[ent.player.map(ent.player.value_counts()) >= 2].copy()
    if multi.player.nunique() < 20:
        return np.nan, np.nan, multi.player.nunique()
    multi["ds"] = multi.score - multi.groupby("player").score.transform("mean")
    multi["dr"] = multi.res - multi.groupby("player").res.transform("mean")

    def slope(g):
        den = (g.n * g.ds ** 2).sum()
        return (g.n * g.ds * g.dr).sum() / den if den > 0 else np.nan

    groups = [g for _, g in multi.groupby("player")]
    rng = np.random.default_rng(1)
    boots = [slope(pd.concat([groups[i] for i in rng.integers(0, len(groups), len(groups))])) for _ in range(500)]
    return slope(multi), np.nanstd(boots), len(groups)


def analyse(deck, name, st, m, dl, ev, skill, out, order, fwd_skill):
    lists, games = deck_games(deck, st, m, dl, ev, skill)
    cards = card_features(lists)
    counts = games.opp_cat.value_counts()
    inter = [o for o in counts.index if o not in ("overig", deck) and counts[o] >= INTER_MIN_GAMES]
    d = Design(games, lists, cards, inter)
    X = d.matrix(games, lists)
    y, w = games.y.to_numpy(), games.w.to_numpy()
    events, keys = games.event.to_numpy(), games.key.to_numpy()
    out(f"\n{'=' * 78}\n{name} ({deck}): {len(lists)} lijsten, {len(games)} games, {len(cards)} kaartkeuzes, "
        f"{len(inter)} tegenstanders met eigen kaarteffecten; sterkte bekend in {games.known.mean():.0%} van de games")

    # Toets 1: per event trainen op de andere events en de uitslagen voorspellen.
    settings = [(lam, wi) for wi in (False, True) for lam in LAMBDAS]
    base_ll, p_base = np.zeros(len(games)), np.zeros(len(games))
    full_ll = {s: np.zeros(len(games)) for s in settings}
    fold_b = {}
    for e in np.unique(events):
        tr, te = events != e, events == e
        b, _ = fit(X[tr, :d.k0], y[tr], w[tr], d.penalty(0, d.k0))
        base_ll[te] = logloss(X[te, :d.k0], b, y[te])
        p_base[te] = 1 / (1 + np.exp(-(X[te, :d.k0] @ b)))
        for wi in (False, True):
            cols = X.shape[1] if wi else d.n_main
            b = None
            for lam in LAMBDAS:  # oplopend, warm gestart
                b, _ = fit(X[tr, :cols], y[tr], w[tr], d.penalty(lam, cols), b)
                full_ll[(lam, wi)][te] = logloss(X[te, :cols], b, y[te])
                fold_b[(e, lam, wi)] = b
    results = []
    out("Toets 1, voorspellen op een ongezien event (winst in log-loss per game x1000):")
    for lam, wi in settings:
        gain, se = clustered(base_ll - full_ll[(lam, wi)], games.w_eval.to_numpy(), keys)
        results.append((gain, se, lam, wi))
        out(f"  lambda {lam:>4}{' + per tegenstander' if wi else '                   '}: "
            f"{gain * 1000:+6.2f} ± {se * 1000:4.2f}  (z = {gain / se:+.1f})")
    best_gain, best_se, _, wi = max(results)
    # 1-SE-regel: de sterkste regularisatie die binnen 1 standaardfout van de beste voorspelling blijft.
    lam = max(lm for g, s, lm, x in results if x == wi and g >= best_gain - best_se)
    gain, se = next((g, s) for g, s, lm, x in results if lm == lam and x == wi)
    cols = X.shape[1] if wi else d.n_main
    signal_loeo = gain > 2 * se
    out(f"  Gekozen (1-SE-regel): lambda {lam}{' met effecten per tegenstander' if wi else ''}. "
        + ("Duidelijk signaal in de kaartkeuzes." if signal_loeo else "Geen duidelijk signaal."))

    # Toets 2: vooruit in de tijd, met dezelfde instelling.
    fwd = forward_test(deck, st, m, dl, ev, order, fwd_skill, lam, wi)
    if fwd is None:
        fgain = fse = np.nan
        signal_fwd = not fwd_skill  # te weinig events in het seizoen: dan telt alleen toets 1
        out("Toets 2, vooruit in de tijd: " + ("nog niet mogelijk, te weinig events." if not fwd_skill
                                                else "te weinig games van dit deck op de latere events."))
    else:
        fgain, fse, frates, tests = fwd
        signal_fwd = fgain > 2 * fse
        out(f"Toets 2, vooruit in de tijd (train alleen op eerdere events, toets op {', '.join(tests)}): "
            f"{fgain * 1000:+.2f} ± {fse * 1000:.2f} (z = {fgain / fse:+.1f}). "
            + ("Het signaal houdt stand." if signal_fwd else "Het signaal houdt geen stand."))
        out("  werkelijke winrate per kwart op die events: " + "  ".join(f"Q{k + 1} {r[0]:.1%}" for k, r in enumerate(frates)))
    signal = signal_loeo and signal_fwd
    out(f"  Aanbevolen lijst voor dit deck: {'ja' if signal else 'nee'} (toets 1 en 2 moeten allebei slagen)")

    pbar = (y * w).sum() / w.sum()
    scale = pbar * (1 - pbar)  # van log-odds naar winkans rond de gemiddelde winrate

    # Toets 2: deel de lijsten per ongezien event in vier groepen naar de score van het model.
    entries = st.set_index("key").loc[lists.index]
    ent = pd.DataFrame({"q": 0, "score": 0.0, "player": entries.player.to_numpy()}, index=lists.index)
    for e in np.unique(events):
        b = fold_b[(e, lam, wi)]
        idx = lists.index[entries.event_id.to_numpy() == e]
        xc = lists.loc[idx, cards].to_numpy(float) - d.mean
        score = d.field_vector(xc, field_shares(games[events != e]))[:, :cols] @ b * scale
        ent.loc[idx, "score"] = score
        if len(idx) >= 4:  # te weinig lijsten op dit event om in vieren te delen
            ent.loc[idx, "q"] = pd.qcut(pd.Series(score).rank(method="first"), 4, labels=False).to_numpy() + 1
    games["q"] = ent.q.reindex(keys).to_numpy()
    games["res"] = y - p_base  # resultaat boven verwachting (matchups + bekende spelerssterkte)
    we = games.w_eval.to_numpy()

    def quarter_gap(col, sel):
        r = [clustered(games[col].to_numpy()[s2], we[s2], keys[s2])
             for s2 in (sel & (games.q == k).to_numpy() for k in (1, 2, 3, 4))]
        return r, r[3][0] - r[0][0], np.hypot(r[3][1], r[0][1])

    rates, qdiff, qse = quarter_gap("y", np.ones(len(games), bool))
    out("Toets 3, werkelijke winrate op een ongezien event per kwart van de lijsten (laagste score -> hoogste):")
    out("  " + "  ".join(f"Q{k + 1} {r[0]:.1%}" for k, r in enumerate(rates))
        + f"   verschil beste - slechtste kwart {pp(qdiff)} ± {qse * 100:.1f} procentpunt")

    # Controles op spelerssterkte.
    sk = skill.reindex(lists.index)
    ent["skill"], ent["known"] = sk.skill.to_numpy(), sk.known.to_numpy()
    known = games.known.to_numpy() == 1
    _, rdiff, rse = quarter_gap("res", known)
    by_q = ent[ent.known == 1].groupby("q").skill.mean()
    out(f"Controle sterkte: winrate op hun andere Regionals (t.o.v. 50%) per kwart: "
        + "  ".join(f"Q{int(k)} {pp(v)}" for k, v in by_q.items())
        + f"  (n = {int((ent.known == 1).sum())}); verschil Q4-Q1 na correctie voor sterkte {pp(rdiff)} ± {rse * 100:.1f} pp")
    ent["res"] = pd.Series(games.res.to_numpy() * we).groupby(keys).sum().reindex(ent.index).to_numpy() \
        / pd.Series(we).groupby(keys).sum().reindex(ent.index).to_numpy()
    ent["n"] = pd.Series(we).groupby(keys).sum().reindex(ent.index).to_numpy()
    slope, slope_se, n_players = within_player(ent)
    out(f"Controle binnen dezelfde speler ({n_players} spelers met dit deck op meerdere Regionals): "
        + (f"{slope:.2f} ± {slope_se:.2f} (1 = lijsteffect klopt, 0 = alleen spelerssterkte)"
           if np.isfinite(slope) else "te weinig spelers"))

    # Eindmodel op alle data.
    b, H = fit(X[:, :cols], y, w, d.penalty(lam, cols))
    cov = np.linalg.inv(H)
    shares = field_shares(games)
    out(f"  Sterkte: een speler die elders 10 procentpunt vaker won, wint hier {pp(b[d.k0 - 4] * 0.1 * scale)} "
        f"procentpunt vaker (± {np.sqrt(cov[d.k0 - 4, d.k0 - 4]) * 0.1 * scale * 100:.1f})")

    # Effect per extra kopie tegen het veld (hoofdeffect + per tegenstander naar aandeel).
    C = d.field_vector(np.eye(len(cards)), shares)[:, :cols]
    eff = pd.DataFrame({"card": cards, "e": C @ b * scale, "se": np.sqrt(np.einsum("ij,jk,ik->i", C, cov, C)) * scale,
                        "mean": d.mean, "incl": (lists[cards] > 0).mean().to_numpy()})
    eff["z"] = eff.e / eff.se
    out("Kaarteffecten tegen het veld (per extra kopie, procentpunt winkans; |z| >= 2):")
    for r in eff[eff.z.abs() >= 2].sort_values("z", ascending=False).itertuples():
        out(f"  {r.card:<42} {pp(r.e)} ± {r.se * 100:3.1f}  (gemiddeld {r.mean:.1f}, in {r.incl:.0%} van de lijsten)")
    if wi:
        for j, o in enumerate(inter):
            # Alleen kaarten waarvan het extra effect tegen deze tegenstander zelf duidelijk is.
            k = d.n_main + j * len(cards)
            extra, extra_se = b[k:k + len(cards)], np.sqrt(np.diag(cov)[k:k + len(cards)])
            total = (b[d.k0:d.n_main] + extra) * scale
            hits = [i for i in np.argsort(-np.abs(extra / extra_se)) if abs(extra[i] / extra_se[i]) >= 2][:4]
            if hits:
                out(f"  tegen {o}: " + "; ".join(f"{cards[i]} {pp(total[i])} (waarvan {pp(extra[i] * scale)} "
                                                 f"specifiek)" for i in hits))

    # Aanbevolen echte lijst: Day 2-lijst met de hoogste ondergrens (schatting min 1 standaardfout).
    day2 = lists.index[entries.day2.to_numpy() == 1]
    xc = lists.loc[day2, cards].to_numpy(float) - d.mean
    Cl = d.field_vector(xc, shares)[:, :cols]
    up, use = Cl @ b * scale, np.sqrt(np.einsum("ij,jk,ik->i", Cl, cov, Cl)) * scale
    out(f"Voorspelde winst van de Day 2-lijsten t.o.v. de gemiddelde lijst: p10 {pp(np.percentile(up, 10))}, "
        f"mediaan {pp(np.median(up))}, p90 {pp(np.percentile(up, 90))} procentpunt")
    out("Aanbevolen Day 2-lijsten tegen het veld (hoogste ondergrens = schatting min 1 standaardfout):")
    cities = ev.set_index("event_id")["name"].str.split().str[-1]
    for r in np.argsort(-(up - use))[:3]:
        e = entries.loc[day2[r]]
        contrib = pd.Series(xc[r] * (C @ b) * scale, index=cards)
        diff = pd.Series(xc[r], index=cards)
        out(f"  plek {int(e.placement)} in {cities.get(e.event_id, e.event_id)} ({e.wins}-{e.losses}-{e.ties}): "
            f"{pp(up[r])} ± {use[r] * 100:.1f} pp")
        out("    helpt: " + (", ".join(f"{c} {diff[c]:+.1f} ({pp(v)})" for c, v in
                                    contrib.sort_values(ascending=False).items() if v >= 0.002) or "-"))
        out("    kost: " + (", ".join(f"{c} {diff[c]:+.1f} ({pp(v)})" for c, v in
                                   contrib.sort_values().items() if v <= -0.002) or "-"))
    summary = {"deck": deck, "lists": len(lists), "games": len(games), "gain": gain, "se": se, "signal": signal,
               "fgain": fgain, "fse": fse, "q": [r[0] for r in rates], "qdiff": qdiff, "qse": qse,
               "rdiff": rdiff, "rse": rse, "slope": slope, "slope_se": slope_se}

    # Voor de app: het model (in log-odds) en alle Day 2-lijsten, gelijke lijsten samengevoegd.
    # De app weegt de effecten per tegenstander met jouw "hoe vaak" en kiest zo de lijst voor jouw meta.
    n_inter = len(inter) if wi else 0
    export = {"signal": bool(signal), "z": round(float(gain / se), 2),
              "z_fwd": round(float(fgain / fse), 2) if np.isfinite(fgain) and fse > 0 else None,
              "games": int(len(games)),
              "within": [round(float(slope), 2), round(float(slope_se), 2)] if np.isfinite(slope) else None,
              "base": float(b[0]), "opps": {o: float(b[1 + i]) for i, o in enumerate(d.opps)},
              "inter": list(inter[:n_inter]), "cards": [], "cands": []}
    if signal:
        var = np.diag(cov)
        for i, c in enumerate(cards):
            ks = [d.n_main + j * len(cards) + i for j in range(n_inter)]
            export["cards"].append({"key": c, "b": float(b[d.k0 + i]), "se": float(np.sqrt(var[d.k0 + i])),
                                    "mean": float(d.mean[i]), "g": [float(b[k]) for k in ks],
                                    "gse": [float(np.sqrt(var[k])) for k in ks]})
        main_d = xc @ b[d.k0:d.n_main]
        inter_d = [xc @ b[d.n_main + j * len(cards):d.n_main + (j + 1) * len(cards)] for j in range(n_inter)]
        full = lists.loc[day2]
        nz = full.to_numpy()
        signature = [";".join(f"{full.columns[j]}={nz[i, j]}" for j in np.flatnonzero(nz[i])) for i in range(len(full))]
        sizes = ev.set_index("event_id")["players"]  # hele event, ook als alleen de top meetelt
        e2 = entries.loc[day2]
        seen = {}
        for r in np.argsort((e2.placement / e2.event_id.map(sizes)).to_numpy()):  # beste plek blijft bij dubbele lijsten
            if signature[r] in seen:
                export["cands"][seen[signature[r]]]["n"] += 1
                continue
            e = e2.iloc[r]
            seen[signature[r]] = len(export["cands"])
            export["cands"].append({
                "event": e.event_id, "place": int(e.placement), "of": int(sizes[e.event_id]),
                "rec": f"{e.wins}-{e.losses}-{e.ties}", "top": int(e.topcut), "n": 1,
                "d": float(main_d[r]), "di": [float(x[r]) for x in inter_d], "se": float(use[r]),
                "counts": {k: int(v) for k, v in zip(full.columns[np.flatnonzero(nz[r])], nz[r][nz[r] > 0])}})
    return summary, export


def decks_with_lists(st, min_lists):
    c = st[(st.has_decklist == 1) & st.deck_id.notna() & (st.deck_id != "other")].deck_id.value_counts()
    return list(c[c >= min_lists].index)


def run(folder, decks=None, min_lists=MIN_LISTS, verbose=True):
    """Analyseert de decks, schrijft ml_report.txt en geeft per deck-id de gegevens voor de app."""
    st, m, dl, ev = load(folder)
    skill = skill_table(st)
    names = pd.read_csv(os.path.join(folder, "archetypes.csv")).set_index("deck_id")["deck_name"].to_dict()
    decks = decks or decks_with_lists(st, min_lists)
    lines = []

    def out(s):
        lines.append(s)
        if verbose:
            print(s, flush=True)

    order = list(ev.sort_values(["start_date", "event_id"]).event_id)
    fwd_skill = {e: skill_table_past(st, order[:i]) for i, e in enumerate(order) if i >= MIN_PAST}
    out(f"Data: {len(ev)} events, {len(st)} spelers, {len(m)} matches")
    summary, exports = [], {}
    for x in decks:
        s, exports[x] = analyse(x, names.get(x, x), st, m, dl, ev, skill, out, order, fwd_skill)
        summary.append(s)
        if not verbose:
            print(f"  {names.get(x, x)}: {'aanbevolen lijst' if s['signal'] else 'geen aanbevolen lijst'}", flush=True)
    out(f"\n{'=' * 78}\nSamenvatting (toetsen op ongeziene events; Q4-Q1 = beste min slechtste kwart in winrate):")
    for s in summary:
        within = f"{s['slope']:.2f} ± {s['slope_se']:.2f}" if np.isfinite(s["slope"]) else "-"
        fwd = f"{s['fgain'] * 1000:+5.2f} ± {s['fse'] * 1000:4.2f}" if np.isfinite(s["fgain"]) else "-"
        out(f"  {s['deck']:<22} {s['lists']:>5} lijsten  log-loss {s['gain'] * 1000:+5.2f} ± {s['se'] * 1000:4.2f}  "
            f"vooruit {fwd}  Q4-Q1 {pp(s['qdiff'])} ± {s['qse'] * 100:.1f} pp, na sterkte {pp(s['rdiff'])} ± "
            f"{s['rse'] * 100:.1f}  binnen speler {within}  {'advies' if s['signal'] else 'geen advies'}")
    with open(os.path.join(folder, "ml_report.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return exports


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data", default=os.path.join(HERE, "labs_data"), help="map met de CSV's")
    p.add_argument("--decks", default="", help="deck-id's, komma-gescheiden; standaard alle decks met genoeg lijsten")
    p.add_argument("--min-lists", type=int, default=MIN_LISTS, help="minimaal aantal lijsten per deck")
    a = p.parse_args()
    run(a.data, [x.strip() for x in a.decks.split(",") if x.strip()], a.min_lists)


if __name__ == "__main__":
    main()
