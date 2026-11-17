# Headline feedback

Exports from `/headlines/review/` belong in this directory as JSON. The next run of `node scripts/headlines/populate.mjs` reads every `*.json` file here.

The newest file, by `exported_at`, wins for each item `id`. `dropped` removes that item. `up`, `down`, `bigger`, and `smaller` shift the score by the deltas in `scripts/headlines/ranking.mjs`. Notes and `overall_notes` are not parsed; edit the ranking file from them by hand.

A file with `"sample": true` is ignored, so an example cannot change scores.

```json
{
  "schema": "biocat-headlines-feedback/1",
  "exported_at": "2026-11-17T12:00:00.000Z",
  "headlines_generated_at": "2026-11-17T00:00:00.000Z",
  "sample": false,
  "overall_notes": "",
  "items": [
    { "id": "ema:example", "vote": "up", "size": "bigger", "note": "" }
  ]
}
```

`vote` is `up`, `down`, or null. `size` is `bigger`, `smaller`, `dropped`, or null.
