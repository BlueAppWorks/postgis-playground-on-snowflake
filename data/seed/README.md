# Offline sample region

`sample.json` holds the sample region: its name and anchor point, a few places, and an OpenStreetMap
extract (points of interest, parks, and the walkable street network) around them. The app loads it with
**Quick start** or **Use the … sample instead** (Lesson 2), so every lesson works without calling external APIs.

It is generated from [`config/region.json`](../../config/region.json):

```bash
npm run seed:build                                        # config/region.json
npm run seed:build -- config/examples/tokyo-marunouchi.json
```

The default region is Menlo Park, California. To switch to your own city, see the
`postgis-playground-region` skill (`.snowflake/cortex/skills/`) or the README.

Data © OpenStreetMap contributors, available under the Open Database License (ODbL 1.0):
https://www.openstreetmap.org/copyright
