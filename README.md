# Philip's Energy — Solar Calculator

Static solar system sizing page for Philip's Energy. Open `index.html` in a browser, or use the published site:

https://philipebhomielen-gif.github.io/philipsenergy/

No build step. The site is plain HTML, CSS, and JavaScript.

## What you enter

- **Total load (watts)** — the combined wattage of the appliances to run, from just above 0 to 50,000
- **Hours of use (daily)** — more than 0 and at most 24
- **System voltage** — 12V, 24V, or 48V
- **Battery type** — Lithium (LiFePO4), the default, or lead-acid/tubular
- **Peak sun hours** — optional, default 5 for Abuja, from 1 to 12
- **Autonomy days** — optional, default 1, from 1 to 14

Empty, zero, negative, non-numeric, and out-of-range values show an inline message. The page does not show a result until the inputs are valid.

## What it estimates

The math lives in `calc.js` (`calcSolar`). With inverter/system efficiency 0.85, panel derate 0.75, and power factor 0.8:

1. **Daily energy** — `loadWh = watts × hours`. Energy to supply is `dailyWh = loadWh / 0.85`.
2. **Battery** — `batteryWh = dailyWh × autonomy / DoD`, with DoD 0.8 for LiFePO4 and 0.5 for lead-acid. Amp-hours are `ceil(batteryWh / voltage)`. The bank is built from 12V 100, 150, or 200Ah batteries in series (to reach 12/24/48V) and parallel (to reach the amp-hours).
3. **Inverter** — continuous need is `watts × 1.25`. That is matched to 1, 1.5, 2.5, 3.5, 5, 7.5, or 10 kVA, where each size delivers `kVA × 800 W` at 0.8 power factor. Surge headroom is twice the continuous rating. Above 10 kVA the result is “Contact us for a custom design”. A 12V choice above 1.5 kW, or a 24V choice above 3 kW, includes a voltage recommendation.
4. **Panels** — `arrayW = dailyWh / (peak sun hours × 0.75)`, then 550W modules rounded up. Autonomy does not enlarge the array.
5. **Charge controller** — `ceil(installed array watts / voltage × 1.25)`.

These figures are a planning estimate, not a final installation design.

Run the checks with:

```
node test/calc.test.js
```

## What Philip's Energy does

Philip's Energy sells and supplies solar panels and solar equipment for installation, including inverters, batteries, and accessories. We deliver across FCT, Abuja.

## Contact

- WhatsApp: [0903 243 5448](https://wa.me/2349032435448)
- Call: [0803 836 8456](tel:+2348038368456)

The WhatsApp button opens a chat that starts with “Hi Philip's Energy, I used your solar calculator”. After a calculation, **Get a quote on WhatsApp** opens a chat that includes the estimate.

## Publish

GitHub Pages serves this repository from the `main` branch root. `.nojekyll` is present so Pages does not run Jekyll.
