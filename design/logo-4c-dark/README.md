# Teton Pass Cam — "Route 22" icon set (4c)

Mark: square route-marker plate, inner keyline border, "22" (WY-22) in Bricolage Grotesque 800.
Colors: ink #2b2620 · cream #faf7f0. Dark-mode alternate: invert (cream plate, ink border/numerals).

## Files
- icon-512.png / icon-192.png — PWA icons, purpose "any" (rounded plate on transparency)
- icon-512-maskable.png / icon-192-maskable.png — purpose "maskable", art in 80% safe zone
- apple-touch-icon.png — 180x180 full-bleed (iOS rounds corners itself)
- favicon-32.png / favicon-16.png — simplified small variant (no keyline, bigger numerals)
- mark.svg — source geometry. NOTE: uses a <text> element, so it only renders with Bricolage Grotesque available (fine in the app, where the font is already loaded via @fontsource; do NOT use it as the favicon file — browsers won't load fonts inside favicon SVGs). Use the PNGs for all icon slots.

## index.html <head>
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#faf7f0" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#211d17" media="(prefers-color-scheme: dark)">

## manifest.webmanifest icons
[
  { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
  { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
  { "src": "/icons/icon-192-maskable.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
  { "src": "/icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
]
These replace public/icons/icon-192.png and icon-512.png in the repo.

## Header lockup
<img src="/icons/icon-192.png" width="40" height="40" alt=""> + "Teton Pass Cam" in Bricolage Grotesque 800, tracking -0.02em (render the wordmark as HTML text, not baked into the image).
