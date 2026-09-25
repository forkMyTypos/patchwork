# Handwriting recogniser evaluation

Test-only tooling. Nothing in this folder ships in Patchwork, and it needs no network once installed.

It loads the recogniser straight out of `../../index.html` (the `Handwriting recognition core` block), so the numbers
always describe the code that ships. It then measures it with synthetic writers built from Hershey single-stroke fonts:
real stroke order and pen lifts, plus a consistent personal style (slant, width) and natural per-sample variation
(wobble, jitter, sampling speed, the occasional reversed or cut-short stroke).

```sh
npm install
npm run eval
```

It reports:

- **Characters:** top-1 and top-3 accuracy per set, and how accuracy grows with the number of calibration examples.
- **Personal vs someone else's model:** one writer's model tested on another writer's handwriting.
- **Words:** with and without the dictionary, plus time per word.
- **Self-test:** the pairs that adaptive calibration would ask the user to practise.

Synthetic writers are a stand-in for real people: use this to compare changes to the recogniser, not as a promise of
real-world accuracy.
