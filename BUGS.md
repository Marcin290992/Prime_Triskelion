# Błędy i poprawki

## Selected work (pełnoekranowy beam): dociąganie nie działało, było za szybkie, napisy pojawiały się razem ze scrollem

**Objaw:** w pełnoekranowej karuzeli ze światłem (sekcja "What we've created.") zdjęcie nie dociągało się samo po przewinięciu, albo dociągało zbyt gwałtownie ("nie premium"). Beam jechał za wolno razem z kółkiem, a na telefonie i tablecie zmiana zdjęć była za szybka. Napisy wchodziły stopniowo razem ze scrollem, przez co łatwo je było przeoczyć. W samodzielnym pliku testowym (`beam-carousel-demo.html`, poza repo) to wszystko działało idealnie na desktopie, tablecie i telefonie.

**Przyczyny (kilka, nakładały się):**
1. **Snap był wyłączony przy każdym wczytaniu.** Lenis jest tworzony dopiero klatkę po `astro:page-load` (`src/layouts/Layout.astro`, `requestAnimationFrame`), a sekcja odczytywała `window.__lenis` jeden raz przy starcie, więc dostawała `undefined`.
2. **Za szybkie dociąganie.** Snap trwał 0,45 s na krzywej critically damped (mocny start, hamowanie na końcu), co wygląda jak szarpnięcie.
3. **Beam pełzał.** Pozycja światła przechodziła przez `smoothstep` i była ściśnięta do przedziału 0,15–0,85 kroku, a do tego wygładzał ją jeszcze Lenis.
4. **Napisy zależały od pozycji scrolla** (przezroczystość liczona z odległości do zdjęcia), więc pojawiały się dopiero na końcu i bez ruchu.
5. **Winieta malowała się nad tekstem:** `::after` miała `z-index: 1` bez własnego kontekstu nakładania.
6. **Mruganie przed beamem w shaderze:** `pow(x, 2.0)` dla ujemnego `x` jest w GLSL niezdefiniowane (na części kart i telefonów daje NaN).

**Poprawka:**
- **Lenis wszędzie**, jeden mechanizm na wszystkich urządzeniach. Snap wzorowany na stronie Forge (podgląd: `forgeautomotive-co-uk/app/src/components/Listing.jsx`): sekcja czeka na Lenis (`attach`, do około 3 s), po 140 ms ciszy (nie, gdy palec jest na ekranie: `lenis.isTouching`) dociąga do zdjęcia. Idzie dalej, gdy przeleciano 10% drogi w stronę ruchu (`DEPART`), inaczej wraca do poprzedniego.
- **Tempo:** `lenis.scrollTo`, 0,9 s plus do 0,6 s za dłuższą drogę, krzywa in-out cubic. Wolno i miękko.
- **Jeden gest = najwyżej jedno zdjęcie** (`anchor`): mocny rzut palcem z bezwładnością Lenis potrafił przeskoczyć dwa.
- **Swobodny scroll** przed pierwszym i po ostatnim zdjęciu (strefa snapu zaczyna się 0,6 ekranu przed pierwszym i kończy 0,45 po ostatnim).
- **Beam** przechodzi liniowo przez cały krok (`RANGE = [0, 1]`); krzywą daje snap i Lenis. DPR ograniczony do 1,25 na dotyku i 1,75 na desktopie.
- **Napisy:** czasowe (nie od scrolla), startują, gdy beam jest w połowie (`TEXT_IN = 0.5`, wyjście przy 0.62, żeby nie migało), linia po linii (tytuł, opis, przycisk co 0,12 s), z blura i przesunięcia 26 px, `expo.out`, 1,2 s.
- **Winieta:** `isolation: isolate` na ramce zdjęcia.
- **Shader:** `x * x` zamiast `pow(x, 2.0)`.

**Pliki:** `src/components/sections/SelectedWorkSection.astro` (skrypt: `setupSnap`, `attach`, `revealText`), `src/utils/beamSlides.ts` (shader, DPR), `src/styles/global.css` (reguła `html.sw-hscroll`: na telefonach pasma blur zostają, tylko lżejsze), test `tests/e2e/selected-work.spec.ts`. Poprzednia pozioma karuzela: `src/components/backup/SelectedWorkSection.before-gsap-beam.astro`.

**Próbowane i porzucone (nie wracać bez powodu):**
- **`data-lenis-prevent` na scenie + snap ze ScrollTrigger** (tak jak w pliku testowym, natywny scroll). Działa, ale strona ma mieć jeden Lenis na każdym ekranie, więc odrzucone.
- **Wyłączanie `smoothWheel` / `syncTouch` w Lenis w locie** na czas przypięcia: zbyt kruche przy wejściu i wyjściu z sekcji, wycofane.
- **`lenis.stop()` na czas sekcji:** nie nadaje się. Zatrzymany Lenis wywołuje `preventDefault`, więc blokuje też natywny scroll.
- **Dłuższy krok na dotyku (2 ekrany na zdjęcie)** jako lekarstwo na za szybką zmianę: dawał tylko dłuższą sekcję, nie poprawiał płynności.
- **W samym demie:** `scroll-snap` w CSS na `html` i własne przechwytywanie kółka. Snap cofał stronę, nie dało się wyjść z sekcji i migało na skrajnych zdjęciach.
- **Lżejszy shader** (czytanie tylko widocznego zdjęcia, rozdzielenie kolorów tylko tam, gdzie widać) oraz najtańszy wariant na Chrome Android (bez rozdzielenia kolorów, canvas 1x): zmiana słuszna, ale **nie tu leżała przyczyna zacięć na Chrome mobile**.

**Zacięcia na Chrome mobile (Android) — przyczyna znaleziona:** zacinało się dokładnie w chwili, gdy wchodził tekst projektu i przycisk Explore. Po wyłączeniu ich (`SHOW_TEXT = false` w `SelectedWorkSection.astro`) wszystko działa płynnie, a Safari na iPhonie było płynne od początku. Winowajcy to prawdopodobnie: animowany `filter: blur()` na trzech liniach naraz, siedmiowarstwowy `text-shadow` (do 90 px) i `backdrop-filter: blur(20px)` na Explore, wszystko malowane **nad canvasem WebGL, który zmienia się co klatkę**. Chrome Android musi wtedy przeliczać te warstwy razem z canvasem. Który z trzech elementów jest najgorszy, nie sprawdzono (do tego służą przełączniki `?lite=text`, `?lite=cta`, ale z wyłączonym tekstem nie mają już czego testować).

**Lekka wersja tekstu (wdrożona, do sprawdzenia na Chrome Android):** jedna animowana warstwa na zdjęcie zamiast trzech, tylko `opacity` i `transform` (bez `filter`), `text-shadow` w dwóch warstwach zamiast siedmiu, Explore z ciemnym, prawie pełnym tłem zamiast `backdrop-filter`, `will-change` tylko na czas animacji. Jeśli zacięcia wrócą, wyłączyć tekst (`SHOW_TEXT = false`) i dodawać elementy po jednym: najpierw sam tekst bez cienia, potem cień, potem przycisk.

**Wskazówki na przyszłość:**
- `window.__lenis` czytać **leniwie** (po `requestAnimationFrame`), nigdy tylko raz przy starcie skryptu sekcji.
- W shaderach **nie używać `pow(x, 2.0)`** (ani `pow` z podstawą, która może być ujemna). Pisać `x * x`.
- Pokrętła tempa są w skrypcie sekcji: `IDLE` (cisza przed snapem), `DEPART`, `0.9` i `0.6` w `move(k, …)`, `TEXT_IN` / `TEXT_OUT`, `PER` (ekranów na zdjęcie) i `LEAD`.
- **Test e2e:** dotyk przy Lenis `syncTouch` trzeba symulować zdarzeniami `TouchEvent` (`touchstart` / `touchmove` / `touchend`). Gesty z CDP (`Input.synthesizeScrollGesture`) nie ruszają Lenis. Uruchamiać na osobnym porcie, żeby nie trafić w serwer deweloperski: `PLAYWRIGHT_PORT=4399 npx playwright test selected-work`.
- **Do sprawdzenia na prawdziwym iPhonie:** reguła nr 1 z sekcji "Reguły na przyszłe projekty" mówi "bez snapu" i dotyczyła poziomego paska. Ta sekcja jest pełnoekranowa i ma snap na Lenis, ale gdyby na iPhonie wróciło "cofanie po puszczeniu palca" (jak w wpisie o poziomym pasku), pierwszym ruchem jest usunięcie snapu i zostawienie samego beama podążającego za scrollem.
- W kopii Forge Lenis na dotyku ma `syncTouch: false` (natywny dotyk), a u nas `true` (`src/utils/touchLenis.ts`). To możliwa różnica w odczuciu na telefonie, ale zmiana dotyczy całej strony, więc najpierw test na prawdziwym urządzeniu.

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

## Winds of Sinai: skok strony przy otwieraniu menu

**Objaw:** po kliknięciu menu na podstronie Winds of Sinai zawartość strony najpierw skakała, a dopiero potem pojawiał się overlay menu. Na innych stronach tego nie było.

**Przyczyna:** przy otwarciu menu `lockBodyScroll()` w `oxygenMenu.ts` brało pozycję scrolla z Lenisa (`animatedScroll`) i wymuszało ją przez `lenis.scrollTo(pozycja, { immediate: true })`. Na stronie z przypiętym hero (ScrollTrigger `pin`) wewnętrzna wartość Lenisa potrafi się różnić od prawdziwej pozycji strony, więc wymuszenie jej przesuwało stronę. Dodatkowo strony (index, about, Winds of Sinai) tworzyły własne instancje Lenisa z różnymi ustawieniami, więc na każdej scroll zachowywał się trochę inaczej.

**Poprawka:**
1. Menu bierze prawdziwą pozycję (`window.scrollY`) i przy otwarciu tylko zatrzymuje Lenisa (`lenis.stop()`), niczego nie przewija (commit `e498723`).
2. Jeden, globalny Lenis w `src/layouts/Layout.astro` (zawsze podpięty do `ScrollTrigger.update`). Strony nie tworzą już własnych instancji (commit `eb3307b`).

**Pliki:** `src/utils/oxygenMenu.ts` (`lockBodyScroll`), `src/layouts/Layout.astro` (`initLayoutLenis`), `src/pages/index.astro`, `src/pages/_about-fluid.astro`, `src/pages/projects/[slug].astro`.

**Uwaga:** przyczyny nie odtworzyłem na komputerze (w teście lokalnym skoku nie było), wniosek wynika z kodu i z potwierdzenia, że po obu poprawkach menu działa. Nie wiadomo, która z dwóch poprawek była rozstrzygająca.

**Nie wracać do:** ustawiania pozycji strony z wartości Lenisa przy otwieraniu menu (`scrollTo` z `animatedScroll`) oraz do własnych instancji Lenisa na podstronach.

## Winds of Sinai: zacięcie przy znikaniu napisu i wejściu zdjęcia hero

**Objaw:** pod koniec znikania napisu "Winds of Sinai" (blur) animacja lekko się zacinała, a zdjęcie (`deeer2`) pojawiało się zbyt agresywnie.

**Przyczyna:** zdjęcie zaczynało się pojawiać (od 0,7 osi czasu) jeszcze w trakcie znikania napisu (do ok. 0,85) i naraz zmieniało krycie, skalę i położenie. Do tego duży blur 16px na tekście i duże zdjęcie z maską są ciężkie dla przeglądarki.

**Poprawka:** w `initCinematic()` fade zdjęcia startuje w 0,85 i trwa 1,1 (`power1.inOut`), a skala i przesunięcie idą osobno i dłużej (start 0,8, czas 1,5, `sine.out`). Blur napisu zmniejszony do 12px, dolny tekst wchodzi w 1,6, a przewijanie hero jest dłuższe (`end: '+=170%'`). Dodane `will-change` dla napisu i zdjęcia.

**Plik:** `src/pages/projects/[slug].astro`, `initCinematic()` oraz `.wos-cin__image` i `.wos-cin__l/.wos-cin__r` w CSS.

**Gdyby zacinało:** zmniejszyć plik `src/img/deeer2.webp` (ma 1,5 MB) i uprościć maskę zdjęcia.

## Wyjście z projektu: przypięty ekran skakał na górę, zanim strona zniknęła

**Objaw:** na stronie projektu (napis "Winds of Sinai" lub hero z jeleniem) przy cofaniu lub wyjściu przejście było twarde, a przypięty ekran najpierw skakał na górę i dopiero potem znikał.

**Przyczyna:** przy wyjściu `preparePageExit()` robi fade z blurem na elementach `body`. Hero projektu jest przypięty przez ScrollTrigger (`position: fixed` w pin-spacerze), a `filter` na rodzicu zmienia blok odniesienia dla elementów `fixed`. Przypięty ekran się "odpinał" i skakał na górę. Ten sam problem miała wcześniej strona Projects (`.proj-inner`).

**Poprawka:** `#wos-cin` i `#wos-stage` dodane do listy "heavy" w `preparePageExit()`. Takie strony wychodzą tylko przez opacity, bez blura. Przy okazji hero projektu na desktopie: pin `+=110%`, `scrub: 0.8` i snap `[0, 1]`, żeby jeden ruch kółkiem dociągał sekwencję do końca.

**Pliki:** `src/utils/pageTransitions.ts` (`preparePageExit`), `src/pages/projects/[slug].astro` (`initCinematic`).

**Uwaga:** przyczyna wynika z czytania kodu, potwierdzona tym, że po poprawce wyjście działa dobrze. Snap może się gryźć z Lenisem. Jeśli na końcu sekwencji będzie szarpać, wyłączyć snap i zostawić samo skrócenie pinu.

**Nie wracać do:** blura (`filter`) na elementach `body` na stronach z pinem. Każda nowa strona z przypięciem ma trafić na listę "heavy".

## About w Safari desktop: portret wyłaniał się z ciemności zamiast z kafelków

**Objaw:** w Safari desktop portret na About pojawiał się z ciemności (zapasowa animacja), a w Chrome i na iOS Safari budował się z kafelków.

**Przyczyna (podejrzenie):** zdjęcie miało `loading="lazy"`. Safari desktop potrafi go nie załadować albo odpalić `load` przed nasłuchem, więc tekstura WebGL nigdy się nie tworzyła i kafelki nic nie rysowały.

**Poprawka:** `loading="eager"` i `decoding="sync"` w `about.astro`, a w `src/utils/faceTiles.ts` tekstura tworzy się też po `decode()` oraz ponownie po 400 ms i 1,5 s, jeśli jeszcze jej nie ma.

**Potwierdzone:** po poprawce działa w Safari desktop.

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
- `e60865c`, `8d4a589`, `e6f3a20`, `10c4ce8` — Selected work: pełnoekranowy beam, Lenis wszędzie, snap w stylu Forge, napisy czasowe, usunięte strzałki
