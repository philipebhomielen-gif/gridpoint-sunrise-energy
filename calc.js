/* Off-grid sizing for Philip's Energy.
 *
 * loadWh        = watts × hours
 * dailyWh       = loadWh / 0.85
 *                   inverter/system efficiency, so the DC side covers AC use
 * batteryWh     = dailyWh × autonomyDays / DoD
 *                   = loadWh × autonomyDays / (DoD × 0.85)
 *                   DoD is 0.8 for LiFePO4 and 0.5 for lead-acid/tubular
 * batteryAh     = ceil(batteryWh / systemVoltage)
 *                   then built from 12V 100/150/200Ah units in series/parallel
 * inverter      = smallest standard kVA whose continuous watts
 *                   (kVA × 1000 × 0.8 power factor) cover watts × 1.25
 *                   surge headroom is 2× that continuous rating
 *                   above 10 kVA: contact us for a custom design
 * arrayW        = dailyWh / (peakSunHours × 0.75)
 * panels        = ceil(arrayW / 550)
 * controllerA   = ceil(installedArrayW / systemVoltage × 1.25)
 *
 * Autonomy enlarges the battery only. The array replaces one day of use.
 * A 12V choice above 1.5 kW, or a 24V choice above 3 kW, is flagged.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.SolarCalc = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var EFFICIENCY = 0.85;
  var PANEL_DERATE = 0.75;
  var PANEL_W = 550;
  var POWER_FACTOR = 0.8;
  var INVERTER_SAFETY = 1.25;
  var SURGE_FACTOR = 2;
  var CONTROLLER_MARGIN = 1.25;
  var DOD = { lithium: 0.8, lead: 0.5 };
  var INVERTER_KVA = [1, 1.5, 2.5, 3.5, 5, 7.5, 10];
  var MODULE_AH = [100, 150, 200];
  var MODULE_V = 12;
  var DEFAULT_PSH = 5;
  var DEFAULT_AUTONOMY = 1;
  var MAX_LOAD_W = 50000;
  var MAX_HOURS = 24;
  var VOLTAGES = [12, 24, 48];
  var CUSTOM_LABEL = "Contact us for a custom design";

  var ASSUMPTIONS = "Estimate only, not a final installation design. Energy to supply is load watt-hours divided by 85% inverter/system efficiency. Battery watt-hours are that figure times autonomy days, divided by depth of discharge (80% LiFePO4, 50% lead-acid). The suggested bank uses 12V 100, 150, or 200Ah batteries in series and parallel. The inverter is continuous load times 1.25, matched to a standard size at 0.8 power factor (1 to 10 kVA), with surge headroom of twice the continuous rating. The array is energy to supply divided by peak sun hours times a 0.75 derate, using 550W modules. Charge-controller amps are installed array watts divided by system voltage, times 1.25. Peak sun hours default to 5 for Abuja. Loads above 1.5 kW suit 24V or 48V, and loads above 3 kW suit 48V.";

  function parseNumber(value) {
    if (value === null || value === undefined) return { kind: "empty" };
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return { kind: "invalid" };
      return { kind: "ok", value: value };
    }
    var raw = String(value).trim();
    if (raw === "") return { kind: "empty" };
    if (!/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(raw)) return { kind: "invalid" };
    var n = Number(raw);
    if (!Number.isFinite(n)) return { kind: "invalid" };
    return { kind: "ok", value: n };
  }

  function batteryLabel(type) {
    return type === "lead" ? "Lead-acid / tubular" : "Lithium (LiFePO4)";
  }

  function describeBank(series, parallel, unitAh, voltage, bankAh) {
    var count = series * parallel;
    var unit = "12V " + unitAh + "Ah";
    if (series === 1 && parallel === 1) {
      return "1 × " + unit + " (" + bankAh + "Ah bank)";
    }
    if (series === 1) {
      return count + " × " + unit + " in parallel (" + bankAh + "Ah bank)";
    }
    if (parallel === 1) {
      return count + " × " + unit + " in series (" + voltage + "V, " + bankAh + "Ah bank)";
    }
    return count + " × " + unit + " (" + series + " in series × " + parallel + " parallel, " + bankAh + "Ah bank)";
  }

  function batteryBank(requiredAh, voltage) {
    var series = voltage / MODULE_V;
    var unitAh = MODULE_AH[MODULE_AH.length - 1];
    var parallel = 1;
    var i;
    for (i = 0; i < MODULE_AH.length; i++) {
      if (MODULE_AH[i] >= requiredAh) {
        unitAh = MODULE_AH[i];
        parallel = 1;
        break;
      }
    }
    if (unitAh < requiredAh) {
      unitAh = 200;
      parallel = Math.ceil(requiredAh / unitAh);
    }
    var bankAh = unitAh * parallel;
    return {
      unitVoltage: MODULE_V,
      unitAh: unitAh,
      series: series,
      parallel: parallel,
      count: series * parallel,
      bankAh: bankAh,
      bankWh: bankAh * voltage,
      config: describeBank(series, parallel, unitAh, voltage, bankAh)
    };
  }

  function voltageAdvice(loadW, voltage) {
    var recommended = null;
    var limit = "";
    if (voltage === 12 && loadW > 1500) {
      recommended = loadW > 3000 ? 48 : 24;
      limit = "1.5 kW";
    } else if (voltage === 24 && loadW > 3000) {
      recommended = 48;
      limit = "3 kW";
    }
    if (!recommended) return null;
    return {
      recommended: recommended,
      message: "A " + voltage + "V system is small for a load above " + limit + ". " + recommended + "V is a better fit."
    };
  }

  function inverterFor(loadW) {
    var requiredW = loadW * INVERTER_SAFETY;
    var requiredKva = requiredW / (POWER_FACTOR * 1000);
    if (!(requiredKva <= INVERTER_KVA[INVERTER_KVA.length - 1])) {
      return {
        custom: true,
        kva: null,
        label: CUSTOM_LABEL,
        requiredW: requiredW,
        requiredKva: requiredKva,
        continuousW: null,
        surgeW: null
      };
    }
    var kva = INVERTER_KVA[INVERTER_KVA.length - 1];
    var i;
    for (i = 0; i < INVERTER_KVA.length; i++) {
      if (INVERTER_KVA[i] + 1e-9 >= requiredKva) {
        kva = INVERTER_KVA[i];
        break;
      }
    }
    var continuousW = kva * 1000 * POWER_FACTOR;
    return {
      custom: false,
      kva: kva,
      label: kva + " kVA",
      requiredW: requiredW,
      requiredKva: requiredKva,
      continuousW: continuousW,
      surgeW: continuousW * SURGE_FACTOR
    };
  }

  function formatGrouped(n) {
    var rounded = Math.round(n);
    var sign = rounded < 0 ? "-" : "";
    var digits = String(Math.abs(rounded));
    return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function calcSolar(input) {
    input = input || {};
    var errors = {};
    var load = parseNumber(input.load);
    var hours = parseNumber(input.hours);
    var voltage = parseNumber(input.voltage);
    var pshGiven = input.peakSunHours === undefined || input.peakSunHours === null;
    var autoGiven = input.autonomyDays === undefined || input.autonomyDays === null;
    var psh = pshGiven ? { kind: "ok", value: DEFAULT_PSH } : parseNumber(input.peakSunHours);
    var autonomy = autoGiven ? { kind: "ok", value: DEFAULT_AUTONOMY } : parseNumber(input.autonomyDays);
    var batteryType = input.batteryType === undefined || input.batteryType === null || input.batteryType === ""
      ? "lithium"
      : String(input.batteryType);

    if (load.kind === "empty") errors.load = "Enter the total load in watts.";
    else if (load.kind === "invalid" || load.value <= 0) errors.load = "Load must be a number greater than 0.";
    else if (load.value > MAX_LOAD_W) errors.load = "Load must be 50,000 W or less.";

    if (hours.kind === "empty") errors.hours = "Enter how many hours you use this load each day.";
    else if (hours.kind === "invalid") errors.hours = "Hours must be a number greater than 0 and no more than 24.";
    else if (hours.value <= 0 || hours.value > MAX_HOURS) errors.hours = "Hours per day must be greater than 0 and no more than 24.";

    if (voltage.kind !== "ok" || VOLTAGES.indexOf(voltage.value) === -1) {
      errors.voltage = "Choose a system voltage of 12V, 24V, or 48V.";
    }

    if (batteryType !== "lithium" && batteryType !== "lead") {
      errors.batteryType = "Choose lithium (LiFePO4) or lead-acid.";
    }

    if (psh.kind !== "ok" || psh.value < 1 || psh.value > 12) {
      errors.peakSunHours = "Peak sun hours must be a number from 1 to 12.";
    }

    if (autonomy.kind !== "ok" || autonomy.value < 1 || autonomy.value > 14) {
      errors.autonomyDays = "Autonomy must be a number from 1 to 14 days.";
    }

    if (Object.keys(errors).length) return { ok: false, errors: errors };

    var loadW = load.value;
    var hoursPerDay = hours.value;
    var systemV = voltage.value;
    var sunHours = psh.value;
    var days = autonomy.value;
    var dod = DOD[batteryType];

    var loadWh = loadW * hoursPerDay;
    var dailyWh = loadWh / EFFICIENCY;
    var batteryWh = dailyWh * days / dod;
    var batteryAh = Math.ceil(batteryWh / systemV);
    var bank = batteryBank(batteryAh, systemV);
    var inverter = inverterFor(loadW);
    var advice = voltageAdvice(loadW, systemV);
    var arrayW = dailyWh / (sunHours * PANEL_DERATE);
    var panelCount = Math.ceil(arrayW / PANEL_W);
    var installedW = panelCount * PANEL_W;
    var controllerA = Math.ceil(installedW / systemV * CONTROLLER_MARGIN);

    var numbers = [
      loadWh, dailyWh, batteryWh, batteryAh, arrayW, panelCount, installedW, controllerA,
      inverter.requiredW, inverter.requiredKva
    ];
    if (inverter.continuousW !== null) numbers.push(inverter.continuousW, inverter.surgeW);
    var n;
    for (n = 0; n < numbers.length; n++) {
      if (typeof numbers[n] !== "number" || !Number.isFinite(numbers[n])) {
        return {
          ok: false,
          errors: { load: "Those values are too large to estimate. Try a smaller load or fewer hours." }
        };
      }
    }

    return {
      ok: true,
      loadW: loadW,
      hours: hoursPerDay,
      voltage: systemV,
      batteryType: batteryType,
      batteryLabel: batteryLabel(batteryType),
      peakSunHours: sunHours,
      autonomyDays: days,
      dod: dod,
      efficiency: EFFICIENCY,
      loadWh: loadWh,
      loadKWh: loadWh / 1000,
      dailyWh: dailyWh,
      battery: {
        wh: batteryWh,
        kwh: batteryWh / 1000,
        ah: batteryAh,
        dod: dod,
        unitVoltage: bank.unitVoltage,
        unitAh: bank.unitAh,
        series: bank.series,
        parallel: bank.parallel,
        count: bank.count,
        bankAh: bank.bankAh,
        bankWh: bank.bankWh,
        config: bank.config
      },
      inverter: inverter,
      voltageAdvice: advice,
      panels: {
        arrayW: arrayW,
        count: panelCount,
        moduleW: PANEL_W,
        installedW: installedW,
        arrayKW: installedW / 1000
      },
      chargeController: { amps: controllerA },
      assumptions: ASSUMPTIONS
    };
  }

  function formatResult(result) {
    var energy = formatGrouped(result.loadWh) + "Wh (" + result.loadKWh.toFixed(2) + " kWh)";
    var supply = formatGrouped(result.dailyWh) + "Wh to supply after 85% efficiency";
    var inverterSub = result.inverter.custom
      ? "Above 10 kVA at 0.8 power factor."
      : formatGrouped(result.inverter.continuousW) + "W continuous, " + formatGrouped(result.inverter.surgeW) + "W surge";
    return {
      energy: energy,
      energySub: supply,
      batteryKwh: result.battery.kwh.toFixed(2) + " kWh",
      batteryAh: result.battery.ah + " Ah (" + result.voltage + "V system)",
      batteryConfig: result.battery.config,
      inverter: result.inverter.label,
      inverterSub: inverterSub,
      panels: result.panels.count + " Panels (550W each)",
      panelsSub: result.panels.arrayKW.toFixed(2) + " kW array",
      controller: result.chargeController.amps + " A",
      advice: result.voltageAdvice ? result.voltageAdvice.message : ""
    };
  }

  function formatQuote(result) {
    var view = formatResult(result);
    var lines = [
      "Hi Philip's Energy, I used your solar calculator.",
      "",
      "Load: " + result.loadW + "W for " + result.hours + " hours/day",
      "System: " + result.voltage + "V, " + result.batteryLabel,
      "Peak sun hours: " + result.peakSunHours + ", Autonomy: " + result.autonomyDays + (result.autonomyDays === 1 ? " day" : " days"),
      "",
      "Daily energy: " + view.energy,
      "Energy to supply: " + formatGrouped(result.dailyWh) + "Wh after 85% inverter efficiency",
      "Battery: " + view.batteryKwh + ", " + view.batteryAh,
      "Suggested battery: " + view.batteryConfig,
      "Inverter: " + view.inverter + " (" + view.inverterSub + ")"
    ];
    if (view.advice) lines.push("Voltage note: " + view.advice);
    lines.push("Solar panels: " + view.panels + ", " + view.panelsSub);
    lines.push("Charge controller: " + view.controller);
    lines.push("");
    lines.push("Please send me a quote.");
    return lines.join("\n");
  }

  return {
    calcSolar: calcSolar,
    formatResult: formatResult,
    formatQuote: formatQuote,
    ASSUMPTIONS: ASSUMPTIONS,
    CONSTANTS: {
      EFFICIENCY: EFFICIENCY,
      PANEL_DERATE: PANEL_DERATE,
      PANEL_W: PANEL_W,
      POWER_FACTOR: POWER_FACTOR,
      INVERTER_SAFETY: INVERTER_SAFETY,
      SURGE_FACTOR: SURGE_FACTOR,
      CONTROLLER_MARGIN: CONTROLLER_MARGIN,
      DOD: DOD,
      INVERTER_KVA: INVERTER_KVA.slice(),
      DEFAULT_PSH: DEFAULT_PSH,
      DEFAULT_AUTONOMY: DEFAULT_AUTONOMY,
      MAX_LOAD_W: MAX_LOAD_W,
      CUSTOM_LABEL: CUSTOM_LABEL
    }
  };
});
