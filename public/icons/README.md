# App icons

Drop the real Catalyst logo in here as PNGs with **these exact filenames** —
the manifest (`/public/manifest.webmanifest`) and service worker
(`/public/sw.js`) reference them by name:

| File | Size | Purpose |
|---|---|---|
| `icon-192.png` | 192×192 | Standard app icon (home screen, task switcher) |
| `icon-512.png` | 512×512 | High-res icon / splash |
| `icon-maskable-512.png` | 512×512 | Android adaptive icon — keep the logo inside the centre 80% "safe zone", full-bleed background |
| `apple-touch-icon.png` | 180×180 | iOS home-screen icon (referenced from `app/layout.tsx`) |
| `badge-72.png` | 72×72 | Monochrome status-bar badge (Android notification tray) — white on transparent |

Notes:
- Brand color is `#217346` (Excel-green). The in-app mark is a white "C" on that green.
- Until these files exist, the browser will **not** show the "Install" prompt
  and the header install button stays hidden — everything else (service
  worker, push) still works.
- Square source art, no rounded corners (the OS masks them).
