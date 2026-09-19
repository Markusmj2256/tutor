# Flyertrafik og konvertering

Produktion: https://lokaltutor.dk · GitHub: Markusmj2256/tutor, main.
Cloudflare Pages-projekt: lokaltutor. Supabase: kslmcjkyhxdevdfyzzrb.
Statisk HTML/CSS/JS er bevaret. Kontakt-backenden er udvidet, ikke erstattet.

## Links (genbrug aldrig en kode til et andet design)

| Kode | Flyer | QR-destination | Landingsside |
| --- | --- | --- | --- |
| f1 | 01 · Mere ro | https://lokaltutor.dk/f/f1 | Forside |
| f2 | 02 · Styr på matematikken | https://lokaltutor.dk/f/f2 | Forside |
| f3 | 03 · Tryghed til at spørge | https://lokaltutor.dk/f/f3 | Forside |
| f4 | 04 · 1:1-undervisning | https://lokaltutor.dk/f/f4 | 1:1 |
| f5 | 05 · Holdundervisning | https://lokaltutor.dk/f/f5 | Hold |

Cloudflare laver midlertidige redirects (via `_redirects`) fra de korte links til sider med `?flyer=f1`
osv. Det gør det muligt at ændre landingssiden senere uden at genoptrykke QR.
Flyer-originaler, SVG-koder, PDF'er og linkmanifest ligger lokalt i `Flyers/`.
Gamle tryksager med samme fælles QR kan ikke identificeres pr. variant bagudrettet.

## Se resultater

Log ind på https://lokaltutor.dk/admin. Den nye sektion viser fem
flyers med besøg, nye henvendelser, kontakt-rate, tilmeldte og tilmeldingsrate.
Vælg 30 dage, 90 dage eller alle datoer. Hent flyer-CSV for at sammenligne i Excel.
Henvendelseslisten har et flyerfilter, og flyer-navnet indgår også i lead-CSV.
Markér henvendelsens status som **Tilmeldt**, når eleven tilmelder sig.

I Supabase kan samme all-time-oversigt ses i viewet
`public.tutor_flyer_performance` (Table Editor eller SQL Editor):

```sql
select * from public.tutor_flyer_performance;
select * from public.tutor_flyer_report(30);
```

## Hvad tallene betyder

- **Besøg:** Et browserforløb fra flyer-linket med et tilfældigt UUID. Samme ID
  på genindlæsning og interne links tæller én gang. Det er ikke unikke personer
  eller et præcist antal fysiske QR-scanninger. JavaScript, adgang til backenden
  og en synlig side kræves. Linkdeling kan dele ét forløb; en ny scanning af den
  trykte kode starter et nyt forløb.
- **Nye henvendelser:** Nye rækker gemt af kontakt-backenden. En konvertering
  gemmes atomisk sammen med henvendelsen i `tutor_flyer_conversions`. Eksisterende
  dubletregler er pr. person **pr. formular**, ikke på tværs af alle formularer.
  En gentagen henvendelse flytter ikke den oprindelige attribution til en ny flyer.
- **Kontakt-rate:** Besøg med mindst én ny henvendelse / besøg × 100. Antallet af
  henvendelser kan overstige konverterede besøg, hvis samme besøg bruger to formularer.
- **Tilmeldte:** Tilskrevne henvendelser med aktuel status `tilmeldt`.
  Tilmeldingsrate = besøg med mindst én tilmeldt / besøg × 100. Status er manuel;
  ingen betalinger eller automatisk verificering af køb er indført.
- **Periode:** Besøg i perioden og de tilhørende henvendelser/tilmeldinger,
  også når en status opdateres senere. En periode uden besøg viser `—` for rater.
- **Attribution:** Flyer-ID og besøgs-ID følger websitets interne links. Gyldig
  i 24 timer. Intet gemmes i cookies, localStorage eller sessionStorage. Senere
  direkte besøg, andre enheder, opkald, SMS og direkte mails tilskrives ikke.
  Manglende/ugyldig tracking må aldrig forhindre en kontaktformular i at blive gemt.

Fordel flyers under sammenlignelige forhold, og registrér antal uddelte og steder
separat. Små stikprøver er usikre. F4/f5 markedsfører forskellige tilbud, så forskelle
afspejler både design, tilbud, landingsside og hvor flyers er uddelt.

## Adgang og data

Alle nye tabeller har RLS. Kun eksisterende admin-konti kan læse statistikken;
anon kan hverken læse eller skrive rækker. Kun `service_role` kan kalde de to
skrivefunktioner. Views og rapportfunktionen kører som `security_invoker`.
Service role ligger udelukkende på Supabase. Kontakt-endpointets JWT-kontrol
er fortsat aktiv. Den offentlige anon-nøgle er ikke botbeskyttelse.

Besøg gemmer flyer, UUID, tidspunkt, sti og testflag. Til rate limiting gemmes et
dagligt saltet IP-hash, aldrig rå IP eller user agent i besøgstabellen. Hashes ældre
end to dage nulstilles ved den eksisterende stikprøvevise oprydning under kontakt-
indsendelser (derfor ingen garanteret slettefrist uden trafik). Højst 120 nye besøg
pr. dagligt IP-hash pr. time, håndhævet under en database-lås. Kendte bot/preview-
user agents ignoreres. Det forhindrer ikke al kunstig trafik.

Attribution bliver knyttet til personoplysninger, når en formular gemmes. Formularerne
forklarer dette. Den eksisterende samlede privatlivspolitik/slettepolitik er fortsat
ikke en del af denne ændring. Den bør også beskrive flyer-attribution.

## Test og udgivelse

`?tracking_test=1` (sammen med flyer-parameteren) og localhost registreres som tests
og udelades af resultaterne. Admins testlinks sætter flaget automatisk. Disse links
skal ikke trykkes. Et testflag slår **ikke** afsendelse af kontaktmail fra: brug
testværktøjets mock, ikke rigtige kontaktindsendelser, til QA uden mails.

- `node --test tests/*.test.cjs`: klientforløb og Edge Function med mock-database/mail.
- `supabase/tests/flyer_attribution.sql`: reelle databaseassertioner i en transaktion
  med rollback, inklusive RLS, dubletter, udløb, rate limit og tilmeldingsstatus.
- `tests/browser.cjs`: tre formularforløb med mock-kontakt-POST; real testbesøg;
  admin med testdata, filtrering, rater, status og mobil. Kræver Puppeteer og :8099.

Migrationen udvider de eksisterende `tutor_leads`, `submit_tutor_lead` og `is_admin`.
Den er ikke en fuld bootstrap af projektet. Deploy migration før den opdaterede
`supabase/functions/contact/index.ts`, derefter push frontend til main for Vercel.
Backend-koden er nu versionsstyret i samme GitHub-repo. Gamle frontendversioner
kan stadig sende henvendelser uden flyerfelter.

Verificerede platformreferencer:
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/functions/auth
- https://vercel.com/docs/git
