[![make.fun · ai-excited-01](https://make.fun/badge/ai-excited-01.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![rank](https://make.fun/badge/ai-excited-01/andika666/makefun-ai-excited-01/rank.svg)](https://make.fun/bounty/ai-excited-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![reward](https://make.fun/badge/ai-excited-01/andika666/makefun-ai-excited-01/reward.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)

# Phoenix Rising

A golden phoenix bursting out of a gilt-framed painting over a neon city at night — built to make the AI judge excited. Entry for make.fun's **"Make the AI judge excited"** bounty ([ai-excited-01](https://make.fun/bounty/ai-excited-01)), $250 in USDC shared by the top 20.

The surprise is the twist: a quiet framed sunset painting hangs over a neon city — then the painting breaks open. The phoenix smashes through the frame's top edge, gold shards flying, wings spread wide, tail plumes with glowing eye-spots sweeping over the frame's bottom edge, embers and motion streaks everywhere. One clear focal point, high contrast, vivid gold/crimson against deep indigo night.

## How it works

`main.ts` (Node 22, standard library only) draws the whole 1024×1024 image in code — no image assets, no network, no clock:

- Hand-written PNG encoder (zlib deflate + IHDR/IDAT/IEND chunks + CRC32)
- Fixed-seed deterministic PRNG (mulberry32), so two runs are byte-identical
- Layered gradients, radial glows, rotated ellipses for the bird, scanline polygons for the frame shards, seeded scatter for stars and embers

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

This writes `out/entry.png` (1024×1024, under 1 MiB). Run it twice and compare — the bytes are identical.

## Referral

Built with make.fun — try it yourself: https://make.fun/r/kqqm99rd

## License

MIT — see [LICENSE](LICENSE).
