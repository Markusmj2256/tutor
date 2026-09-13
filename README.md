# Markus Johnsen Tutoring

Lys, varm premium-landingside målrettet forældre til gymnasieelever i Gentofte & Lyngby.

- Live: https://lokaltutor.vercel.app
- `index.html` — forside med undervisningsformer, priser, erfaring og kontakt
- `holdundervisning.html` — Matematik A/B på hold med 4–5 elever og interessetilmelding
- `eneundervisning.html` — personlig undervisning, erfaring, anmeldelser og timepakker
- `admin.html` / `admin.js` — intern side med indkomne henvendelser
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

Siden hostes på **Vercel** og udgives automatisk ved push til `main`.

- Produktion: https://lokaltutor.vercel.app
- Projekt: `johsens/lokaltutor`, koblet til `Markusmj2256/tutor`

`gh-pages` viderestiller nu til Vercel, så QR-koder på allerede trykte flyers
stadig virker. Den gren indeholder ikke længere selve siden.

Bemærk: Vercels Hobby-plan er til ikke-kommerciel brug. Undervisning mod betaling
er kommercielt, så planen bør opgraderes, inden der kommer betalende kunder ind
via siden.

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

`admin.html` og `admin.js` er udelukket i `robots.txt`.

## Flyertrafik

Fem flyer-varianter har hver sit permanente kampagne-ID og korte QR-link fra
`/f/f1` til `/f/f5`. Vercel sender videre til den relevante landingsside.
Flyerbesøg og nye henvendelser kobles i Supabase. Admin viser besøg, kontakt-rate
og tilmeldingsrate med periodevalg, filtre og CSV. Tilmeldinger følger manuelt
statusfeltet på henvendelserne. Se [flyervejledningen](docs/flyer-tracking.md).

## Persondata

Henvendelserne indeholder navn, telefon, mail og fritekst om et barns skolegang.
Det er personoplysninger, og nogle af dem angår mindreårige. Siden mangler
fortsat en privatlivspolitik, der beskriver hvad der gemmes, hvor længe og
hvordan man får sine oplysninger slettet.

## Lokal forhåndsvisning

Kør `python3 -m http.server 8099 --bind 127.0.0.1` fra denne mappe og åbn
`http://127.0.0.1:8099/`. Porten 8099 er med i edge-funktionens CORS-liste,
så formularerne også virker lokalt.
