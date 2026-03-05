# NBA Edge — EV Betting Engine

A web-based NBA sports betting analytics tool that calculates Expected Value (EV) across 6 major sportsbooks, surfaces +EV bets, and runs an AI-powered news & injury agent before each game.

## Features

- **Live Odds** — pulls real-time lines from DraftKings, FanDuel, BetMGM, Caesars, PointsBet, and BetRivers via The Odds API
- **EV Calculator** — compares our statistical model's implied probability against each book's implied probability to find mispriced lines
- **Kelly Criterion** — recommends optimal bet sizing (Quarter-Kelly) based on your edge
- **AI News Agent** — powered by Claude (Anthropic) or GPT (OpenAI), scans injury reports and beat reporter updates before each game
- **Auto Scheduler** — refreshes every morning at 8AM and 1 hour before each tip-off
- **Line Movement Tracker** — flags sharp money and steam moves per bet
- **How It Works** — built-in explainer tab so anyone can understand the app

## Bet Types Covered

- Moneylines
- Spreads
- Game Totals (Over/Under)
- Player Props

## Setup

No installation needed — just open the app and click **⚙ API Setup** in the top right to enter your keys:

| Key | Where to Get It | Purpose |
|-----|----------------|---------|
| Odds API Key | [the-odds-api.com](https://the-odds-api.com) (free tier) | Live sportsbook lines |
| Anthropic API Key | [console.anthropic.com](https://console.anthropic.com) (recommended) | AI news & injury agent |
| OpenAI API Key | [platform.openai.com](https://platform.openai.com) (alternative) | AI news & injury agent |

Without any keys the app runs on demo data so you can explore the full interface freely.

## Deploy Your Own

Deploy your own instance with Vercel — free, permanent, no expiration.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/BenCurtis2003/nba-edge)

_Live Example: https://nba-edge.vercel.app_

### Deploying From Your Terminal

```shell
$ vercel
```

## Tech Stack

- React + TypeScript + Vite
- The Odds API (live sportsbook data)
- Anthropic Claude API / OpenAI API (news agent)
- Kelly Criterion (bet sizing)

## Disclaimer

This app is a statistical and analytical tool — it does not guarantee wins. Even +EV bets lose in the short run due to variance. Always bet responsibly and never more than you can afford to lose.
