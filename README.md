# Philip's Energy — Solar Calculator

Static solar system sizing page for Philip's Energy. Open `index.html` in a browser, or use the published site:

https://philipebhomielen-gif.github.io/philipsenergy/

No build step. The site is plain HTML, CSS, and JavaScript.

## What you enter

- **Total load (watts)** — the combined wattage of the appliances to run
- **Hours of use (daily)** — how long that load runs on a typical day
- **System voltage** — 12V, 24V, or 48V

Load and hours must be numbers greater than zero. The page shows an inline message if they are missing or not positive, and it does not display a result until both are valid.

## What it estimates

The calculator keeps a simple sizing method:

1. **Daily energy** — load × hours, shown in watt-hours and kilowatt-hours.
2. **Battery size** — 1.5 × daily energy, shown in kWh and in amp-hours at the selected voltage (`battery Wh ÷ voltage`, rounded up to the next amp-hour).
3. **Inverter** — 1.3 × load, plus 400W for surge. That figure is matched to a tier:
   - up to 2,000W → 2kVA
   - up to 3,000W → 3kVA
   - up to 5,000W → 5kVA
   - above that → Above 5kVA
4. **Solar panels** — `(daily Wh ÷ 5 peak sun hours) × 1.3`, divided by 550W modules, rounded up.

These figures are a planning estimate, not a final installation design.

## What Philip's Energy does

Philip's Energy sells and supplies solar panels and solar equipment for installation, including inverters, batteries, and accessories. We deliver across FCT, Abuja.

## Contact

- WhatsApp: [0903 243 5448](https://wa.me/2349032435448)
- Call: [0803 836 8456](tel:+2348038368456)

The WhatsApp button opens a chat that starts with “Hi Philip's Energy, I used your solar calculator”. After a calculation, **Get a quote on WhatsApp** opens a chat that includes the estimate.

## Publish

GitHub Pages serves this repository from the `main` branch root. `.nojekyll` is present so Pages does not run Jekyll.
