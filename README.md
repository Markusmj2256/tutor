# Markus Johnsen Tutoring

Lys, varm premium-landingside målrettet forældre til gymnasieelever i Gentofte & Lyngby.

- Live: https://markusmj2256.github.io/tutor/
- `index.html` — forside med undervisningsformer, priser, erfaring og kontakt
- `holdundervisning.html` — Matematik A/B på hold med 4–5 elever og interessetilmelding
- `eneundervisning.html` — personlig undervisning, erfaring, anmeldelser og timepakker
- `styles.css` / `script.js` — fælles design og interaktion på alle tre sider
- `assets/` — optimerede fotos
- `assets/photos/` — fotosessionen (webp + jpg, beskårne i flere størrelser)

Bygget som forbedret version af den oprindelige side (Tutor-hjemmeside-repoet).

## Design og teknik

Statisk HTML, CSS og JavaScript uden byggetrin. Samme varme, lyse design på alle sider:
Fraunces til overskrifter, Manrope til brødtekst, gyldne knapper, afrundede kort og egne
undervisningsfotos i responsive WebP/JPG-versioner. Navigation, mobilmenu,
scrollanimationer og formularer deler styling og JavaScript.

Kontaktformularerne klargør en mail til Markus i den besøgendes mailprogram.
Den besøgende skal selv sende mailen. Siden sender eller gemmer ikke oplysningerne,
og en udfyldt formular er ikke i sig selv en registreret tilmelding. Kontakt via
telefon og direkte mail er også tilgængelig.

## Lokal forhåndsvisning og publicering

Kør `python3 -m http.server 8879 --bind 127.0.0.1` fra denne mappe og åbn
`http://127.0.0.1:8879/`. Der er ingen installation af produktionsafhængigheder.

GitHub Pages publicerer roden af `gh-pages`, mens kildekoden vedligeholdes på `main`.
Efter commit og push til `main` merges ændringerne til `gh-pages` og pushes.
Kontrollér Pages-build og alle tre offentlige adresser efter publicering.
Brug relative links og filstier, så siderne fungerer under `/tutor/`.

## Hostingvurdering — 12. september 2026

GitHub Pages er teknisk korrekt konfigureret til den statiske side med HTTPS.
GitHub beskriver dog [begrænsninger for kommerciel brug af Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).
En separat kommerciel host er derfor værd at overveje til en undervisningsforretning.
Der er ikke ændret hosting eller stack i denne opdatering.

[Vercel med GitHub](https://vercel.com/docs/git/vercel-for-github) kan senere give
automatisk publicering og forhåndsvisninger uden at ændre HTML/CSS/JS eller flytte
koden fra GitHub. [Hobby-planen er til ikke-kommerciel brug](https://vercel.com/docs/plans/hobby),
så erhvervsbrug kræver en passende betalt plan.

[Supabase](https://supabase.com/docs/guides/database/overview) er ikke nødvendigt
til informationssiderne. Det kan blive relevant til en database med interessetilmeldinger,
holdpladser og administration, hvis mailformularerne senere skal erstattes af direkte
registrering på hjemmesiden. Ingen database eller nye eksterne tjenester er tilføjet.
