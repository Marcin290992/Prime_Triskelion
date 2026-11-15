# Workflow: Lenis i scroll (jak to działa, żeby działało idealnie)

Zapis tego, jak użyty jest **Lenis** w tym projekcie, żeby scroll, przypięcia i poziomy pasek działały płynnie wszędzie, także na iPhonie (Safari). Wersja działająca: Lenis `^1.3.18` + GSAP/ScrollTrigger. Szczegóły błędów i dlaczego tak: `BUGS.md`.

## Zasada w jednym zdaniu

**Scrollem steruje Lenis, a Lenis i animacje GSAP chodzą na tym samym zegarze (`gsap.ticker`).** Dzięki temu pozycja strony i przesuw animacji (np. poziomego paska) liczą się w tej samej klatce i nie mogą się rozjechać. Na dotyku (telefon, tablet) to jest włączone **na każdej stronie**, z tą samą konfiguracją.

## Gdzie co jest

| Co | Plik |
|---|---|
| Wspólne opcje Lenisa na dotyku | `src/utils/touchLenis.ts` (`TOUCH_LENIS_OPTIONS`) |
| Lenis na Home (dotyk i desktop) | `src/pages/index.astro`, funkcja `initLenis` |
| Lenis na Winds of Sinai | `src/pages/projects/[slug].astro` (sekcja "1. Lenis musi być przed ScrollTrigger") |
| Lenis na wszystkich pozostałych stronach (About, Projects, Services, Contact, 404) | `src/layouts/Layout.astro`, funkcja `initLayoutLenis` (fallback) |
| Zegar GSAP: `lagSmoothing(0)` | `src/utils/pageEntrances.ts`, funkcja `syncTickerToScroll()` |
| Blokada scrolla przy menu | `src/utils/oxygenMenu.ts`, `lockBodyScroll` / `unlockBodyScroll` |
| Blokada scrolla w intro hero | `src/components/sections/HeroSection.astro` (overlay z logo) |

Lenis jest trzymany w `window.__lenis` (do `stop()` / `start()` / `scrollTo()` z innych miejsc). Flaga `window.__lenisHandled = true` mówi Layoutowi, że strona sama wybrała swojego Lenisa, żeby fallback nie dołożył drugiego.

## Konfiguracja

**Dotyk** (`pointer: coarse`, czyli telefon i tablet), wspólna dla wszystkich stron:

```ts
// src/utils/touchLenis.ts
export const TOUCH_LENIS_OPTIONS = {
  autoRaf: false,            // raf woła zegar GSAP, nie Lenis sam
  syncTouch: true,           // Lenis steruje też dotykiem
  syncTouchLerp: 0.075,
  touchInertiaExponent: 1.7,
  touchMultiplier: 1,
} as const;
```

**Desktop** (mysz, trackpad): osobna konfiguracja, bez zmian od początku:

```ts
{
  lerp: window.matchMedia('(max-width: 1024px)').matches ? 0.16 : 0.06,
  smoothWheel: true,
  wheelMultiplier: window.matchMedia('(max-width: 1024px)').matches ? 0.8 : 0.3,
}
```

## Cykl życia (każda strona)

```ts
// astro:page-load  → utwórz
const isTouch = window.matchMedia('(pointer: coarse)').matches;
const lenis = new Lenis(isTouch ? { ...TOUCH_LENIS_OPTIONS } : { /* desktop */ });
window.__lenis = lenis;
window.__lenisHandled = true;                 // tylko na stronach z własnym Lenisem (Home, Winds of Sinai)
const raf = (time: number) => lenis.raf(time * 1000); // GSAP daje sekundy, Lenis chce ms
gsap.ticker.add(raf);
syncTickerToScroll();                         // gsap.ticker.lagSmoothing(0)
lenis.on('scroll', ScrollTrigger.update);     // ScrollTrigger zna pozycję Lenisa

// astro:before-swap → posprzątaj (inaczej Lenis się dubluje po nawigacji)
gsap.ticker.remove(raf);
lenis.destroy();
window.__lenis = null;
window.__lenisHandled = false;                // Layout czyści tę flagę na każdej nawigacji
```

Kolejność ma znaczenie: Lenis i `lenis.on('scroll', ScrollTrigger.update)` **przed** tworzeniem animacji ScrollTrigger. Po utworzeniu: `requestAnimationFrame(() => ScrollTrigger.refresh())`.

## Poziomy pasek (Selected Work na mobile) a Lenis

Konstrukcja w `src/components/sections/SelectedWorkSection.astro` (klasy `.sw-mob*`):

- wysoki wrapper o wysokości liczonej z pomiarów, w nim element `position: sticky; top: 0`,
- **jedna** animacja `gsap.to(track, { x: -dystans, ease: 'none', scrollTrigger: { trigger, start, end: '+=' + dystans, scrub: true, invalidateOnRefresh: true } })`,
- bez `pin`, bez snapu, bez `normalizeScroll`, bez animacji CSS sterowanych scrollem,
- wysokości w stałej jednostce ekranu `--app-stable-vh` (mierzonej raz w Layout), nie w `100vh` ani w `innerHeight` na żywo.

Na dotyku to **działa dlatego, że scrolla robi Lenis** (patrz wyżej). Bez Lenisa na dotyku ta sama konstrukcja szarpie na iPhonie.

## Reguły (żeby było tak jak teraz)

1. Na dotyku **zawsze** Lenis z `TOUCH_LENIS_OPTIONS`, na każdej stronie, także w Safari. Nie wyłączać go "dla natywnego scrolla".
2. Lenis zawsze na zegarze GSAP (`gsap.ticker.add`), z `autoRaf: false`, plus `lagSmoothing(0)` i `lenis.on('scroll', ScrollTrigger.update)`.
3. `ScrollTrigger.config({ ignoreMobileResize: true })` na stronach z przypięciami (pasek adresu zmienia wysokość okna w trakcie gestu).
4. Nie dodawać snapu (`ScrollTrigger` `snap`) ani `ScrollTrigger.normalizeScroll(...)` na dotyku. Przesuwają stronę w trakcie rozpędu i dają szarpnięcia.
5. Przypięcia liczyć ze stałej wysokości ekranu (`--app-stable-vh`), nie z `100vh` i nie z `innerHeight` na żywo.
6. Przodek elementu `position: sticky` nie może mieć `overflow: hidden` (Safari wyłącza wtedy sticky). Sam element sticky może.
7. Każdy overlay, który ma blokować scroll, wywołuje `lenis.stop()` i potem `lenis.start()` (menu: `lockBodyScroll`, intro hero). Bez tego dotyk przewija stronę pod spodem.
8. Elementy z własnym przewijaniem wewnątrz strony dostają `data-lenis-prevent`.
9. Po nawigacji astro (`astro:before-swap`) zawsze `destroy()` Lenisa i zdjęcie callbacku z tickera.
10. Skok na górę po nawigacji przez Lenisa: `lenis.scrollTo(0, { immediate: true })` (jak w `contact.astro`), a nie `window.scrollTo`, gdy Lenis działa.

## Nowa strona: lista kontrolna

- [ ] Strona używa `Layout.astro`: dostaje Lenisa z fallbacku (dotyk i desktop), nic dopisywać nie trzeba.
- [ ] Ma przypięcia/ScrollTrigger: dodaj `ScrollTrigger.config({ ignoreMobileResize: true })` i licz wysokości z `--app-stable-vh`.
- [ ] Chcesz własnego Lenisa (jak Home i Winds of Sinai): skopiuj cykl życia z góry, ustaw `__lenisHandled = true`, na dotyku użyj `TOUCH_LENIS_OPTIONS`.
- [ ] Nowy overlay blokujący scroll: `lenis.stop()` / `lenis.start()`.
- [ ] Pasek poziomy: konstrukcja wrapper + sticky + jedna animacja `scrub: true` (patrz wyżej).
- [ ] Test na **prawdziwym iPhonie**: szarpnięcia po puszczeniu palca (rozpęd), pasek adresu, skoki przy cofaniu scrolla.

## Testowanie

- Emulacja (Playwright/Chrome DevTools) sprawdza logikę, ale **nie pokaże** szarpnięć z rozpędem ani zachowania paska adresu Safari. To trzeba zobaczyć na iPhonie.
- Dotyk w testach automatycznych: zdarzenia `Input.dispatchTouchEvent` (start, ruchy, koniec) przez CDP. Gest `Input.synthesizeScrollGesture` omija zdarzenia dotyku, których słucha Lenis, i nie przewinie strony.
- Szybka kontrola, że Lenis działa: w konsoli `!!window.__lenis` powinno dać `true`, a po `lenis.destroy()` w nawigacji nie może zostać drugi.

## Gdyby coś zaczęło szarpać na iPhonie

1. Sprawdź, czy `window.__lenis` istnieje na tej stronie (czy strona nie ustawia `__lenis = null` na dotyku).
2. Sprawdź, czy nie wrócił snap albo `normalizeScroll`.
3. Sprawdź, czy wysokości nie wróciły do `100vh` / `innerHeight`.
4. Sprawdź, czy przodek elementu sticky nie dostał `overflow: hidden`.
5. Sprawdź, czy nie ma drugiego Lenisa (po nawigacji bez `destroy()`).
