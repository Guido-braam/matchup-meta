// What a visitor sees, on the committed fixture data (tests/fixtures/).
import { readFileSync } from "node:fs";
import { test as base, expect } from "@playwright/test";
import { FIXTURES } from "./fixture-server.js";

const fixture = name => JSON.parse(readFileSync(`${FIXTURES}/${name}`, "utf8"));
// "2026-10-16T15:04" -> "16 Oct 2026", written out here instead of reusing the page's formatter.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = s => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
// The two tabs and the Ask Claude button in the header; My meta is a popup, not a view.
const VIEWS = { tierlist: "#tab-tierlist", lab: "#tab-lab", advice: "#open-ask" };
const metaDialog = page => page.locator("#dialog-meta");
// A deck page is reached only by clicking a deck; it has no tab.
const openDeck = async (page, name) => {
  await page.locator("#tab-tierlist").click();
  await page.locator("#tiers .tile[data-deck]", { hasText: name }).click();
  await expect(page.locator("#deck-detail h2")).toHaveText(name);
};

// Google Fonts is the only outside request the page makes; answer it with an empty
// stylesheet so the tests need no network. Any other outside request is blocked,
// which shows up as a console error and fails the test.
const FONT_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const local = new URL(baseURL).host;
    await page.route("**/*", route => {
      const host = new URL(route.request().url()).host;
      if (host === local) return route.continue();
      if (FONT_HOSTS.has(host)) return route.fulfill({ status: 200, contentType: "text/css", body: "" });
      return route.abort();
    });
    await use(page);
  },
  // Console errors and uncaught exceptions on the page, collected from the first request on.
  consoleErrors: async ({ page }, use) => {
    const errors = [];
    page.on("console", msg => { if (msg.type() === "error") errors.push(`console: ${msg.text()}`); });
    page.on("pageerror", err => errors.push(`pageerror: ${err.message}`));
    await use(errors);
  },
});

// A Dragapult list from the fixture, in PTCG Live format (different from Deck Lab's own sample).
const PASTED_LIST = `Pokémon: 20
4 Drakloak ASC 159
4 Dreepy ASC 158
3 Dragapult ex ASC 160
2 Budew ASC 16
2 Munkidori ASC 99
1 Dudunsparce TEF 129
1 Dunsparce TEF 128
1 Fezandipiti ex ASC 142
1 Meowth ex POR 62
1 Moltres PFL 14

Trainer: 32
4 Buddy-Buddy Poffin ASC 184
4 Crushing Hammer POR 71
4 Lillie's Determination MEG 119
4 Poké Pad POR 81
3 Boss's Orders MEG 114
3 Night Stretcher ASC 196
3 Ultra Ball MEG 131
2 Crispin SCR 133
2 Risky Ruins MEG 127
1 Judge POR 76
1 Rosa's Encouragement POR 84
1 Unfair Stamp TWM 165

Energy: 8
3 Fire Energy MEE 2
3 Psychic Energy MEE 5
2 Darkness Energy MEE 7

Total Cards: 60`;

test("tier list renders without console errors", async ({ page, consoleErrors }) => {
  await page.goto("/");

  const tiles = page.locator("#tiers .tile[data-deck]");
  await expect(tiles.first()).toBeVisible();
  // Every fixture deck you meet gets a tile; "Other" is never a deck.
  for (const name of ["Dragapult", "N's Zoroark", "Basic Box", "Festival Lead", "Crustle"]) {
    await expect(tiles.filter({ hasText: name })).toHaveCount(1);
  }
  await expect(tiles.filter({ hasText: "Other" })).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect(consoleErrors).toEqual([]);
});

test("a deck page opens from the tier list", async ({ page, consoleErrors }) => {
  await page.goto("/");

  await page.locator("#tiers .tile[data-deck]", { hasText: "Dragapult" }).click();

  await expect(page).toHaveURL(/#deck\/dragapult-ex$/);
  await expect(page.locator("#page-deck")).toBeVisible();
  const detail = page.locator("#deck-detail");
  await expect(detail).toContainText("Dragapult");
  // Its decklists come from the Regionals in the fixture.
  await expect(detail.locator("details.list").first()).toBeAttached();
  expect(consoleErrors).toEqual([]);
});

test("the header has two tabs and two equal buttons for My meta and Ask Claude", async ({ page, consoleErrors }) => {
  await page.goto("/");
  await expect(page.getByRole("tab")).toHaveText(["Tier list", "Deck Lab"]);
  for (const name of ["My meta", "Ask Claude"]) {
    const b = page.locator("header").getByRole("button", { name, exact: true });
    await expect(b).toHaveClass("btn"); // same style, neither highlighted
    await b.click();
    await expect(b).toHaveClass("btn");
    if (name === "My meta") await page.keyboard.press("Escape");
  }
  await expect(page.locator("#dialog-advice")).toBeVisible();
  await expect(page.locator("#deck-select, button[data-picker=deck-select]")).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test("the tier list says what it is based on", async ({ page, consoleErrors }) => {
  await page.goto("/");
  await expect(page.locator("#tier-basis")).toHaveText("Expected winrate against your meta: Worldwide, 0 changes");
  await page.locator("#open-meta").click();
  await chooseLevel(page, "Dragapult", "Never");
  await page.locator("#continent").selectOption("eu");
  await expect(page.locator("#tier-basis")).toHaveText("Expected winrate against your meta: Europe, 1 change");
  expect(consoleErrors).toEqual([]);
});

test("a deck page has its own address: back returns to the tier list", async ({ page, consoleErrors }) => {
  await page.goto("/");
  await page.locator("#tiers .tile[data-deck]", { hasText: "Dragapult" }).click();
  await expect(page).toHaveURL(/#deck\/dragapult-ex$/);
  await expect(page.locator("#deck-detail h2")).toHaveText("Dragapult");

  // An opponent in a matchup row opens that deck, at its own address.
  await page.locator("#deck-detail .mu-name", { hasText: "Crustle" }).click();
  await expect(page).toHaveURL(/#deck\/crustle-dri$/);
  await expect(page.locator("#deck-detail h2")).toHaveText("Crustle");

  await page.goBack();
  await expect(page.locator("#deck-detail h2")).toHaveText("Dragapult");
  await page.goBack();
  await expect(page.locator("#page-tierlist")).toBeVisible();
  await expect(page.locator("#page-deck")).toBeHidden();

  await page.goForward();
  await expect(page.locator("#deck-detail h2")).toHaveText("Dragapult");
  await page.getByRole("link", { name: "Back to tier list" }).click();
  await expect(page.locator("#page-tierlist")).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("decks you never meet are left out until you show them, on the deck page and the tier list", async ({ page, consoleErrors }) => {
  await page.goto("/");
  await expect(page.locator("#tier-never")).toBeHidden(); // nothing is Never by default
  await expect(page.locator("#page-tierlist details.how summary")).toHaveText("How is this calculated?");
  await expect(page.locator("#page-tierlist details.how .note")).toBeHidden();
  await expect(page.locator("input[type=checkbox]#show-never, input[type=checkbox]#hide-never-opp")).toHaveCount(0);

  // The frequency label on a matchup row still sets the level.
  await openDeck(page, "Crustle");
  await expect(page.locator("#deck-never")).toHaveCount(0);
  const row = page.locator("#deck-detail .mu", { hasText: "Dragapult" });
  await row.locator(".freq-select").selectOption("0");
  const deckLine = page.locator("#deck-never");
  await expect(deckLine).toHaveText("1 deck you never meet is left out. Show them");
  await expect(row).toHaveCount(0);
  await deckLine.getByRole("button", { name: "Show them" }).click();
  await expect(deckLine).toHaveText("1 deck you never meet is shown. Hide them");
  await expect(page.locator("#deck-detail .mu.never")).toContainText("Dragapult");
  await deckLine.getByRole("button", { name: "Hide them" }).click();
  await expect(row).toHaveCount(0);

  await page.locator("#tab-tierlist").click();
  const tierLine = page.locator("#tier-never");
  const tile = page.locator("#tiers .tile[data-deck]", { hasText: "Dragapult" });
  await expect(tierLine).toHaveText("1 deck you never meet is left out. Show them");
  await expect(tile).toHaveCount(0);
  await tierLine.getByRole("button", { name: "Show them" }).click();
  await expect(tierLine).toHaveText("1 deck you never meet is shown. Hide them");
  await expect(tile).toHaveClass(/never/);

  // The choice is not stored: a reload starts hidden again.
  await page.reload();
  await expect(tierLine).toHaveText("1 deck you never meet is left out. Show them");
  await expect(tile).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test("a deck page loads directly from its address, with every block and the section links", async ({ page, consoleErrors }) => {
  await page.goto("/#deck/dragapult-ex");
  const detail = page.locator("#deck-detail");
  await expect(detail.locator("h2")).toHaveText("Dragapult");
  await expect(page.getByRole("link", { name: "Back to tier list" })).toBeVisible();
  await expect(detail.locator(".deck-links button")).toHaveText(["Matchups", "Key numbers", "Lists", "Deck chat"]);
  await expect(detail.locator(".mu-cols")).toBeVisible();
  await expect(detail.locator("h3")).toContainText(["Favorable", "Unfavorable", "Key numbers", "Played lists", "Consensus list"]);
  await expect(page.locator("#deck-chat")).toBeVisible();
  // The tabs stay as they were: a deck page is none of them.
  await expect(page.locator("#tab-tierlist")).toHaveAttribute("aria-selected", "false");
  expect(consoleErrors).toEqual([]);
});

for (const hash of ["#deck/no-such-deck", "#deck", "#deck/", "#nonsense"]) {
  test(`${hash} shows the tier list`, async ({ page, consoleErrors }) => {
    await page.goto("/" + hash);
    await expect(page.locator("#tiers .tile[data-deck]").first()).toBeVisible();
    await expect(page.locator("#page-deck")).toBeHidden();
    await expect(page.locator("#tab-tierlist")).toHaveAttribute("aria-selected", "true");
    expect(consoleErrors).toEqual([]);
  });
}

test("#meta and #advice open their popup over the tier list", async ({ page, consoleErrors }) => {
  await page.goto("/#meta");
  await expect(metaDialog(page)).toBeVisible();
  await expect(page.locator("#page-tierlist")).toBeVisible();
  await expect(page.locator("#page-meta")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/#tierlist$/);
  await page.goto("/#advice");
  await expect(page.getByRole("dialog", { name: "Ask Claude" })).toBeVisible();
  await expect(page.locator("#page-tierlist")).toBeVisible();
  await expect(page.locator("#tiers .tile[data-deck]").first()).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("Ask Claude is a modal dialog: × and Esc close it and focus returns to the button", async ({ page, consoleErrors }) => {
  await page.goto("/");
  const ask = page.locator("#open-ask"), dialog = page.getByRole("dialog", { name: "Ask Claude" });
  await expect(page.locator("#page-advice")).toHaveCount(0); // no Advice page left
  await ask.click();
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(d => d.matches(":modal"))).toBe(true);
  await expect(dialog.getByRole("heading", { name: "Which deck should I play at locals?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(ask).toBeFocused();
  await ask.click();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(ask).toBeFocused();
  await expect(page.locator("#tab-tierlist")).toHaveAttribute("aria-selected", "true");
  expect(consoleErrors).toEqual([]);
});

test("only the Tier list or Deck Lab tab is remembered", async ({ page }) => {
  await page.goto("/");
  await page.locator("#tab-lab").click();
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem("matchup-meta-tab")))).toBe("lab");
  await page.locator("#open-meta").click();
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem("matchup-meta-tab")))).toBe("lab");
  await page.goto("/");
  await expect(page.locator("#page-lab")).toBeVisible();

  for (const old of ["meta", "advice", "deck"]) {
    await page.evaluate(v => localStorage.setItem("matchup-meta-tab", JSON.stringify(v)), old);
    await page.goto("/");
    await expect(page.locator("#page-tierlist")).toBeVisible();
  }
});

test("Deck Lab checks a pasted list",async ({ page, consoleErrors }) => {
  await page.goto("/");
  await page.locator("#tab-lab").click();
  const lab = page.locator("#lab-host"); // Deck Lab lives in an open shadow root; locators pierce it.

  await lab.locator("#deck").fill(PASTED_LIST);
  await lab.locator("#btn-parse").click();

  await expect(lab.locator("#total-badge")).toHaveText("60 / 60");
  await expect(lab.locator("#cardlist")).toContainText("Dragapult ex");
  await expect(lab.locator("#cardlist")).not.toContainText("Jellicent ex"); // Deck Lab's own sample is gone
  await expect(lab.locator("#view")).not.toBeEmpty();
  expect(consoleErrors).toEqual([]);
});

test("every view shows the footer with sources, update dates and season", async ({ page, consoleErrors }) => {
  const data = fixture("data.json"), labs = fixture("labs.json");
  await page.goto("/");
  const foot = page.locator("#site-foot");

  await expect(foot).toContainText("Unofficial fan site");
  await expect(foot).toContainText("Not affiliated with or endorsed by Nintendo, The Pokémon Company or Creatures");
  await expect(foot.getByRole("link", { name: "Trainerhill" })).toHaveAttribute("href", "https://www.trainerhill.com");
  await expect(foot.getByRole("link", { name: "Limitless" })).toHaveAttribute("href", "https://labs.limitlesstcg.com");
  await expect(page.locator("#foot-updated")).toHaveText(
    `Matchups updated ${day(data.generated)} · Regionals updated ${day(labs.generated)} · Season ${labs.season} (from 1 Aug ${labs.season - 1})`);
  await expect(page.locator("#foot-period")).toHaveText(
    `Matchups: Trainerhill, tournaments with ${data.filters.players}+ players, ${day(data.filters.start_date)} to ${day(data.filters.end_date)}`
    + ` · Results and lists: ${labs.events.length} Regionals (Limitless Labs${labs.settings?.top ? `, top ${labs.settings.top}` : ""})`);
  await expect(page.locator("#source")).toHaveCount(0); // the header has no subtitle any more
  for (const [view, button] of Object.entries(VIEWS)) {
    await page.locator(button).click();
    await expect(foot).toBeVisible();
    if (view === "advice") await page.keyboard.press("Escape"); // a dialog over the page
  }
  await openDeck(page, "Dragapult");
  await expect(foot).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("the footer copes without labs.json", async ({ page }) => {
  const data = fixture("data.json");
  await page.route("**/labs.json", route => route.fulfill({ status: 404, body: "Not found" }));
  await page.goto("/");

  await expect(page.locator("#tiers .tile[data-deck]").first()).toBeVisible();
  await expect(page.locator("#foot-updated")).toHaveText(`Matchups updated ${day(data.generated)} · Regionals not loaded`);
});

test.describe("at phone width", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("no view scrolls sideways", async ({ page, consoleErrors }) => {
    await page.goto("/");
    await expect(page.locator("#tiers .tile[data-deck]").first()).toBeVisible();
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    for (const [view, button] of Object.entries(VIEWS)) {
      await page.locator(button).click();
      if (view === "lab") await expect(page.locator("#lab-host").locator("#view")).not.toBeEmpty();
      expect(await overflow(), `sideways scroll on ${view}`).toBeLessThanOrEqual(0);
      if (view === "advice") await page.keyboard.press("Escape");
    }
    await openDeck(page, "Dragapult");
    expect(await overflow(), "sideways scroll on a deck page").toBeLessThanOrEqual(0);
    await page.locator("#open-meta").click();
    // My meta fills the screen and scrolls inside, without sideways scroll.
    expect(await metaDialog(page).boundingBox()).toEqual({ x: 0, y: 0, width: 375, height: 812 });
    const body = metaDialog(page).locator(".dlg-body");
    expect(await body.evaluate(b => b.scrollHeight > b.clientHeight && b.scrollWidth <= b.clientWidth)).toBe(true);
    expect(consoleErrors).toEqual([]);
  });
});

// Settings live in the visitor's browser (ADR 0002). The tier list as tier -> deck names, to compare views.
const tierList = page => page.locator("#tiers .tier").evaluateAll(ts =>
  ts.map(t => `${t.querySelector(".tier-label").firstChild.textContent}: ${[...t.querySelectorAll(".tile .name")].map(n => n.textContent).join(", ")}`));
const storedSettings = page => page.evaluate(() => JSON.parse(localStorage.getItem("matchup-meta-settings")));
// My meta is a board: a column per frequency level, a card per deck, a menu per card.
const metaCard = (page, name) => page.locator("#meta-board .meta-card", { has: page.getByText(name, { exact: true }) });
const metaMenu = page => page.locator("#meta-menu");
const menuItem = (page, label) => metaMenu(page).getByRole("button", { name: new RegExp(`^${label}( default)?$`) });
const columnOf = (page, name) => metaCard(page, name).evaluate(c => c.closest(".meta-col").querySelector("h3").firstChild.textContent.trim());
async function chooseLevel(page, name, label) {
  await metaCard(page, name).click();
  await menuItem(page, label).click();
  await expect(metaMenu(page)).toBeHidden();
}
// The default level as the card's menu labels it; the menu is closed again afterwards.
async function defaultOf(page, name) {
  await metaCard(page, name).click();
  const text = await metaMenu(page).locator("button", { has: page.locator("small", { hasText: "default" }) }).evaluate(b => b.firstChild.textContent.trim());
  await page.keyboard.press("Escape");
  await expect(metaMenu(page)).toBeHidden();
  return text;
}

test("My meta is a popup: ×, Done and Esc close it and focus returns to the button", async ({ page, consoleErrors }) => {
  await page.goto("/");
  await expect(page.locator("#tiers .tile[data-deck]").first()).toBeVisible();
  await expect(page.locator("header #save-state")).toHaveCount(0);
  const button = page.locator("#open-meta");
  const closers = [
    () => metaDialog(page).getByRole("button", { name: "Close" }).click(),
    () => metaDialog(page).getByRole("button", { name: "Done" }).click(),
    () => page.keyboard.press("Escape"),
  ];
  for (const close of closers) {
    await button.click();
    await expect(metaDialog(page)).toBeVisible();
    expect(await metaDialog(page).evaluate(d => d.matches(":modal"))).toBe(true);
    await close();
    await expect(metaDialog(page)).toBeHidden();
    await expect(button).toBeFocused();
  }
  expect(consoleErrors).toEqual([]);
});

test("changing a level in My meta updates the tier list behind it and shows the save message", async ({ page, consoleErrors }) => {
  await page.goto("/");
  await expect(page.locator("#tiers .tile[data-deck]").first()).toBeVisible();
  const before = await tierList(page);
  await page.locator("#open-meta").click();
  await chooseLevel(page, "Dragapult", "Never");
  await expect(metaDialog(page)).toBeVisible();
  await expect(metaDialog(page).locator(".dlg-foot #save-state")).toHaveText("Settings saved");
  expect(await tierList(page)).not.toEqual(before);
  await expect(page.locator("#tier-basis")).toHaveText("Expected winrate against your meta: Worldwide, 1 change");

  // Reset to default asks for a second click.
  const reset = metaDialog(page).locator("#reset");
  await reset.click();
  await expect(reset).toHaveText("Click again to reset");
  expect(await storedSettings(page)).toEqual({ version: 1, localFrequencies: { "dragapult-ex": 0 }, continent: "worldwide" });
  await reset.click();
  expect(await storedSettings(page)).toEqual({ version: 1, localFrequencies: {}, continent: "worldwide" });
  expect(await tierList(page)).toEqual(before);
  expect(consoleErrors).toEqual([]);
});

test("a local frequency is still there after a reload", async ({ page, consoleErrors }) => {
  await page.goto("/");
  await expect(page.locator("#tiers .tile[data-deck]").first()).toBeVisible();
  const defaults = await tierList(page);

  await page.locator("#open-meta").click();
  await chooseLevel(page, "Dragapult", "Never");
  await page.keyboard.press("Escape");
  const changed = await tierList(page);
  expect(changed).not.toEqual(defaults); // Dragapult, a third of the Regionals, no longer counts
  expect(await storedSettings(page)).toEqual({ version: 1, localFrequencies: { "dragapult-ex": 0 }, continent: "worldwide" });

  await page.reload();
  await expect(page.locator("#tiers .tile[data-deck]").first()).toBeVisible();
  expect(await tierList(page)).toEqual(changed);
  await page.locator("#open-meta").click();
  expect(await columnOf(page, "Dragapult")).toBe("Never");
  expect(consoleErrors).toEqual([]);
});

test("resetting a local frequency restores the default and removes it from storage", async ({ page, consoleErrors }) => {
  await page.goto("/#meta");
  await chooseLevel(page, "Dragapult", "Rarely");
  expect(await storedSettings(page)).toEqual({ version: 1, localFrequencies: { "dragapult-ex": 1 }, continent: "worldwide" });
  await expect(metaCard(page, "Dragapult").locator(".changed-dot")).toHaveCount(1);

  await chooseLevel(page, "Dragapult", "Reset to default");
  // Dragapult's default is Very often: a third of the fixture Regionals.
  expect(await columnOf(page, "Dragapult")).toBe("Very often");
  await expect(metaCard(page, "Dragapult").locator(".changed-dot")).toHaveCount(0);
  await metaCard(page, "Dragapult").click();
  await expect(menuItem(page, "Reset to default")).toHaveCount(0);
  expect(await storedSettings(page)).toEqual({ version: 1, localFrequencies: {}, continent: "worldwide" });

  await page.reload();
  expect(await columnOf(page, "Dragapult")).toBe("Very often");
  expect(consoleErrors).toEqual([]);
});

test("My meta is a board: six columns with weights, each deck in one column, search across columns", async ({ page, consoleErrors }) => {
  await page.goto("/#meta");
  const heads = metaDialog(page).locator(".meta-col h3");
  await expect(heads).toHaveText(["Very often ×81", "Often ×27", "Regularly ×9", "Sometimes ×3", "Rarely ×1", "Never ×0"]);
  await expect(page.locator("#only-changed, #weight-legend")).toHaveCount(0);
  const names = await metaDialog(page).locator(".meta-card .name").allTextContents();
  expect(new Set(names).size).toBe(names.length);
  expect(names.length).toBe(fixture("data.json").archetypes.length);

  // A level chosen from the menu moves the card and marks it changed; the menu marks the current and the default level.
  await chooseLevel(page, "Dragapult", "Never");
  expect(await columnOf(page, "Dragapult")).toBe("Never");
  await expect(metaCard(page, "Dragapult").locator(".changed-dot")).toHaveCount(1);
  await expect(page.locator("#tiers .tile", { hasText: "Dragapult" })).toHaveCount(0); // the tier list behind leaves it out
  await metaCard(page, "Dragapult").click();
  await expect(menuItem(page, "Never")).toHaveAttribute("aria-pressed", "true");
  await expect(metaMenu(page).getByRole("button", { name: "Very often default" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.locator("#meta-search").fill("drag");
  await expect(metaDialog(page).locator(".meta-card")).toHaveCount(1);
  expect(await columnOf(page, "Dragapult")).toBe("Never");
  expect(consoleErrors).toEqual([]);
});

test("the card menu works with the keyboard only; Esc closes the menu, not My meta", async ({ page, consoleErrors }) => {
  await page.goto("/#meta");
  await metaCard(page, "Dragapult").focus();
  await page.keyboard.press("Enter");
  await expect(metaMenu(page)).toBeVisible();
  await expect(menuItem(page, "Very often")).toBeFocused(); // the current level
  await page.keyboard.press("Escape");
  await expect(metaMenu(page)).toBeHidden();
  await expect(metaDialog(page)).toBeVisible();
  await expect(metaCard(page, "Dragapult")).toBeFocused();

  await page.keyboard.press("Space");
  await page.keyboard.press("Tab"); // Often
  await page.keyboard.press("Enter");
  await expect(metaMenu(page)).toBeHidden();
  expect(await columnOf(page, "Dragapult")).toBe("Often");
  await expect(metaCard(page, "Dragapult")).toBeFocused();
  expect(await storedSettings(page)).toEqual({ version: 1, localFrequencies: { "dragapult-ex": 4 }, continent: "worldwide" });
  expect(consoleErrors).toEqual([]);
});

// Export downloads Settings as a file; import reads one back through the hidden file input.
const exportFile = async page => {
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#export-settings").click()]);
  return { name: download.suggestedFilename(), text: readFileSync(await download.path(), "utf8") };
};
const importFile = (page, text) =>
  page.locator("#import-file").setInputFiles({ name: "settings.json", mimeType: "application/json", buffer: Buffer.from(text) });

test("export then import restores the same Settings, without the API key or history", async ({ page, consoleErrors }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("matchup-meta-api-key", JSON.stringify("sk-ant-test-0000-abcd"));
    localStorage.setItem("matchup-meta-advice", JSON.stringify([{ result: { summary: "secret advice" }, createdAt: "2026-11-01T10:00:00Z" }]));
  });
  await page.goto("/#meta");
  await chooseLevel(page, "Dragapult", "Never");
  await page.locator("#continent").selectOption("oce");
  const exported = await tierList(page); // the tier list behind the dialog
  const saved = await storedSettings(page);

  const file = await exportFile(page);
  expect(file.name).toBe("matchup-meta-settings.json");
  expect(JSON.parse(file.text)).toEqual({ version: 1, continent: "oce", localFrequencies: { "dragapult-ex": 0 } });
  expect(file.text).not.toContain("sk-ant");
  expect(file.text).not.toContain("secret advice");

  // Change everything, then import the file.
  await page.locator("#continent").selectOption("eu");
  await chooseLevel(page, "Dragapult", "Reset to default");
  await chooseLevel(page, "Crustle", "Rarely");
  await importFile(page, file.text);
  await expect(page.locator("#import-state")).toHaveText("Settings imported from settings.json.");
  expect(await storedSettings(page)).toEqual(saved);
  await expect(page.locator("#continent")).toHaveValue("oce");
  expect(await tierList(page)).toEqual(exported);

  await page.goto("/");
  await expect(page.locator("#tiers .tile[data-deck]").first()).toBeVisible();
  expect(await tierList(page)).toEqual(exported);
  expect(consoleErrors).toEqual([]);
});

test("an invalid settings file shows a message and changes nothing", async ({ page, consoleErrors }) => {
  await page.goto("/#meta");
  await chooseLevel(page, "Dragapult", "Rarely");
  const before = await storedSettings(page);
  await importFile(page, JSON.stringify({ version: 1, continent: "eu", localFrequencies: { "dragapult-ex": 9 } }));
  await expect(page.locator("#import-state")).toContainText("Not imported, your settings are unchanged.");
  await expect(page.locator("#import-state")).toContainText("dragapult-ex");
  expect(await storedSettings(page)).toEqual(before);
  await expect(page.locator("#continent")).toHaveValue("worldwide");
  expect(await columnOf(page, "Dragapult")).toBe("Rarely");
  expect(consoleErrors).toEqual([]);
});

// The continent weights share, and through it the default levels (ADR 0003). In the fixture every deck
// played at the Regionals is above 5% whatever the continent, so these tests serve labs.json with 16 top
// players counted per Regional instead of 6 (10 more on decks outside the fixture): then Crustle, played
// only in Brisbane, is Regularly Worldwide (2.2%) and Often for Oceania (2.8%).
const morePlayers = page => page.route("**/labs.json", route => {
  const labs = fixture("labs.json");
  labs.events = labs.events.map(e => ({ ...e, players: 16 }));
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(labs) });
});

test("changing continent changes default levels and the tier list, not local frequencies", async ({ page, consoleErrors }) => {
  await morePlayers(page);
  await page.goto("/");
  await expect(page.locator("#tiers .tile[data-deck]").first()).toBeVisible();
  const worldwide = await page.locator("#tier-legend").textContent();

  await page.locator("#open-meta").click();
  await chooseLevel(page, "Dragapult", "Rarely");
  expect(await defaultOf(page, "Crustle")).toBe("Regularly");
  expect(await columnOf(page, "Crustle")).toBe("Regularly");

  await page.getByLabel("Start from").selectOption("Oceania");
  expect(await defaultOf(page, "Crustle")).toBe("Often");
  expect(await columnOf(page, "Crustle")).toBe("Often");
  expect(await columnOf(page, "Dragapult")).toBe("Rarely");
  await expect(page.locator("#continent-note")).toBeHidden();
  expect(await storedSettings(page)).toEqual({ version: 1, localFrequencies: { "dragapult-ex": 1 }, continent: "oce" });

  // Crustle counts three times as much in My meta, so the tier cut-offs move.
  await expect(page.locator("#tier-legend")).not.toHaveText(worldwide);

  await page.reload();
  await page.locator("#open-meta").click();
  await expect(page.getByLabel("Start from")).toHaveValue("oce");
  expect(await defaultOf(page, "Crustle")).toBe("Often");
  expect(consoleErrors).toEqual([]);
});

test("a continent without Regionals shows a note and uses Worldwide", async ({ page, consoleErrors }) => {
  await morePlayers(page);
  await page.goto("/#meta");
  const note = page.locator("#continent-note");
  await expect(note).toBeHidden();

  await page.getByLabel("Start from").selectOption("Latin America");
  await expect(note).toBeVisible();
  await expect(note).toHaveText(`There are no Regionals in Latin America in season ${fixture("labs.json").season}, so the defaults use Worldwide.`);
  expect(await defaultOf(page, "Crustle")).toBe("Regularly");
  expect(consoleErrors).toEqual([]);
});

test("the lists on a deck page do not change with the continent", async ({ page, consoleErrors }) => {
  await morePlayers(page);
  await page.goto("/");
  const lists = async () => {
    await openDeck(page, "Crustle");
    await expect(page.locator("#deck-detail")).toContainText("Consensus list");
    // Every list panel; Key numbers holds the share and expected winrate, which do follow the continent.
    return page.locator("#deck-detail section.dl").evaluateAll(ss =>
      ss.filter(s => s.querySelector("h3")?.textContent !== "Key numbers").map(s => s.textContent));
  };
  const share = () => page.locator("#deck-detail .fact-group", { has: page.locator("h4", { hasText: "Regionals" }) });
  const worldwide = await lists();
  expect(worldwide.length).toBeGreaterThan(0);
  await expect(share()).toContainText("Share2.2%");

  await page.locator("#open-meta").click();
  await page.getByLabel("Start from").selectOption("Oceania");
  expect(await defaultOf(page, "Crustle")).toBe("Often");
  await page.keyboard.press("Escape");
  expect(await lists()).toEqual(worldwide);
  await expect(share()).toContainText("Share2.8%");
  expect(consoleErrors).toEqual([]);
});

// Storage the site cannot use: reading localStorage itself throws (cookies blocked), or every call throws.
const UNAVAILABLE = {
  blocked: () => Object.defineProperty(window, "localStorage", { get() { throw new DOMException("The operation is insecure.", "SecurityError"); } }),
  throwing: () => ["getItem", "setItem", "removeItem"].forEach(m => {
    Storage.prototype[m] = () => { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); };
  }),
};
for (const [name, unavailable] of Object.entries(UNAVAILABLE)) {
  test(`with storage ${name} the site loads with defaults`, async ({ page, consoleErrors }) => {
    await page.addInitScript(unavailable);
    await page.goto("/");
    await expect(page.locator("#tiers .tile[data-deck]", { hasText: "Dragapult" })).toBeVisible();

    await page.locator("#open-meta").click();
    await chooseLevel(page, "Dragapult", "Never");
    expect(await columnOf(page, "Dragapult")).toBe("Never"); // still works for this visit
    await expect(page.locator("#save-state")).toHaveText("Could not save; your changes only apply to this session");
    expect(consoleErrors).toEqual([]);
  });
}

// Advice and Deck chat need the visitor's own Anthropic API key (ADR 0002). No real API call is
// made: without a key the page sends nothing, and with a key the Messages API route is stubbed.
const API_KEY = "sk-ant-test-0000-abcd";
const stored = (page, key) => page.evaluate(k => localStorage.getItem(k), key);

// A structured Advice answer as the Messages API sends it back, with English field names.
const ADVICE_ANSWER = {
  summary: "Play Dragapult: it beats most of what you meet.",
  picks: [
    { deck_id: "dragapult-ex", role: "Best pick", why: "Good against your two most common decks.", strong_against: ["Crustle"], watch_out: ["Slow starts"], confidence: "medium", list: "consensus", cards: [] },
    { deck_id: "basic-box-m", role: "Alternative", why: "Steady against everything.", strong_against: [], watch_out: [], confidence: "low", list: "consensus", cards: [] },
  ],
  avoid: [{ deck_id: "festival-lead", why: "Loses to Dragapult." }],
  caveats: ["Few games for some matchups."],
};
// Answer the Messages API route (and its CORS preflight); every request body is collected.
async function stubMessagesApi(page, status, body) {
  const requests = [];
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST" };
  await page.route("https://api.anthropic.com/v1/messages", route => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    requests.push({ headers: req.headers(), body: req.postDataJSON() });
    return route.fulfill({ status, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
  });
  return requests;
}
const message = obj => ({ type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify(obj) }] });

test("without an API key Advice and Deck chat are off and explain how to turn them on", async ({ page, consoleErrors }) => {
  const apiCalls = [];
  page.on("request", r => { if (r.url().startsWith("https://api.anthropic.com/")) apiCalls.push(r.url()); });
  await page.goto("/");
  await expect(page.locator("#tiers .tile[data-deck]", { hasText: "Dragapult" })).toBeVisible(); // the tier list still works

  await page.locator("#open-ask").click();
  await expect(page.locator("#ai-key")).toContainText("Advice and Deck chat are off");
  await expect(page.getByLabel("Anthropic API key")).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove key" })).toBeHidden();
  await expect(page.locator("#advice-run")).toBeDisabled();
  await page.keyboard.press("Escape");

  await openDeck(page, "Dragapult");
  const chat = page.locator("#deck-chat");
  await expect(chat).toContainText("Deck chat is off");
  await expect(chat.getByRole("link", { name: "Add your API key" })).toBeVisible();
  await expect(chat.locator("#chat-input")).toHaveCount(0);
  await chat.getByRole("link", { name: "Add your API key" }).click();
  await expect(page.getByRole("dialog", { name: "Ask Claude" })).toBeVisible();
  await expect(page.getByLabel("Anthropic API key")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#page-deck")).toBeVisible(); // the dialog opened over the deck page
  await page.locator("#tab-tierlist").click();
  await expect(page.locator("#tiers .tile[data-deck]", { hasText: "Dragapult" })).toBeVisible();
  expect(apiCalls).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("with an API key Advice runs, stays after a reload, and Remove key turns it off again", async ({ page, consoleErrors }) => {
  const requests = await stubMessagesApi(page, 200, message(ADVICE_ANSWER));
  await page.goto("/#advice");

  await page.getByLabel("Anthropic API key").fill(API_KEY);
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.locator("#ai-key")).toContainText("stored only in this browser");
  expect(JSON.parse(await stored(page, "matchup-meta-api-key"))).toBe(API_KEY);
  await expect(page.locator("#advice-run")).toBeEnabled();

  await page.locator("#advice-run").click();
  const result = page.locator("#advice-result");
  await expect(result).toContainText("Play Dragapult: it beats most of what you meet.");
  await expect(result.locator(".pick.best")).toContainText("Dragapult");
  await expect(result.locator(".pick.best")).toContainText("Confidence: medium");
  await expect(result.locator(".adv-avoid")).toContainText("Festival Lead");

  // The request: the visitor's key, straight from the browser, the model and effort from the ticket,
  // an English prompt and English field names in the structured answer.
  expect(requests).toHaveLength(1);
  const { headers, body } = requests[0];
  expect(headers["x-api-key"]).toBe(API_KEY);
  expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
  expect(headers["anthropic-version"]).toBe("2026-10-21");
  expect(body.model).toBe("claude-opus-5-5");
  expect(body.output_config.effort).toBe("medium");
  const schema = body.output_config.format.schema;
  expect(Object.keys(schema.properties)).toEqual(["summary", "picks", "avoid", "caveats"]);
  expect(Object.keys(schema.properties.picks.items.properties)).toEqual(
    ["deck_id", "role", "why", "strong_against", "watch_out", "confidence", "list", "cards"]);
  const prompt = body.messages[0].content;
  expect(prompt).toContain("You are an experienced Pokémon TCG player and coach");
  expect(prompt).toContain("Dragapult [dragapult-ex]");
  for (const dutch of ["Je bent", "aandeel", "gewicht", "Nederlands", "zekerheid"]) expect(prompt).not.toContain(dutch);

  // Advice history stays in the browser, outside Settings (the only thing an export carries).
  // Reload without #advice: that hash would open the popup by itself.
  await page.goto("/");
  await page.locator("#open-ask").click();
  await expect(page.locator("#advice-result")).toContainText("Play Dragapult: it beats most of what you meet.");
  expect(JSON.parse(await stored(page, "matchup-meta-advice"))[0].result).toEqual(ADVICE_ANSWER);
  const settings = await stored(page, "matchup-meta-settings");
  for (const text of [API_KEY, "Play Dragapult"]) expect(settings ?? "").not.toContain(text);

  await page.getByRole("button", { name: "Remove key" }).click();
  expect(await stored(page, "matchup-meta-api-key")).toBeNull();
  await expect(page.locator("#ai-key")).toContainText("Advice and Deck chat are off");
  await expect(page.locator("#advice-run")).toBeDisabled();
  await page.keyboard.press("Escape");
  await openDeck(page, "Dragapult");
  await expect(page.locator("#deck-chat")).toContainText("Deck chat is off");
  expect(consoleErrors).toEqual([]);
});

test("a rejected API key shows a readable error and leaves the page working", async ({ page }) => {
  await stubMessagesApi(page, 401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
  await page.addInitScript(key => localStorage.setItem("matchup-meta-api-key", JSON.stringify(key)), API_KEY);
  await page.goto("/#advice");

  await page.locator("#advice-run").click();
  await expect(page.locator("#advice-state")).toHaveText("Anthropic rejected your API key. Check that you pasted all of it, or remove it and enter a new one.");
  await expect(page.locator("#advice-state")).toHaveClass(/err/);
  await expect(page.locator("#advice-run")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Remove key" })).toBeVisible();
});

test("in the Ask Claude dialog Stop cancels a running analysis and Earlier Advice switches back", async ({ page, consoleErrors }) => {
  await page.route("https://api.anthropic.com/v1/messages", () => {}); // never answers
  await page.addInitScript(([key, answer]) => {
    localStorage.setItem("matchup-meta-api-key", JSON.stringify(key));
    localStorage.setItem("matchup-meta-advice", JSON.stringify([
      { result: { summary: "Newest advice." }, createdAt: "2026-11-02T10:00:00Z" },
      { result: answer, createdAt: "2026-11-01T10:00:00Z" },
    ]));
  }, [API_KEY, ADVICE_ANSWER]);
  await page.goto("/");
  await page.locator("#open-ask").click();
  const dialog = page.getByRole("dialog", { name: "Ask Claude" });
  await expect(dialog.locator("#advice-result")).toContainText("Newest advice.");
  await dialog.getByLabel("Earlier Advice").selectOption("1");
  await expect(dialog.locator("#advice-result")).toContainText("Play Dragapult: it beats most of what you meet.");

  await dialog.locator("#advice-run").click();
  await dialog.getByRole("button", { name: "Stop" }).click();
  await expect(dialog.locator("#advice-state")).toHaveText("Stopped.");
  await expect(dialog.locator("#advice-run")).toBeEnabled();
  expect(consoleErrors).toEqual([]);
});

// Deck chat streams its answer (server-sent events). Each stubbed reply is one streamed message;
// the first asks for the list-check tool, the second answers with a list in a ```list block.
const sse = events => events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const streamedReply = (block, stop_reason) => sse([
  { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", content: [] } },
  { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-1" } },
  { type: "content_block_stop", index: 0 },
  ...(block.text != null
    ? [{ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      ...block.text.match(/[^]{1,40}/g).map(text => ({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text } }))]
    : [{ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: block.tool, input: {} } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } }]),
  { type: "content_block_stop", index: 1 },
  { type: "message_delta", delta: { stop_reason } }, { type: "message_stop" },
]);
async function stubDeckChat(page, replies) {
  const requests = [];
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST" };
  await page.route("https://api.anthropic.com/v1/messages", route => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    requests.push(req.postDataJSON());
    return route.fulfill({ status: 200, headers: cors, contentType: "text/event-stream", body: replies[requests.length - 1] });
  });
  return requests;
}
const LIST_INPUT = { cards: [{ count: 4, name: "Dreepy", set: "ASC", number: "158" }, { count: 4, name: "Drakloak", set: "ASC", number: "159" }] };
const CHAT_ANSWER = "Play this list:\n\n```list\n4 Dreepy ASC 158\n4 Drakloak ASC 159\n3 Dragapult ex ASC 160\n```\n\nIt follows the consensus list.";

test("with an API key Deck chat streams an answer, checks a list with its tool, and keeps the chat after a reload", async ({ page, consoleErrors }) => {
  const requests = await stubDeckChat(page, [
    streamedReply({ tool: "check_list", input: LIST_INPUT }, "tool_use"),
    streamedReply({ text: CHAT_ANSWER }, "end_turn"),
  ]);
  await page.addInitScript(key => localStorage.setItem("matchup-meta-api-key", JSON.stringify(key)), API_KEY);
  await page.goto("/");
  await openDeck(page, "Dragapult");
  const chat = page.locator("#deck-chat");
  await chat.locator("#chat-input").fill("Build a 60-card list for my meta with me.");
  await chat.getByRole("button", { name: "Send" }).click();

  await expect(chat.locator(".msg.bot")).toContainText("It follows the consensus list.");
  await expect(chat.locator(".chat-list")).toContainText("Total 11 cards");
  await expect(chat.getByRole("button", { name: "Send" })).toBeEnabled();

  // Two requests: Claude calls check_list, the page runs it and sends the result back.
  expect(requests).toHaveLength(2);
  const [first, second] = requests;
  expect(first.model).toBe("claude-opus-5-5");
  expect(first.output_config.effort).toBe("medium");
  expect(first.stream).toBe(true);
  expect(first.tools.map(t => t.name)).toEqual(["check_list"]);
  expect(first.messages).toEqual([{ role: "user", content: "Build a 60-card list for my meta with me." }]);
  expect(first.system).toContain("You are an experienced Pokémon TCG player and coach");
  expect(first.system).toContain("Dragapult");
  for (const dutch of ["Je bent", "Nederlands", "zekerheid", "lijsten", "kaarten", "Europese"]) expect(first.system).not.toContain(dutch);
  const result = second.messages.at(-1).content[0];
  expect(result.type).toBe("tool_result");
  expect(result.tool_use_id).toBe("toolu_1");
  expect(JSON.parse(result.content).total).toBe(8);
  expect(second.messages.at(-2).content[0]).toEqual({ type: "thinking", thinking: "", signature: "sig-1" });

  // The chat stays in this browser after a reload, outside Settings (what an export carries).
  await page.reload();
  await openDeck(page, "Dragapult");
  await expect(page.locator("#deck-chat .msg.user")).toHaveText("Build a 60-card list for my meta with me.");
  await expect(page.locator("#deck-chat .msg.bot")).toContainText("It follows the consensus list.");
  expect(JSON.parse(await stored(page, "matchup-meta-deck-chat"))["dragapult-ex"]).toHaveLength(2);
  expect(await stored(page, "matchup-meta-settings") ?? "").not.toContain("consensus list");
  // No claude.ai runtime is asked for anything.
  expect(await page.evaluate(() => typeof window.claude)).toBe("undefined");
  expect(consoleErrors).toEqual([]);
});

test("a rejected API key in Deck chat shows a readable error", async ({ page }) => {
  await stubMessagesApi(page, 401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
  await page.addInitScript(key => localStorage.setItem("matchup-meta-api-key", JSON.stringify(key)), API_KEY);
  await page.goto("/");
  await openDeck(page, "Dragapult");
  await page.locator("#chat-input").fill("Is Shaymin worth it?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator("#chat-state")).toHaveText("Anthropic rejected your API key. Check that you pasted all of it, or remove it and enter a new one.");
  await expect(page.locator("#chat-state")).toHaveClass(/err/);
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
});
