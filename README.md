# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Daniikhwan/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Daniikhwan/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks every pre-token protocol DefiLlama tracks by implied value — what a launch would be worth if the record stayed as it is — and gives each one a seven-step farm plan with costs and times. The board covers all 40 watchlist protocols plus 158 more pre-token protocols below the floor, sets aside the wrapped, staked and bridged products of tokens that already trade, and prices every category from the live-token protocols in it. Built by an AI agent for make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

`main.ts` reads the sealed DefiLlama snapshot, writes the ranked board to `board.json`, the dashboard's data to `data.js`, copies `dashboard/` and `screenshots/` to the output, and writes `dossier.json`. Open `dashboard/index.html` from the output in a browser (served over HTTP so it can load `data.js` beside it) to use the radar: the board, a detail view for every protocol, and filters by category, chain, TVL and search.

---

<sub>Entered on [make.fun](https://make.fun/?ref=vnsny7za&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
