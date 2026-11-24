# Momentum Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/dmitri13134/momentum-breakout-radar-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/dmitri13134/momentum-breakout-radar-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar that ranks pre-token protocols by the value their **momentum** implies — not by size alone.

The watchlist is cooling (its median 7-day TVL change is about −3%) while the breakouts live below the $50M floor. So this board scores every rankable pre-token protocol in the snapshot by how fast its TVL is moving, how long it has run with no token, and how big it already is. Size sets the base; momentum decides who leads.

## The model (momentum-6)

```
implied = TVL × 0.10
        × max(0.15, 1 + clamp(7d %, −80, +300) / 100 × 1.5)
        × (0.7 + min(age, 1460) / 1460 × 0.9)
        × bonus
```

Bonus is 1.35 for a breakout (7d ≥ +25%), 1.15 while heating (≥ +5%), 1.00 while steady, 0.85 while cooling (< −5%) and 0.70 while fading (< −25%). Age is days since DefiLlama began tracking the protocol; unknown age counts as 365 days. No protocol name is ever special-cased: one function in `lib/model.ts` scores every row.

The board covers the whole 40-protocol watchlist plus every rankable pre-token protocol below the floor — the early set where the breakouts live. Protocols that already record a token are kept apart in a Live tokens view, shown at the market's own value, never a model's.

Each row carries a 6-step farm plan with what it costs and how long it takes, including a momentum step: what to do while the 7-day move is hot, warm or cold.

## The dashboard

A static page with no network and no framework. It shows the ranked board, a detail view for every protocol (model breakdown + farm plan), and filters for momentum class, chain, category, TVL, and watchlist membership — plus a model sandbox: move the growth weight, base multiple or breakout bonus and the board re-ranks live.

Hash routes: `#detail=<slug>` opens a protocol, `#class=<BREAKOUT|HEATING|STEADY|COOLING|FADING>` filters by class, `#hot=1` keeps Breakout + Heating only, `#watch=1` keeps the watchlist only.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

`main.ts` (Node 22, standard library only) reads the sealed snapshot, writes the ranked board to `out/board.json`, the dashboard's data to `out/data.js`, copies `dashboard/` and `screenshots/` to `out/`, and writes `out/dossier.json` with the vendored make.fun library.

## Layout

- `main.ts` — entrypoint: reads the snapshot, writes the board, data, dashboard, screenshots and dossier.
- `lib/model.ts` — the momentum model, farm plans, board validation.
- `dashboard/` — the static page (`index.html`, `app.css`, `app.js`).
- `screenshots/` — board, detail and filtered views of the dashboard.
- `vendor/makefun-board.ts` — the make.fun dossier library, as shipped in the kit.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
