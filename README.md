# Nepal Election 2082 — Live Results Dashboard

Live, interactive dashboard for Nepal's House of Representatives election held on Falgun 21, 2082 (March 5, 2026).

## Features

- Real-time seat tally with majority line visualization
- Party-wise breakdown (Won / Leading / Total vs 2022)
- Province-level results for all 7 provinces
- 34+ constituency cards with candidate votes
- Live search — filter by candidate, party, or constituency
- Party filter chips for quick filtering
- Auto-refresh every 60 seconds
- Hybrid data: live API when deployed, local fallback otherwise

## Deploy to Netlify

### Option 1: One-click

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/YOUR_USERNAME/nepal-election-2082)

### Option 2: CLI

```bash
npm install -g netlify-cli
netlify login
netlify init
netlify deploy --prod
```

### Option 3: GitHub auto-deploy

1. Push this repo to GitHub
2. Go to [app.netlify.com](https://app.netlify.com)
3. Click "Add new site" → "Import an existing project"
4. Select your GitHub repo
5. Deploy settings are auto-detected from `netlify.toml`
6. Click "Deploy site"

Every push to `main` auto-deploys.

## Architecture

```
index.html                          → Dashboard (single-file frontend)
netlify/functions/election-data.js  → Serverless proxy (fetches live data)
netlify.toml                        → Netlify config
```

The frontend calls `/.netlify/functions/election-data` every 60s. The serverless function fetches from election portals (ekantipur, etc.) and returns normalized JSON. If the API is unreachable (e.g., running locally), the frontend falls back to hardcoded data with simulated updates.

## Data Sources

- [Ekantipur Election](https://election.ekantipur.com)
- [Nepse Bajar](https://election.nepsebajar.com)
- [Nepal Votes Live](https://nepalvotes.live)
- [Election Commission Nepal](https://election.gov.np)
- [Sidhakura](https://www.sidhakura.com)

## Local Development

```bash
npm install -g netlify-cli
netlify dev
```

Opens at `http://localhost:8888` with the serverless function running locally.
