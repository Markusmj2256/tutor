# Markus Johnsen Tutoring

Lys, varm premium-landingside målrettet forældre til gymnasieelever i Gentofte & Lyngby.

- Live: https://lokaltutor.pages.dev
- `index.html` — forside med undervisningsformer, priser, erfaring og kontakt
- `holdundervisning.html` — Matematik A/B på hold med 4–5 elever og interessetilmelding
- `eneundervisning.html` — personlig undervisning, erfaring, anmeldelser og timepakker
- `admin.html` / `admin.js` — intern side med indkomne henvendelser
- `privatliv.html` — privatlivspolitik
- `flyer-tracking.js` — flyerbesøg og attribution på tværs af sider
- `supabase/` — versionsstyret kontaktfunktion, flyermigration og databasetest
- `docs/flyer-tracking.md` — links, måledefinitioner, adgang og test
- `styles.css` / `script.js` — fælles design og interaktion på alle tre sider
- `assets/` — optimerede fotos
- `assets/photos/` — fotosessionen (webp + jpg, beskårne i flere størrelser)

Bygget som forbedret version af den oprindelige side (Tutor-hjemmeside-repoet).

## Design og teknik

Statisk HTML, CSS og JavaScript uden byggetrin. Samme varme, lyse design på alle sider:
Fraunces til overskrifter, Manrope til brødtekst, gyldne knapper, afrundede kort og egne
undervisningsfotos i responsive WebP/JPG-versioner. Navigation, mobilmenu,
scrollanimationer og formularer deler styling og JavaScript.

## Hosting

Siden kører på **Cloudflare Pages** (`lokaltutor`, koblet til `Markusmj2256/tutor`,
gren `main`, ingen byggekommando, output `/`). Nye commits publiceres automatisk.

| Adresse | Rolle |
| --- | --- |
| `lokaltutor.pages.dev` | Produktion. Canonical peger hertil. |
| `lokaltutor.vercel.app` | Kører fortsat, fordi QR-koderne på de trykte flyers peger på `/f/f1` … `/f/f5` her. Slettes først når flyers er trykt om. |
| `markusmj2256.github.io/tutor` | Viderestiller til Cloudflare. |

Cloudflares gratisplan tillader udtrykkeligt kommerciel brug, i modsætning til
Vercels Hobby-plan.

Siden er ren statisk — al backend ligger i Supabase — så den kan hostes hvor som
helst. Værtsspecifik konfiguration ligger side om side i repoet, og hver vært
ignorerer de andres filer:

| Fil | Læses af |
| --- | --- |
| `_headers`, `_redirects` | Cloudflare Pages |
| `vercel.json` | Vercel |
| `.nojekyll` | GitHub Pages |

### Stier uden .html

Cloudflare Pages serverer `/holdundervisning` og sender `/holdundervisning.html`
videre dertil med en 308. Vercel og GitHub Pages bruger endelsen. Al kode, der
sammenligner stier — flyersporingen i klienten, edge-funktionen og
`register_tutor_flyer_visit` — godtager derfor begge former og gemmer kun den
korte, så rapporterne ikke deles i to sæt hen over et hostingskifte.

### Korte flyer-adresser

`/f/f1` … `/f/f5` sender videre til forsiden eller en undervisningsside med
`?flyer=…`. **QR-koderne på de trykte flyers peger på disse adresser.** De skal
defineres på hver vært for sig: `vercel.json` for Vercel, `_redirects` for
Cloudflare. Glemmes den ene, giver hver eneste QR-kode 404.

## Backend — henvendelser

Alle tre formularer sender til Supabase edge-funktionen `contact`, som gemmer i
tabellen `tutor_leads` og sender en notifikationsmail via Resend. Henvendelsen
gemmes altid først, så en besked ikke går tabt, hvis mailtjenesten fejler.

Værn mod spam og dubletter:

| Lag | Virkning |
| --- | --- |
| Honeypot | Skjult felt `company`; udfyldt = bot. Afvises stille med 200. |
| Tidskontrol | Indsendt under 2 sekunder efter sidevisning = bot. Afvises stille. |
| Rate limit | Højst 5 indsendelser i timen og 15 i døgnet pr. IP. Svarer 429. |
| Dubletter | `submit_tutor_lead` samler gentagne henvendelser fra samme person på samme formular i én række. |

Dubletter genkendes på normaliseret mail (små bogstaver) eller telefon (sidste
otte cifre, så `+45 24 25 99 86` og `24259986` er samme nummer). Skriver nogen
sig op igen, opdateres rækken, beskeden lægges til som nyt afsnit, og
`submissions` tælles op. Unikke indeks i databasen garanterer én række pr.
person pr. formular.

Rate limiting bruger `tutor_submit_log`, som kun gemmer et saltet SHA-256-hash
af IP-adressen — ingen personoplysninger. Rækker over 30 dage ryddes løbende.

## Admin

`admin.html` viser henvendelserne. Log ind med Supabase Auth.

Adgangen styres af row level security, ikke af klientkoden: en konto får kun
adgang, hvis dens mailadresse står i tabellen `admin_emails`. Anon-nøglen i
`admin.js` er offentlig og giver i sig selv ingen adgang til data.

Siden kan filtrere på formular og status, søge i alle felter, sætte status
(ny, kontaktet, tilmeldt, lukket), gemme egne noter og hente en CSV til Excel.
Indsendt indhold vises altid med `textContent`, aldrig `innerHTML`.

`admin.html` og `admin.js` er udelukket i `robots.txt`, og `_headers` sætter
`no-store` og `X-Robots-Tag: noindex` på `/admin`.

## Flyertrafik

Fem flyer-varianter har hver sit permanente kampagne-ID og korte QR-link fra
`/f/f1` til `/f/f5`. Vercel sender videre til den relevante landingsside.
Flyerbesøg og nye henvendelser kobles i Supabase. Admin viser besøg, kontakt-rate
og tilmeldingsrate med periodevalg, filtre og CSV. Tilmeldinger følger manuelt
statusfeltet på henvendelserne. Se [flyervejledningen](docs/flyer-tracking.md).

## Persondata og GDPR

`privatliv.html` beskriver hvad der gemmes, hvorfor, hvor længe og hvordan man
får det slettet. Den er linket fra alle footere og fra hver formular.

**Der er ingen cookies og ingen lagring på de besøgendes enheder.** Derfor er
der heller ikke brug for et cookiebanner. Det er kontrolleret: de offentlige
sider laver nul kald til tredjeparter.

Skrifttyperne lå før på `fonts.googleapis.com`, hvilket sendte hver besøgendes
IP-adresse til Google. De ligger nu i `assets/fonts/` og indlæses via
`assets/fonts.css`, så intet forlader domænet.

Flyersporingen bruger et tilfældigt besøgs-id, der kun lever i adresselinjen
under besøget. Der gemmes ingen rå IP-adresser — kun saltede hash.

### Slettefrister

Håndhæves af databasen, ikke af hukommelsen. `public.slet_udloebne_persondata()`
kører hver nat kl. 03.30 UTC via pg_cron (job `slet-udloebne-persondata`).

| Data | Slettes efter |
| --- | --- |
| `tutor_leads` | 24 måneder efter `updated_at` |
| `tutor_flyer_visits` | 12 måneder, kun besøg uden tilknyttet henvendelse |
| `tutor_submit_log` | 30 dage |

Besøg med en henvendelse bevares, indtil henvendelsen selv slettes — ellers
ville kilden forsvinde før henvendelsen.

### Udestående

Databehandleraftaler skal accepteres hos Supabase, Resend og Cloudflare. De er
nævnt som databehandlere i politikken, men aftalerne er ikke indgået endnu.
Privatlivspolitikken nævner fortsat Vercel som hostingleverandør; det skal
rettes til Cloudflare, når Vercel lukkes ned.

Når `lokaltutor.dk` går i luften: giv `lokaltutor.pages.dev` `X-Robots-Tag:
noindex` i `_headers`, ellers indekserer Google to identiske sider. Gør det
ikke før — så afindekseres hele siden.

## Lokal forhåndsvisning

Kør `python3 -m http.server 8099 --bind 127.0.0.1` fra denne mappe og åbn
`http://127.0.0.1:8099/`. Porten 8099 er med i edge-funktionens CORS-liste,
så formularerne også virker lokalt.
