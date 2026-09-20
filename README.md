# Prime Triskelion

Landing page agencji zbudowany w Astro, z naciskiem na motion, preloader i nowoczesny układ sekcji.

## Uruchomienie lokalne

```sh
npm install
npm run dev
```

Aplikacja jest dostepna pod `http://localhost:4321`.

## Build produkcyjny

```sh
npm run build
npm run preview
```

## Struktura projektu

```text
src/
	components/
		NanoGrid.astro
		Navbar.astro
		OxygenMenu.astro
		Preloader.astro
	layouts/
		Layout.astro
	pages/
		index.astro
		test.astro
	styles/
		global.css
		tailwind.css
public/
	fonts/
```

## Przydatne komendy

- `npm run dev` - uruchamia lokalny serwer developerski
- `npm run build` - buduje statyczna wersje produkcyjna
- `npm run preview` - uruchamia podglad buildu
