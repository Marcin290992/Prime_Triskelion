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

**Układ.** Pod nagłówkiem „My Projects." jest wysoka strefa z przypiętą (sticky) sceną: pełnoekranowe zdjęcie (WebGL, ta sama wiązka co na stronie głównej) i warstwa tekstu nad nim. Tekst aktywnego projektu (numer `01 / 03`, nazwa, kategorie, rok, „View project ↗") wchodzi na zegarze, reszta wychodzi. Tap w nazwę otwiera case study. Na desktopie to lista nazw po lewej i zdjęcie w tle, a projekt wybiera hover (osobny kod, bez sceny).

**Jak scena jest podpięta.** Krok 0 sceny to **pierwszy projekt** (a nie tytuł jak w Selected work), więc scena jest tworzona dla `projektów − 1` kroków, a światło dostaje `1 + p`. Wejście od góry: scena przejmuje stronę, gdy strefa się zapnie (`LEAD 0.14`). Wyjście w dół (po ostatnim projekcie) jedzie do sekcji CTA, w górę (z pierwszego) do nagłówka. Powrót z dołu: jedno machnięcie w dół wraca na ostatni projekt (asysta z `workStage.ts`).

**Scena działa w każdym wąskim układzie** (`max-width: 1024px` lub dotyk), także z myszką: kółko i klawisze (strzałki, PageUp/PageDown, spacja) krokują projekty, a powrót od dołu łapie ostatni projekt. Bez tego wąskie okno z myszką dostawało zwykły scrub i kółko przelatywało po projektach, a w górę wchodziło się prosto do nagłówka.

**Poza rękami sceny** (nad strefą, pod nią) scroll podaje światło: nad strefą pierwszy projekt, pod nią ostatni. Bez sceny (okno desktopowe z myszką, reduced motion) scroll steruje światłem w sposób ciągły, a zdjęcia przenikają się.

**Nagłówek ma własną drogę wejścia i powrotu** (`data-rays-pin`, `sideRays.js`): pierwszy scroll w dół odgrywa na zegarze animację (światło gaśnie, blur, zasłona, lądowanie sekcji; strona skacze o wysokość nagłówka pod czarną zasłoną), a przewijanie w górę z góry sekcji odgrywa to samo wstecz. Scena nie może z tym walczyć:
- **Wejście:** nagłówek ląduje sekcję, a pierwsze przesunięcie w dół przekracza linię sceny i ta przejmuje stronę na projekcie 1.
- **Wyjście w górę z projektu 1:** scena nie zjeżdża stroną w górę. Nagłówek w każdej klatce dociągał ją z powrotem do sekcji, a na końcu skakał do 0, stąd normalny scroll do hero i skok. Scena **oddaje wyjście nagłówkowi**: `leaveUp` w `createWorkStage` woła `window.__ptPinHeader.goUp(done)` (wystawione przez `sideRays.js`). Strona stoi, zasłona ciemnieje, jedyny skok (do 0) dzieje się pod całkowicie czarną zasłoną, światło wraca. Gdy nagłówek jest zajęty albo go nie ma (reduced motion), scena robi zwykły przejazd.

**Przejście do case study na desktopie** (zdjęcie rozrasta się na cały ekran) bierze prostokąt z ukrytego `.pj__thumb` (`position: fixed; inset: 0`). Dlatego wiersze listy nie mogą mieć `transform` ani `filter` (zepsułyby `fixed`).

### Pułapki tej strony
- **Nie przesuwać strony, gdy nagłówek (`data-rays-pin`) ma ją w rękach.** Jego `onScroll` dociąga stronę do sekcji lub do 0, gdy jest gdzieś pomiędzy, więc każdy przejazd z zewnątrz w tamtą stronę kończy się walką i skokiem. Wyjście w górę przechodzi przez `__ptPinHeader.goUp`.
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
