# Dark sweep page transition (snippet — not part of the site)

One dark bar sweeps across the screen on every navigation (right to left when
going back). It replaces the fade/blur transition and the case-study expand.

It is **not** in `src/` and is not built, bundled or type-checked. The live
site uses the blur-in transition in `src/utils/pageTransitions.ts`.

## Files

- `pageTransitions.dark-sweep.ts.txt` — the whole `src/utils/pageTransitions.ts`
  as it was with the sweep (commit `e9ebee9`). Includes the "card photo grows,
  then the sweep" case-study step.
- `oxygenMenu.dark-sweep.patch` — the matching changes to
  `src/utils/oxygenMenu.ts` (the sweep also covers the open menu).

## Try it

```sh
cp snippets/dark-sweep/pageTransitions.dark-sweep.ts.txt src/utils/pageTransitions.ts
git apply snippets/dark-sweep/oxygenMenu.dark-sweep.patch   # may need small fixes
```

Undo with `git checkout -- src/utils/pageTransitions.ts src/utils/oxygenMenu.ts`.

## History

`5939917` (the sweep), `47fc76d`, `09d5e07`, `e8fd3de` (menu, phones, speed),
`e9ebee9` (card photo grows first). Merged to `main` in `e9e305b`, reverted in
`0fca6d9`.
