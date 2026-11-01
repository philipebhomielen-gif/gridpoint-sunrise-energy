# Philip's Energy — Solar Calculator

Static solar system sizing page for Philip's Energy. Open `index.html` in a browser, or use the published site:

https://philipebhomielen-gif.github.io/philipsenergy/

No build step. The site is plain HTML, CSS, and JavaScript.

## What you enter

- **Total load (watts)** — the combined wattage of the appliances to run, from just above 0 to 50,000
- **Hours of use (daily)** — more than 0 and at most 24
- **System voltage** — Auto, or 12V, 24V, 48V. 96V is available only above 8 kW.
- **Battery type** — Lithium (LiFePO4) or tubular lead-acid
- **Advanced** — battery module (or Auto), inverter size (or Auto), panel wattage (default 550W), peak sun hours (default 5 for Abuja), and autonomy days (default 1)

Auto voltage is 12V up to 1.5 kW, 24V up to 3.5 kW, then 48V. It steps up if that voltage has no standard inverter large enough. Empty, zero, negative, non-numeric, and out-of-range values show an inline message. A module that cannot be series-connected to the system voltage is rejected.

## What it estimates

The math lives in `calc.js` (`calcSolar`). Efficiency is 0.85, array derate is 0.75, and power factor is 0.8:

1. **Daily energy** — `loadWh = watts × hours`. Energy to supply is `dailyWh = loadWh / 0.85`.
2. **Battery** — `batteryWh = dailyWh × autonomy / DoD`, with DoD 0.8 for LiFePO4 and 0.5 for tubular lead-acid. Amp-hours are rounded up at the system voltage. Auto chooses a catalog module that meets this with the fewest units, then the least spare watt-hours, and shows two alternatives. Tubular modules are 12V (100, 150, 200, 220, 250Ah) or 2V cells. Lithium modules are 12.8V, 25.6V, and 51.2V, plus 48V 5kWh and 10kWh racks. Series count is exact: the module’s nominal voltage has to divide the system voltage.
3. **Inverter** — continuous need is `watts × 1.25`, matched to 1, 1.5, 2, 2.5, 3, 3.5, 4.2, 5, 6.2, 7.5, 8, 10, 12, or 15 kVA (`kVA × 800 W`). Up to 2 kVA is 12V, up to 4.2 kVA is 24V, and 5 kVA and above are 48V. 10–15 kVA may also be 96V. A chosen size that does not match is flagged. Above 15 kVA the result is “Contact us for a custom design”.
4. **Panels** — `arrayW = dailyWh / (peak sun hours × 0.75)`, using 300–650W modules (default 550W), then completed into equal series/parallel strings.
5. **Charge controller** — installed array watts ÷ voltage × 1.25, matched to 30, 40, 60, 80, 100, or 120A. Larger arrays use more than one controller, or the inverter’s built-in MPPT.

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
