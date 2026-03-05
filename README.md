# NBA Edge — EV Betting Engine

A web-based NBA sports betting analytics tool that calculates Expected Value (EV) across 6 major sportsbooks, surfaces +EV bets, runs an AI-powered news & injury agent before each game, and tracks a $100 paper bankroll over time.

## Features

- **Live Odds** — pulls real-time lines from DraftKings, FanDuel, BetMGM, Caesars, PointsBet, and BetRivers via The Odds API
- **EV Calculator** — compares our statistical model's implied probability against each book's implied probability to find mispriced lines
- **Kelly Criterion** — recommends optimal bet sizing (Quarter-Kelly) based on your edge
- **AI News Agent** — powered by Claude (Anthropic) or GPT (OpenAI), scans injury reports and beat reporter updates before each game
- **Auto Scheduler** — refreshes every morning at 8AM and 1 hour before each tip-off
- **Line Movement Tracker** — flags sharp money and steam moves per bet
- **Paper Bankroll & History** — auto-places Kelly-sized bets on a $100 paper bankroll, tracks every bet, and charts portfolio performance over time
- **How It Works** — built-in explainer tab so anyone can understand the app

## Bet Types Covered

- Moneylines
- Spreads
- Game Totals (Over/Under)
- Player Props

## History Tab

The History tab automatically tracks all recommended bets as paper trades starting from a $100 bankroll:

- **Portfolio Chart** — line chart of your bankroll over time with a shaded P&L area (green when up, red when down)
- **Auto-Bet** — every day's top +EV bets are automatically placed at their Kelly Criterion size
- **Auto-Resolve** — Moneylines, Spreads, and Game Totals resolve automatically using live scores from The Odds API. Player props show as Pending (live box score data requires a paid stats API)
- **Bet Log** — full table of every bet showing date, selection, odds, wager amount, potential payout, Kelly %, bankroll after, and result (WIN / LOSS / PENDING)
- **Stats** — running totals for bankroll, P&L, win rate, W/L record, and total wagered
- **Persistence** — history saves to localStorage and survives page refreshes. Reset anytime from the Settings panel

## Setup

No installation needed — just open the app and click **⚙ API Setup** in the top right to enter your keys:

| Key | Where to Get It | Purpose |
|-----|----------------|---------|
| Odds API Key | [the-odds-api.com](https://the-odds-api.com) (free tier) | Live sportsbook lines + score resolution |
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

## File Structure

```
api/
  news.js          # Vercel serverless proxy for Anthropic/OpenAI API (avoids CORS)
src/
  App.tsx          # Main React application
public/
index.html
package.json
```

## Tech Stack

- React + TypeScript + Vite
- The Odds API (live sportsbook data + score resolution)
- Anthropic Claude API / OpenAI API (news agent)
- Kelly Criterion (bet sizing)
- Canvas API (portfolio chart)
- localStorage (history persistence)

## Disclaimer

This app is a statistical and analytical tool — it does not guarantee wins. Even +EV bets lose in the short run due to variance. This tool gives you a long-term mathematical edge, not individual game predictions. Always bet responsibly and never more than you can afford to lose.
