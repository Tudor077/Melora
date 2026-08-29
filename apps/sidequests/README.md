# Sidequest

Misiuni turistice absurde, generate **local pe telefon**, cu un **prostimetru** de la 0 la 100.
Fără cont, fără server, fără internet: aplicația compune misiunile pe loc dintr-o gramatică de
fragmente, așa că numărul de misiuni nu e o listă scrisă de mână, ci o combinatorică.

**~5,9 miliarde de misiuni distincte doar la prostie 100**, însumat pe cele nouă locuri. Numărul
afișat în aplicație e calculat din vocabularul real, nu scris în cod — și e verificat prin
enumerare exhaustivă în `npm run check`.

## Cum funcționează generatorul

O misiune se compune din patru sloturi, alese cu un RNG determinist (`mulberry32`):

```
ACȚIUNE({țintă})  +  0–3 CONSTRÂNGERI  +  DOVADĂ  +  TITLU
```

Câteva reguli fac diferența dintre asta și un mad-libs stricat:

- **Țintele își poartă propriul articol** („un felinar", „o statuie"), iar acțiunile sunt scrise
  ca să nu ceară niciodată genitiv, dativ sau clitice cu gen. Asta e ce permite înmulțirea
  liberă a pool-urilor fără să se strice acordul în română.
- **Acțiunile declară ce tip de țintă acceptă** (`obiect`, `persoana`, `loc`, `animal`,
  `mancare`, `semn`), ca să nu apară „Salută un felinar" acolo unde nu are sens.
- **Constrângerile știu ce cer și ce interzic.** O acțiune care presupune vorbit nu primește
  niciodată „nu ai voie să spui niciun cuvânt", și două constrângeri nu se contrazic între ele.
- **Slider-ul chiar filtrează, nu doar ponderează.** Fiecare fragment are o fereastră
  `[min, max]`, iar peste tierurile joase se elimină și fragmentele care se deblochează mult
  sub poziția curentă — altfel la 95 tot ieșeau misiuni cuminți.

Aceeași sămânță + aceeași setare = aceeași misiune, așa că fiecare misiune are un cod
(`K7QX-2MF`) pe care îl poți trimite cuiva fără niciun server.

### Nivelurile prostimetrului

| | Nivel | Ce înseamnă | Multiplicator |
|---|---|---|---|
| 🙂 | Turist cuminte | Misiuni pe care le poți povesti bunicii | 1× |
| 🤨 | Ușor ciudat | Nimeni nu se uită. Probabil | 1,6× |
| 😅 | Ciudat rău | Cineva sigur s-a întors după tine | 2,4× |
| 🫣 | Jenant | Prietenii se prefac că nu te cunosc | 3,5× |
| 🤡 | Cretinism absolut | Legal, sigur, dar complet lipsit de demnitate | 5× |

**Regulă fixă pentru tot vocabularul, la orice nivel:** legal, sigur, și niciodată pe seama
trecătorilor. Prostia maximă e îndreptată spre jucător, nu spre oamenii din jur — nimic care
înseamnă intrare pe proprietate, deranjarea cuiva sau risc fizic.

## Rulare

```bash
npm run dev --workspace @melora/sidequests     # sau: npm run dev:sidequests din rădăcină
npm run build --workspace @melora/sidequests   # dist/ static, fără backend
npm run check --workspace @melora/sidequests   # verifică gramatica și numărătoarea
```

`npm run check` e testul care contează când adaugi vocabular: randează **toate** perechile
acțiune × țintă și caută acorduri stricate, generează misiuni pe tot slider-ul în toate
scenele și caută constrângeri contradictorii, apoi compară numărul afișat în UI cu o
enumerare prin forță brută.

## Pe telefon

E un PWA: deschizi build-ul servit static, **Adaugă pe ecranul principal**, și după prima
încărcare merge complet offline (service worker cache-first). Progresul — puncte, nivel,
jurnal — stă în `localStorage`, pe telefon, și nu pleacă nicăieri.

## Structură

```
src/generator/   gramatica: rng, vocabular, reguli de compunere, numărătoare
src/state/       persistență în localStorage, XP și niveluri
src/components/  slider, card de misiune, misiune activă, jurnal
public/          manifest, service worker, iconițe
```

## De adăugat vocabular

Adaugă linii în `src/generator/vocab.ts` și rulează `npm run check`. Dacă acțiunea ta cere
vorbit, folosește un verb de vorbire („întreabă", „roagă", „cu voce tare"); dacă cere camera,
folosește „poză" sau „fotografiază" — `grammar.ts` deduce cerințele din text, așa că
formularea e contractul.
