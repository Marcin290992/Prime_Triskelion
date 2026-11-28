# Scroll na telefonie i tablecie: jeden gest = jeden krok

Jak działa otwarcie strony głównej (hero → manifest) i sekcja Selected work na ekranach dotykowych, dlaczego tak, i czego nie ruszać. Uzupełnia `WORKFLOW.md` (Lenis) i `BUGS.md` (historia błędów).

## Zasada

Na dotyku scena nie jest sterowana scrollem. **Jeden gest (swipe, przeciągnięcie, klawisz, kółko) przesuwa scenę o jeden krok, w stałym czasie, niezależnie od siły szarpnięcia.** Scroll strony (Lenis) służy tylko do wejścia w scenę i wyjścia z niej.

Dlaczego nie scrub:
- scena zatrzymana palcem w połowie zostawała w połowie rozmycia (plamy),
- siła i bezwładność palca różnią się między iOS a Androidem, więc ruch był inny na każdym telefonie,
- limiter prędkości, dok (snap) i odcinanie pędu walczyły ze sobą o jedną pozycję.

Co daje czas zamiast scrolla: ten sam filmowy ruch wszędzie, scena zawsze staje **na** kroku, nowy gest przejmuje trwający ruch (wejście nigdy nie jest zablokowane).

## Kiedy to działa

Tylko gdy `(hover: none) and (pointer: coarse)` i **bez** `prefers-reduced-motion`. Desktop nie zmienia się (scrub). Wąskie okno desktopowe z myszką używa starego trybu sekcji Selected work (dok + limiter prędkości). Reduced motion: zwykły scroll i przenikanie zdjęć.

## Gdzie co jest

| Co | Plik |
|---|---|
| Otwarcie hero → manifest na dotyku | `src/utils/introStage.ts` |
| Selected work na dotyku | `src/utils/workStage.ts` |
| Sekcja Selected work (geometria, render, tytuł, desktopowy dok) | `src/components/sections/SelectedWorkSection.astro` |
| Manifest (markup, desktopowy scrub) | `src/components/sections/ManifestoSection.astro` |
| Podpięcie otwarcia, stały ekran manifestu na dotyku | `src/pages/index.astro` |
| Flaga „tekst hero wylądował" (`__ptHeroTextReady`) | `src/components/sections/HeroSection.astro` |
| Kółko / trackpad jako kroki (wspólne dla obu scen) | `src/utils/wheelGesture.ts` |
| Strona /projects (indeks projektów) | `src/pages/projects/index.astro`, dane: `src/data/projects.ts` |
| Opcje Lenisa na dotyku | `src/utils/touchLenis.ts` |

Wszystkie liczby do strojenia są w obiekcie `CFG` na górze `introStage.ts` i `workStage.ts`.

## Otwarcie (`introStage.ts`)

Jedna liczba `pos`: `0` = hero, `1` = manifest, `2` = oddanie strony. Krok jest widoczny, dopóki `|i − pos|` jest mniejsze niż jego zasięg.

- **Krok to „focus pull":** opacity, przesunięcie 26 px, skala ±5%, blur 16 px (10 na słabszych telefonach), od odległości kroku od `pos` (smoothstep).
- **Nakładanie (`overlap: 0.2`):** sąsiednie kroki zaczynają się pokazywać wcześniej, więc w połowie przejścia oba są częściowo widoczne i ekran nie jest pusty.
- **Ruch:** `pos` goni cel z wygładzaniem Lenisa (jego `lerp`, razy `tempo: 0.5`), więc scena hamuje jak scroll.
- **Manifest wypełnia się sam** na zegarze (2,6 s, słowa po kolei, miękka krawędź). Wyjście do hero opróżnia tekst, wyjście do strony go nie opróżnia (wychodzi taki, jaki jest). **Powrót ze Services w górę** przywraca manifest cały (odwrócenie wyjścia, jak na desktopie), bez ponownego wypełniania. Zdanie jest białe (bez czerwonych słów).
- **Oddanie strony (`handOff` przy `pos 1.5`):** scena znika, scroll skacze na koniec manifestu, Lenis wraca. Potem krótki przejazd (`seam`) wprowadza pierwszą usługę w ostrość.
- **Powrót (`engage`):** scroll w górę ze Services przejmuje stronę, scena startuje 0,35 przed oddaniem (`reentry`), żeby manifest już wchodził.
- **Bramka wejścia:** gesty są przyjmowane, gdy tekst hero wylądował (`__ptHeroTextReady`, min. 0,6 s po starcie, maks. 2,5 s), **a nie** gdy skończy się światło (`pt-intro-done`). Po powrocie z innej strony światło trwa ok. 4 s i dotyk był przez ten czas martwy.
- Obsługuje też klawisze i kółko (sekcja Kółko i trackpad niżej).

## Kółko i trackpad (`wheelGesture.ts`)

Wspólne dla `introStage.ts` i `workStage.ts`. **Gest** to seria zdarzeń `wheel` bliższych niż 160 ms (ogon bezwładności trackpada albo szybko kręcone kółko myszy) i daje **jeden krok**, na jego początku. Nowy krok zaczyna: przerwa dłuższa niż 160 ms (pojedyncze „kliknięcia" kółka co pół sekundy krokują każde) albo zdarzenie wyraźnie mocniejsze (1,5×) od poprzedniego (nowe pchnięcie na ogonie poprzedniego). Kroki nie są gęstsze niż co 500 ms.

Dlaczego nie „blokada od ostatniego zdarzenia": każde zignorowane zdarzenie przedłużało blokadę, więc kółko z przerwami krótszymi niż 700 ms zatrzymywało się na jednym kroku na zawsze.

## Selected work (`workStage.ts`)

Sekcja to wysoka strona z przypiętą (sticky) sceną. Jedna liczba `pos` (0 = tytuł, k = zdjęcie k) to pozycja światła.

**Przepływ:**

```
Services ──scroll w dół──▶ tytuł się zapiął ──▶ scena przejmuje stronę (tytuł)
   ▲                                                   │ swipe w górę (×3)
   │                                                   ▼
   │                                          zdjęcie 1 → 2 → 3
   │                                                   │ swipe w górę
   │                                                   ▼
   └── swipe w dół z tytułu ◀── scena ◀── flick w dół ◀── panel „Explore more projects" → dół strony
        (wyjście w górę)       wraca       (asysta)
```

**Trzymanie strony:** Lenis zatrzymany, `touch-action: none` na `html` i `body`, pozycja scrolla trzymana (`lockY`). Skok wewnątrz strefy (np. po zamknięciu menu) jest cofany, **skok wyraźnie poza strefę** (kotwica, link, pasek stanu) zwalnia scenę i strona jedzie, gdzie ją wysłano.

**Kroki:** ruch światła 450 ms + 650 ms × odległość (pełne zdjęcie ok. 1,1 s, krzywa in-out sine). Przeciągnięcie śledzi palec, po puszczeniu osadza się na zdjęciu. Krok następuje po przeciągnięciu o **5% wysokości** albo po szybkim machnięciu (**0,25 px/ms** liczone z ostatnich 120 ms gestu, a nie ze średniej z całego dotyku). Dotknięcie poniżej tego progu wraca na to samo zdjęcie. Nowy gest liczy od celu trwającego ruchu.

**Wejście od góry:** scena przejmuje stronę, gdy tytuł się zapnie (`LEAD 0.14`, linia 0,12 ekranu przed spoczynkiem tytułu). Gest, który wprowadził scenę, **nie** przesuwa zdjęcia (tytuł chwilę stoi).

**Wyjście:** scroll skacze na krawędź strefy (na ekranie nic się nie zmienia, bo scena stoi), a dalej strona jedzie **własną animacją** (out-cubic, 0,95 s, ruszają od razu i hamują) 0,7 ekranu za strefę w dół albo 0,8 przed nią w górę. Własną, a nie `lenis.scrollTo`: bezwładność palca Lenisa dochodzi **po** zakończeniu dotyku i przejmuje przejazd, więc słaby pierwszy flick niósł stronę tylko kawałek i potrzebny był drugi. Na czas przejazdu Lenis jest zatrzymany, a wystartuje na jego końcu.

**Powrót z panelu:** jedno machnięcie palcem w dół (powyżej 40 px, do 0,9 ekranu pod strefą) jest zamieniane na przejazd do ostatniego zdjęcia (0,9 s). Cel leży lekko za linią przejęcia (0,06 ekranu), inaczej scena by jej nie przekroczyła. Dotknięcie w trakcie przejazdu przejmuje stronę, a scena potrafi ją znów złapać (zawrócenie od razu po wyjściu nie leci przez zdjęcia jak zwykły scroll).

**Tytuł „Selected work":** wchodzi na zegarze (0,95 s), gdy ostatnia opcja Services wyjdzie u góry, a wychodzi w 0,45 s przy powrocie w górę. Scroll decyduje tylko kiedy (histereza: wejście powyżej 0,12, wyjście poniżej 0,02). Przy scrubie powolny scroll zostawiał tytuł w połowie rozmycia.

## Strona /projects (indeks projektów)

Ten sam mechanizm (`workStage.ts`, bez zmian) prowadzi listę projektów na telefonie: **jedno machnięcie = jeden projekt**.

**Układ.** Pod nagłówkiem „My Projects." jest wysoka strefa z przypiętą (sticky) sceną: pełnoekranowe zdjęcie (WebGL, ta sama wiązka co na stronie głównej) i warstwa tekstu nad nim. Tekst aktywnego projektu (numer `01 / 03`, nazwa, kategorie, rok, „View project ↗") wchodzi na zegarze, reszta wychodzi. Tap w nazwę otwiera case study. Na desktopie (osobny kod, bez sceny) zdjęcie aktywnego projektu zajmuje lewe 56% ekranu i schodzi do czerni (bez ramki), a lista z nazwami leży po prawej na czystym tle, więc tekst i zdjęcie się nie nakładają. Aktywna nazwa wypełnia się akcentem od lewej. Projekt wybiera faktyczny ruch myszy albo fokus klawiatury (samo przewijanie strony pod nieruchomym kursorem go nie zmienia), i to dopiero gdy kursor zostanie na wierszu ok. 130 ms, więc przejechanie przez wiersz 2 w drodze do 3 nie uruchamia 2. Światło idzie **prosto** z obrazu na ekranie do wybranego (`setMix` w `createBeamSlides`: przejście między dwiema dowolnymi klatkami, bez przechodzenia przez pośrednie). Zmiana wyboru w trakcie przejścia przyspiesza trwające (bez skoku obrazu) i dopiero potem idzie dalej, a powrót do poprzedniego odtwarza drogę wstecz. Wiązka światła zmienia kąt i stronę, z której przychodzi, z przejścia na przejście (opcja `vary` w `createBeamSlides`, tabela `VARIANTS` w `beamSlides.ts`); cofając się wraca tą samą drogą. Strona główna zostaje przy jednym kącie (domyślnie `vary` wyłączone). Zdjęcie po prawej: zamień `left` i `right` w bloku desktopowym i w gradiencie `.pj__shade`.

**Jak scena jest podpięta.** Nagłówek „My Projects." jest **krokiem 0 tej samej sceny**: na wąskim układzie skrypt przenosi go do przypiętej warstwy tekstu (`.proj-header--staged`), a scena trzyma stronę od samego początku (`anchoredTop`, `LEAD 0`). Kroki to nagłówek (0) i projekty (1 … N), więc scena jest tworzona dla `N` kroków, a światło dostaje pozycję wprost. **Jedno machnięcie z nagłówka wprowadza projekt 1**: nagłówek (tytuł, lead, światło z `sideRays`) rozjaśnia się i unosi, a pierwsze zdjęcie wchodzi wiązką. Tempo to te same stałe `CFG` co wszędzie. Wyjście w dół (po ostatnim projekcie) jedzie do sekcji CTA. Powrót z dołu: jedno machnięcie w dół wraca na ostatni projekt (asysta z `workStage.ts`), a dalsze machnięcia wracają do nagłówka (przy kroku 0 niczego nad nim nie ma, więc kolejne machnięcie nic nie robi). Bez sceny (reduced motion) nagłówek zostaje osobną sekcją i projekty są krokami 0 … N − 1 strefy pod nim.

**Scena działa w każdym wąskim układzie** (`max-width: 1024px` lub dotyk), także z myszką: kółko i klawisze (strzałki, PageUp/PageDown, spacja) krokują projekty, a powrót od dołu łapie ostatni projekt. Bez tego wąskie okno z myszką dostawało zwykły scrub i kółko przelatywało po projektach, a w górę wchodziło się prosto do nagłówka.

**Poza rękami sceny** (nad strefą, pod nią) scroll podaje światło: nad strefą pierwszy projekt, pod nią ostatni. Bez sceny (okno desktopowe z myszką, reduced motion) scroll steruje światłem w sposób ciągły, a zdjęcia przenikają się.

**Nagłówek na desktopie** zachowuje własną drogę (`data-rays-pin`, `sideRays.js`): pierwszy scroll w dół odgrywa animację na zegarze (światło gaśnie, blur, zasłona, lądowanie sekcji), a przewijanie w górę z góry sekcji odgrywa ją wstecz. Na wąskim układzie ten mechanizm jest wyłączony (`data-stage-header`, `pinHost` zwraca `null`), bo nagłówek jest krokiem sceny. Wcześniej dawało to dwa machnięcia (pierwsze odgrywało animację nagłówka, drugie wchodziło w scenę) i tempo wpisane na sztywno w `sideRays.js`.

**Przejście do case study na desktopie** (zdjęcie rozrasta się na cały ekran) musi zaczynać się dokładnie od tego, co jest na ekranie, inaczej widać skok: kadr miniatury ma `object-position` równy ostrości zdjęcia (`x` = `focus`, `y` 60% od góry, tak jak w shaderze), a cień panelu (`data-case-shade=".pj__shade"`) jest nakładany na pierwszą klatkę, **rośnie razem z kadrem** (jego rozmyta prawa krawędź jest zawsze krawędzią widocznego okna) i gaśnie w pierwszych 30% animacji. Cień przypięty do pierwotnego prostokąta panelu zostawiał jasny pas zdjęcia tam, gdzie kadr zdążył z niego wyjść. Kolejność: **najpierw gasną opcje** (`data-case-fade=".pj__inner"`, 0,4 s), a dopiero potem zdjęcie się powiększa (1,2 s). Stały „push" +12% w połowie animacji (`CASE_MIDPOINT_PUSH`) jest przeznaczony dla małej karty, więc jego wielkość skaluje się z tym, ile zdjęcie ma urosnąć (z dużego panelu prawie wcale), inaczej zdjęcie puchło i kurczyło się z powrotem. Prostokąt bierze z ukrytego `.pj__thumb` (`position: fixed; inset: 0`). Dlatego wiersze listy nie mogą mieć `transform` ani `filter` (zepsułyby `fixed`).

### Pułapki tej strony
- **Dwa mechanizmy na jednym ekranie to dwa machnięcia.** Nagłówek z własną animacją (`sideRays`) plus osobna scena dawały „dwa razy przeciągnij palcem" i skok. Pierwszy ekran musi być krokiem tej samej sceny. Gdy strefa zaczyna się na samej górze strony, `anchoredTop` zapobiega zwolnieniu sceny przy kroku wstecz (nad nim nie ma czego przewijać, a linia ponownego przejęcia leży już nad stroną).
- **`inset: auto` po `top: 0` zeruje `top`** i scena przestaje się przypinać (czarny pas u dołu ekranu). Kolejność: `inset: auto; top: 0;`.
- **`ScrollTrigger.create` woła `onRefresh` jeszcze w trakcie tworzenia**, więc funkcja, którą woła (`setFrom`), musi już istnieć. Jest zadeklarowana jako `function` przed `create` (zwykłe `const` dałoby „Cannot access before initialization").
- **Dół sceny musi schodzić dokładnie do koloru strony** (`--c-bg`, nie do czystej czerni z przezroczystością), inaczej nad sekcją CTA zostaje twarda krawędź zdjęcia.
- **Nie blurować tekstu na zdjęciu, które się zmienia** (drogie na telefonie): wiersze zmieniają tylko opacity i przesunięcie.

## Pułapki (nie wracać do tego)

- **Przejazdów strony nie robić `lenis.scrollTo`.** Inercja palca go nadpisuje (patrz wyżej).
- **Nie włączać i wyłączać Lenisa w jednej klatce** przy oddaniu strony: osobna klatka pracy i zawieszenie na starcie wyjścia. Flaga `weStopped` mówi, kto zatrzymał Lenisa, i tylko ten go uruchamia.
- **Nie bramkować wejścia na `pt-intro-done`** (4 s martwego dotyku po powrocie z innej strony).
- **Ruch światła ma dwa mapowania:** scroll podaje „przebyty dystans" (najpierw ciemność `DARK`, potem światło), scena podaje pozycję światła wprost w jednostkach zdjęć. Pomylenie ich przesuwa światło o `DARK = 0,06` obok zdjęcia.
- **Gest wprowadzający scenę od dołu nie może iść dalej jako krok** (przy długim machnięciu cofał o jedno zdjęcie za dużo).
- **`touch-action` jest ustawiane inline** (`html`, `body`), bo reguła w CSS nie zawsze dochodziła do strony.
- **`pt-restoring`** (przywracanie scrolla po cofnięciu): scena wtedy nie przejmuje strony przy przekroczeniu linii.

## Strojenie (gdzie co zmienić)

| Chcę | Zmień |
|---|---|
| wolniejszy / szybszy krok hero ↔ manifest | `CFG.tempo` w `introStage.ts` |
| mocniejsze / słabsze nakładanie kroków | `CFG.overlap` |
| czas wypełniania manifestu | `CFG.fillTime` |
| czas kroku między zdjęciami | `stepBaseMs`, `stepPerUnitMs` w `workStage.ts` |
| czułość gestu (krok po mniejszym ruchu) | `commitDist`, `commitSpeed` |
| jak daleko jedzie strona po wyjściu | `leaveBelow`, `leaveAbove`, `leaveMs` |
| czas wejścia tytułu / próg | `titleMs` (950 / 450) i `0.12` / `0.02` w `SelectedWorkSection.astro` |

## Jak testować

Test w emulacji (Playwright, Chromium z dotykiem przez CDP) obejmował: całą ścieżkę w dół i z powrotem (hero → manifest → Services → tytuł → 3 zdjęcia → panel → dół strony → hero), szybkie flicki, dwa gesty 120 ms po sobie, tap w trakcie przejazdu, menu otwarte nad sceną, rotację do poziomu, skok kotwicą z góry i z dołu, tap w link, powrót historią z innej strony, kółko myszy na iPadzie, reduced motion i desktop. Urządzenia: iPhone 13, iPhone SE, Pixel 7, iPad Mini.

Emulacja nie pokazuje prawdziwej bezwładności palca ani płynności na słabszym telefonie, więc przy zmianach sprawdzaj to jeszcze na prawdziwym iPhonie (Safari) i Androidzie (Chrome): powrót ze Services do manifestu, wyjście z ostatniego zdjęcia i powrót z panelu.
