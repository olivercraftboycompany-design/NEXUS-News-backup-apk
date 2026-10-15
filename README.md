# NEXUS News

Installable news app (PWA): top stories, world, tech, science, sports, gaming, Iowa and faith news.

Live: https://olivercraftboycompany-design.github.io/NEXUS-News/

- `.github/workflows/news.yml` fetches the RSS feeds listed in `.github/news/fetch.mjs`, de-duplicates them and publishes `news.json` (plus one file per category) to the `data` branch every ~10 minutes. Each run keeps going for ~50 minutes and then starts the next one; the cron is a backstop.
- The site reads `https://raw.githubusercontent.com/olivercraftboycompany-design/NEXUS-News/data/news.json`, with `data/news.json` in this branch as a starter copy.
- Saved stories and the last news download stay on the phone, so it works offline.
