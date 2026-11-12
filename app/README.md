# HomeView for iPad Air 2

A HomeView-style home hub for a jailbroken iPad Air 2 (iPadOS 15, TrollStore). Everything runs on the iPad; it talks to Home Assistant directly.

## Layout

- `web/` — the app: `js/glass.js` (WebGL wallpaper + liquid glass, after FrontRow's `frontrow-gpu-scene.c`), `js/ha.js` (HA WebSocket client), `js/app.js` (frame loop, springs, pager, pages), `js/icons.js` (from homeview-g4, MIT; icon sets MIT/ISC).
- `native/` — the Swift shell: full-screen WKWebView, injects `Documents/config.json` as `window.HV_CONFIG`, logs to `Documents/log.jsonl`.
- `config.json` — copy from `config.example.json`: Home tiles, wallpaper, render scale, night dimming. No token: `tools/deploy.sh config` adds it from `~/.config/homeview/ha_token`.

## Rendering

WebGL draws the wallpaper and all glass at 1.25x (one quarter-size blur shared by every tile); the DOM above it holds text and icons at native resolution. One `requestAnimationFrame` loop moves both. Idle: only the wallpaper, at 20 fps.

## Develop

```sh
cp config.example.json config.json
export IPAD=mobile@<iPad IP>
python3 tools/dev-server.py        # http://127.0.0.1:8780/ with live HA data
sh build.sh                        # dist/HomeView.tipa
tools/deploy.sh tipa               # to 文件 → 我的 iPad (needs FILES, see the script), install with TrollStore
tools/deploy.sh web                # push web/ only; the app reloads within 3 s
tools/deploy.sh config             # config + token into the app's Documents
tools/deploy.sh log 50
```

## Credits

Layouts and weather icons after [homeview-g4](https://github.com/Jesser722000/homeview-g4) (MIT, see `LICENSE-homeview-g4.txt` and `THIRD_PARTY_NOTICES-homeview-g4.md`).
