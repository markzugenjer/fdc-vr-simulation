# FDC Solo VR

The FDC Solo 3D clinic simulation (simulation.fdc.co.id) running in VR on Meta Quest 3.

The original page is kept exactly as published, in `original/index.html`. `npm run build` adds a few small, named edits that switch on WebXR and a lighter Quest profile. Everything VR-specific lives in `public/vr/vr.js`.

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install three.js, the effect libraries and the model tools (once) |
| `npm run fetch` | Download the latest page and 3D assets from simulation.fdc.co.id |
| `npm run build` | Create `public/index.html` (VR version), `public/vendor/` and the Quest models |
| `npm run dev` | Serve it on http://localhost:5174 |
| `npm run quest:connect` | Let a Quest plugged in by USB open `http://localhost:5174` |
| `npm run pages:setup` | Install the GitHub Pages workflow (once) |

## Test

- **On the Mac:** open http://localhost:5174. The page works as before.
  - Add `?quest` to try the light Quest profile.
  - Add `?emulate` to get a fake Quest 3 and a **Masuk VR** button.
  - Add `?fps` to show a frame counter.
- **On the Quest:** run `npm run quest:connect`, then open `http://localhost:5174` in the Quest Browser and press **Masuk VR**.
- **Published:** push to `main`. GitHub Actions builds and publishes https://markzugenjer.github.io/fdc-vr-simulation/

## Quest app (.apk)

The APK is a launcher for the published page. That means two things:
- GitHub Pages must be live before you build.
- After that, new versions only need a `git push`. You don't rebuild the APK.

It shares the signing key of `../vr-games-1`. The Quest checks `markzugenjer.github.io/.well-known/assetlinks.json`, which `vr-games-1` publishes, so this app's package (`id.co.fdc.vrsimulation`) has to be listed there.

```bash
npm run apk:setup                         # adds this app to ../vr-games-1/public/.well-known/assetlinks.json
cd ../vr-games-1 && git add -A && git commit -m "Add FDC Solo VR to assetlinks" && git push && cd -
npm run apk:build                         # → fdc-solo-vr.apk
adb install -r fdc-solo-vr.apk            # App Library → Unknown Sources → FDC Solo VR
```

## VR controls

| Control | Action |
| --- | --- |
| Left stick | Walk where you look (click the stick to run) |
| Right stick | Snap turn 30° |
| Trigger | Press panel buttons and answers |
| A | Open or close the nearest door |
| B / Y | Menu: Jadi pasien, Jalan-jalan bebas, ENCJ speed, day/night, exit VR |
| X | Lihat adegan (jump to the current ENCJ scene) |

The ENCJ step, staff subtitles and the patient-mode answer choices float in front of you. The panel's top-right corner shows `FPS now / target`: green when it holds the target, yellow at 80% or more, red below that.

**Refresh rate:** the app asks the Quest for a steady 90 Hz. Change it in the B/Y menu (72 / 90 / 120 Hz); the choice is remembered. 120 Hz only holds in quiet rooms, so in busy spots it drops and stutters. In VR, people more than 12 m away are not drawn (they keep moving), and the mini-map is hidden.

## Quest performance profile

It turns on automatically in the Quest Browser, or with `?quest` on a computer. The desktop version is unchanged.

| | Desktop | Quest |
| --- | --- | --- |
| Moving room lights | 12 | 4 (brighter ambient light) |
| Sun shadows | 4096 px | off |
| Post-processing | AO, bloom, SMAA, grade | off |
| Mirrors | live reflection | shiny surface |
| Plants and furniture | Poly Haven originals | simplified copies (`public/assets/lite/`) |
| People | 19k triangles each, always drawn | about 8k triangles, drawn only when in view |
| Furniture contact shadows | 129 draw calls | merged into 1 |
| Resolution | up to 2× / VR 100% | 1× / VR 85%, foveated |

Measured on the busiest view (the street entrance looking into the lobby): 877 draw calls and 5.0 M triangles go down to 395 and 0.93 M.

## When the live site changes

Run `npm run fetch`, then `npm run build`.

The build checks that every edit still finds its piece of the original code. If FDC changed one of those pieces, the build stops and names the edit, and that edit needs updating in `scripts/make-vr.mjs`.

## Files

```
original/index.html        the published page (do not edit)
public/assets/             3D models, people and textures from the live site
public/vr/vr.js            VR layer: rig, controllers, floating panels, FPS counter
public/vr/emulator.js      Meta's Quest 3 emulator, loaded only with ?emulate
scripts/fetch-site.mjs     downloader
scripts/make-vr.mjs        VR + Quest edits, local libraries
scripts/lite-models.mjs    simplified Quest models
scripts/serve.mjs          local server
scripts/deploy-pages.yml   GitHub Pages workflow template
```
