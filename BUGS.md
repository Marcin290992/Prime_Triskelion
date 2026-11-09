# Błędy i poprawki

## About na mobile/tablecie: cofanie bez przejścia i ucięcie w połowie

**Objaw:** po cofnięciu z podstrony About na telefonie lub tablecie nie było przejścia między stronami. W połowie strona ucinała się twardo. Na innych podstronach działało poprawnie. Występowało tylko na mobile i tablecie, przy dużym portrecie ze zdjęciem.

**Przyczyna:** przy wyjściu ze strony kod wygaszał żywe warstwy, w tym duży portret z maską i filtrem. Na telefonie to się zacinało, a strona ucinała się w połowie.

**Poprawka:** na About, na ekranach do 1024px lub z dotykiem, strona jest zasłaniana jedną czarną warstwą (krycie 0 → 1 przez 0,5 s, `sine.inOut`), zamiast wygaszania portretu. Na większych ekranach bez dotyku (desktop) About wygasza się samym kryciem (0,6 s, `sine.inOut`), bez blura, bo portretu z maską i filtrem nie da się płynnie rozmyć drugi raz.

**Plik:** `src/utils/pageTransitions.ts`, funkcja `preparePageExit` (rozpoznanie About: obecność `.am-portrait-img` lub `.ac-photo`).

**Próbowane i porzucone:** samo wygaszanie krycia bez blura na dotyku (commit `3aec124`) — zastąpione czarną warstwą, bo wygaszanie żywych warstw portretu nadal potrafiło się zacinać. Nie wracać do tego.

**Ograniczenie:** cofnięcie gestem krawędziowym w iOS Safari (swipe-back) ma animację przeglądarki, której kod strony nie przechwytuje.

## About na mobile: blur portretu zacinał animację

**Objaw:** portret na About miał na desktopie blur przy wejściu, a na mobile trzeba go było wyłączyć, bo animacja się zacinała.

**Przyczyna:** blur był animowany na kontenerze z maską, więc przy każdej klatce rozmywanie i maskowanie liczyło się od nowa.

**Poprawka:** blur jest tylko na samym zdjęciu, w jednym filtrze razem z szarością i jasnością (`grayscale contrast brightness blur`, 28px → 0). Kontener z maską animuje samo krycie.

**Plik:** `src/pages/about.astro`, funkcja `initAboutContent` (gałąź mobile).

**Gdyby zacinało:** zmniejszyć promień blura, np. do 16px.

## iPhone/iPad (Safari): poziomy pasek szarpał i cofał się po puszczeniu palca

**Objaw:** sekcja "What we've created." (poziomy pasek ze zdjęciami przypięty do ekranu) na iPhonie szarpała, cofała się albo skakała, zwłaszcza gdy po puszczeniu palca strona jeszcze sunęła siłą rozpędu. W Chrome i w emulacji wszystko było w porządku.

**Przyczyna:** scroll strony robił system (natywnie, na wątku kompozytora), a pasek przesuwał skrypt GSAP (wątek główny). Przyklejenie (`position: sticky`) i przesuw `transform` liczą się wtedy w innym rytmie i podczas momentum rozjeżdżają się. To typowy problem Safari.

**Co NIE pomogło (nie powtarzać):**
- snap do najbliższego slajdu (`ScrollTrigger` `snap`) — przesuwa stronę programowo, gdy palec jeszcze nadaje pęd, więc daje "cofnięcie",
- `ScrollTrigger.normalizeScroll(...)` na iOS,
- animacje CSS sterowane scrollem (`animation-timeline: view()`) — w Safari liczą się na wątku głównym i też szarpią,
- różne układy i `scrub` z wygładzaniem (np. `0.3`).

**Poprawka (to zadziałało, sprawdzone na prawdziwym iPhonie):** scrollem na dotyku steruje **Lenis** z `syncTouch`, napędzany tym samym zegarem co GSAP. Pozycja strony i pozycja paska liczą się w tej samej klatce, więc nie mogą się rozjechać. Sposób podejrzany z kodu white-desert.com (Next.js + GSAP + Lenis).

**Ustawienia, które działają** (`src/utils/touchLenis.ts`):

```ts
export const TOUCH_LENIS_OPTIONS = {
  autoRaf: false,            // raf woła zegar GSAP, nie Lenis sam
  syncTouch: true,           // Lenis steruje też dotykiem
  syncTouchLerp: 0.075,
  touchInertiaExponent: 1.7,
  touchMultiplier: 1,
} as const;
```

```ts
// tworzenie (na dotyku: pointer: coarse)
const lenis = new Lenis({ ...TOUCH_LENIS_OPTIONS });
window.__lenis = lenis;
const raf = (time: number) => lenis.raf(time * 1000); // GSAP daje sekundy
gsap.ticker.add(raf);
gsap.ticker.lagSmoothing(0);              // u nas: syncTickerToScroll()
lenis.on('scroll', ScrollTrigger.update); // ScrollTrigger zna pozycję Lenisa
// sprzątanie przy zmianie strony (astro:before-swap):
//   gsap.ticker.remove(raf); lenis.destroy(); window.__lenis = null;
```

Do tego globalnie `ScrollTrigger.config({ ignoreMobileResize: true })` (pasek adresu zmieniający wysokość okna nie przelicza układu w trakcie gestu).

**Gdzie to jest w tym projekcie:**
- Home — `src/pages/index.astro`, funkcja `initLenis` (gałąź dotyku),
- Winds of Sinai — `src/pages/projects/[slug].astro`,
- wszystkie pozostałe strony — fallback w `src/layouts/Layout.astro` (`initLayoutLenis`; wcześniej na iPhonie był tu pomijany).

Desktop zostaje przy swoim Lenisie z `lerp` (na dotyku to jest osobna konfiguracja).

**Uwagi na przyszłość:**
- Menu overlay musi zatrzymywać Lenisa przy otwarciu (`lenis.stop()` / `start()`), bo inaczej dotyk przewija stronę pod spodem. Tu robi to `lockBodyScroll` w `oxygenMenu.ts`.
- Elementy z własnym przewijaniem wewnątrz strony oznaczać `data-lenis-prevent`.
- `lagSmoothing(0)` jest po to, żeby GSAP nie "gubił" klatek, gdy scrollem steruje skrypt.

## Poziomy pasek na mobile: konstrukcja, która działa

Sekcja "What we've created." (`src/components/sections/SelectedWorkSection.astro`, klasy `.sw-mob*`):

- **Wysoki wrapper** o wysokości liczonej z pomiarów (ekran + dystans w bok + pauzy), a w nim **element `position: sticky; top: 0`** z wysokością ekranu. Żaden przodek sticky nie może mieć `overflow: hidden`, bo Safari wyłącza wtedy sticky (sam sticky może).
- **Jedna animacja** `gsap.to(track, { x: -dystans, ease: ..., scrollTrigger: { trigger: wrapper, start: 'top top', end: '+=dystans', scrub: true, invalidateOnRefresh: true } })`. `scrub: true`, bez wygładzania, bez snapu, bez `pin`.
- **Wysokości w stałej jednostce ekranu** (`--app-stable-vh`, mierzona raz w Layout), żeby pasek adresu nie zmieniał długości przypięcia w trakcie scrolla.
- **Bez pauz po drodze.** Wcześniej była pauza na karcie "Discover my complete collection…" (funkcja `ease` + `coverHold`), ale przy scrollu sterowanym Lenisem jest zbędna — pasek jedzie liniowo (`ease: 'none'`) aż do ostatniego slajdu. Na końcu zostaje tylko krótkie przytrzymanie (`hold`).
- **Paralaksa** zdjęć i tekstu liczona z `onUpdate` tej samej animacji (zawsze w tej samej klatce co ruch paska), pomiary offsetów tylko przy starcie i `refreshInit`, nie w każdej klatce.
- Bez skryptu albo przy `prefers-reduced-motion` pasek jest zwykłym przesuwanym palcem rzędem ze snapem (czysty CSS).

## About: skok do góry przy cofaniu scrolla (poprawka na prawdopodobną przyczynę)

**Objaw:** na About, gdy portret jest już odsłonięty i użytkownik cofa scroll, strona potrafiła skoczyć do góry.

**Uwaga:** w emulacji się nie odtworzyło (emulacja nie ma prawdziwego paska przeglądarki), więc to poprawka na najbardziej prawdopodobne przyczyny, nie potwierdzona wprost.

**Przyczyny i poprawki** (`src/pages/about.astro`):
1. Odświeżanie przypięć przy zmianie wysokości okna (pasek adresu wraca przy scrollu w górę) — `ScrollTrigger.config({ ignoreMobileResize: true })` także na About (wcześniej ustawiane tylko na stronie głównej, więc wejście od razu na About go nie miało).
2. Długość przypięcia portretu liczona z żywego `window.innerHeight` — teraz ze stałej wysokości ekranu (`--app-stable-vh`).
3. Scroll anchoring Chrome (korekta pozycji przy zmianie wysokości strony przez rozstawianie przypięć) — `overflow-anchor: none` na `html, body` na tej stronie.

## Winds of Sinai na iPhonie: białe kreski przy lewej krawędzi napisu startowego

**Objaw:** na telefonie/tablecie (Safari na iPhonie 14), po przewinięciu poza napis startowy i cofnięciu do niego, przy lewej krawędzi ekranu widać było dwie małe białe kreski, kawałki liter W i O. Słabsze plamki niżej, na wysokości kolejnych linii tekstu. Na Androidzie nie występowało.

**Przyczyna:** napis startowy (`.wos-splash`, czarne tło) przykrywał tylko kolumnę panelu (około 28px–362px od lewej), a nie cały ekran. Panel pod nim jest wyrównany do lewej, więc pierwsze litery tytułu (W, O) leżą dokładnie na krawędzi tej kolumny. Wszystko, co z panelu nie jest w 100% niewidoczne (litery, ich blur, antyaliasing na brzegu tła), przebijało przez brzeg. Pomiar: gdy tytuł panelu miał 50% widoczności, jasne piksele wychodziły tylko w lewym marginesie, na wysokości obu linii tytułu, po prawej zero.

**Poprawka:** napis startowy ma szerokość całego ekranu (`left: calc(50% - 50vw); width: 100vw`), więc brzeg tła jest daleko od liter panelu. Po poprawce test nie znalazł jasnych pikseli po bokach (390px i 820px).

**Plik:** `src/pages/projects/[slug].astro`, `.wos-splash` w bloku mobile.

**Próbowane i porzucone:** ukrywanie elementów panelu przez `autoAlpha` (`visibility: hidden`) i `translateZ(0)` na warstwie napisu — to były plastry, nie dotykały przyczyny. Wartości animacji w spoczynku były poprawne (panel 0, napis 1), więc to nie był błąd stanu, tylko krawędź przykrycia.

**Uwaga:** emulacja WebKit na Windowsie błędu nie pokazuje; potwierdza go tylko prawdziwy iPhone.

## Światło: gasło nagle przy szybkim scrollu (About, strona główna)

**Objaw:** na About (i na stronie głównej) światło w hero gasło czasem nagle, a czasem powoli, zależnie od tego, jak szybko się przewijało.

**Przyczyna:** wygaszanie było częściowo sterowane przewijaniem (`scrub` lub jasność liczona z pozycji scrolla), a częściowo zegarem (`.rays-off` zatrzymywał rysowanie po progu). Przy wolnym ruchu oba trafiały w siebie, przy szybkim się rozjeżdżały.

**Poprawka:** jedno wygaszanie na zegarze, zawsze tej samej długości (około 1,4 s), włączane progiem przewijania; powrót 1,2 s. Wspólny czas wygaszania w `sideRays.js` / `sideRaysLegacy.js` (`dimMs`) i w `HeroSection.astro` ustawiony na 1,4 s. `.rays-off` dodawane dopiero, gdy jest już ciemno.

**Pliki:** `src/pages/about.astro` (`setRays`), `src/pages/index.astro` (`setLight`), `src/utils/sideRays.js`, `src/utils/sideRaysLegacy.js`, `src/components/sections/HeroSection.astro`.

**Zasada:** światła nie wygaszać `scrubem`, tylko na zegarze od progu.

## About: portret z kafelków (WebGL) mrugał na końcu, zwłaszcza na telefonie

**Objaw:** gdy kafelki składały się w portret, na samym końcu było krótkie mrugnięcie, mocniej na telefonie.

**Przyczyny i poprawki** (`src/utils/faceTiles.ts`, `src/pages/about.astro`):
1. Przejście z kafelków na prawdziwe zdjęcie: oba były półprzezroczyste jednocześnie, więc w połowie jasność spadała. Teraz zdjęcie jest wstawiane pod gotowe, nieprzezroczyste kafelki, a dopiero potem kafelki znikają (wolniej, `sine.inOut`).
2. Kafelki próbkowały ogromny oryginał (3840px) bez wygładzania, więc na końcu zmieniała się ostrość. Teraz tekstura to zdjęcie już przycięte i zmniejszone przez przeglądarkę do rozmiaru ekranu.
3. Rozdzielczość canvasu była ograniczona do 2×, a iPhone ma 3×. Teraz pełna rozdzielczość urządzenia (do 4096px).
4. Jasność kafelków była o około 2,3% wyższa niż zdjęcia z filtrem CSS (`0.9` → `0.877`).
5. Zmiana rozmiaru czyści canvas: rysowanie od razu w tej samej klatce, nie w następnej (pusta klatka).
6. Zdjęcie pod spodem ma krycie `0.001`, nie `0` (warstwa przy zerze może się nie malować i wskakiwać późno).

**Telefon/tablet:** portret przypięty na 1,7 wysokości ekranu (było 0,7), z lekkim wygładzaniem scrolla, bo kafelki składały się za szybko.

**Uwaga o tekście i kafelkach na desktopie:** tekst nie rusza się z miejsca, wychodzi z ciemności dopiero po przypięciu sekcji; kafelki startują wcześniej (osobny `ScrollTrigger`).

## Reguły na przyszłe projekty (Safari / mobile)

1. Przypięcia i poziome paski: **sticky + jedna animacja `scrub: true`**, bez snapu, bez `normalizeScroll`, bez animacji CSS sterowanych scrollem.
2. Na dotyku: **Lenis `syncTouch` na zegarze GSAP** (opcje wyżej), `lagSmoothing(0)`, `lenis.on('scroll', ScrollTrigger.update)`.
3. `ScrollTrigger.config({ ignoreMobileResize: true })` na każdej stronie z przypięciami.
4. Wysokości przypięć w **stałej wysokości ekranu**, nie w `100vh` ani `innerHeight` na żywo.
5. `html, body { overflow-anchor: none }` tam, gdzie przypięcia zmieniają wysokość strony.
6. Safari sprawdzać na prawdziwym iPhonie. Emulacja Chromium nie pokaże szarpnięć z momentum ani zachowania paska adresu.

## Commity

- `51afbee` — wyjście z About na telefonie/tablecie przez czarną warstwę
- `f9dba08` — rozmyta kopia portretu (zastąpiona w kolejnym commicie)
- `d26577a` — prawdziwy blur na samym zdjęciu
- `94a42b9` — About: poprawka skoku przy cofaniu scrolla (ignoreMobileResize, stała wysokość, overflow-anchor)
- `e81d4b7` — pasek poziomy na wzorcu (wrapper + sticky + jedna animacja `scrub: true`)
- `4d30221` — test: Lenis `syncTouch` na stronie głównej (dotyk)
- `3d218d4` — oryginalny wygląd paska na tym mechanizmie
- `77c74e6` — usunięta pauza na karcie "Discover…" (pasek jedzie liniowo)
- `d5b5e8c` — ten sam Lenis na dotyku na całej stronie (wspólne opcje w `src/utils/touchLenis.ts`)
- `2447885`, `bc52fe8`, `48212d8`, `4890e46` — About: portret z kafelków (WebGL), mrugnięcie na końcu, dłuższe przypięcie na telefonie; światło wygaszane na zegarze na wszystkich stronach
- `aa8526b` — Winds of Sinai (iPhone): napis startowy na całą szerokość ekranu (kreski W i O przy lewej krawędzi)
