# Running K-TV

## Local only (same Wi-Fi)
```
node server.js
```
Open **http://localhost:3000/player** on the laptop wired to the TV, click **POWER ON**.
Guests on the same Wi-Fi scan the on-screen QR (it points to the laptop's LAN IP).

## Public URL (any network) — free Cloudflare quick tunnel
One-time install:
```
winget install --id Cloudflare.cloudflared
```
Each party — run BOTH:
```
node server.js
cloudflared tunnel --url http://localhost:3000
```
cloudflared prints a URL like `https://random-words.trycloudflare.com`.
Open **that URL + `/player`** on the TV laptop (e.g. `https://random-words.trycloudflare.com/player`)
and click POWER ON. The on-screen QR now points guests at the tunnel URL, so they can join
from **any network** (cell data included).

Notes:
- The tunnel URL is random and changes each run — the QR regenerates every launch, so it stays correct.
- The tunnel only exists while `cloudflared` is running; close it and the public URL dies.
- No router/firewall setup needed — cloudflared connects outbound from your laptop.
- The QR auto-uses whatever URL the /player page was opened at (tunnel, host, or LAN),
  falling back to the LAN IP only if you opened it via `localhost`.
