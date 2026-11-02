/* Off-grid sizing for GridPoint Sunrise Energy.
 *
 * loadWh     = watts × hours
 * dailyWh    = loadWh / 0.85
 * batteryWh  = dailyWh × autonomy / DoD
 *              DoD 0.8 LiFePO4, 0.5 tubular lead-acid
 * batteryAh  = ceil(batteryWh / systemVoltage)
 * Bank       = a catalog module whose nominal voltage divides the
 *              system voltage. Series is exact. Parallel covers the Ah
 *              (or Wh, for 48V racks). Auto picks fewest units, then
 *              least wasted watt-hours, and keeps two alternatives.
 * Inverter   = smallest standard kVA with continuous watts
 *              (kVA × 1000 × 0.8) at or above watts × 1.25.
 *              Typical DC voltage: ≤2 kVA 12V, ≤4.2 kVA 24V,
 *              ≥5 kVA 48V, and 10–15 kVA also 96V.
 *              Above 15 kVA: contact us for a custom design.
 *              3.5 kVA and larger hybrids include MPPT. If their PV
 *              input covers the array, no separate controller is added.
 * Array      = dailyWh / (peakSunHours × 0.75). Strings are sized for
 *              the MPPT window. Panel Voc is 49.5V at 550W, scaled with
 *              wattage, and checked at 1.1× for cold weather against
 *              a 450–500V hybrid limit (150V or 250V for a separate MPPT).
 * Controller = separate 30–120A MPPT only when the hybrid PV input is
 *              too small. Above 120A, use more than one.
 *
 * Auto voltage starts at 12V and steps up to 24V, 48V, or 96V when the
 * lower voltage would draw more than about 150A from the battery or
 * would need more than one charge controller. Loads of 5 kW and above
 * note parallel inverters and a site survey.
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
  var POWER_FACTOR = 0.8;
  var INVERTER_SAFETY = 1.25;
  var SURGE_FACTOR = 2;
  var CONTROLLER_MARGIN = 1.25;
  var DOD = { lithium: 0.8, tubular: 0.5 };
  var INVERTER_KVA = [1, 1.5, 2, 2.5, 3, 3.5, 4.2, 5, 6.2, 7.5, 8, 10, 12, 15];
  var PANEL_WATTS = [300, 400, 450, 500, 550, 600, 650];
  var MPPT_RATINGS = [30, 40, 60, 80, 100, 120];
  var DEFAULT_PSH = 5;
  var DEFAULT_AUTONOMY = 1;
  var DEFAULT_PANEL_W = 550;
  var MAX_LOAD_W = 50000;
  var MAX_HOURS = 24;
  var VOLTAGES = [12, 24, 48, 96];
  var MAX_BATTERY_AMPS = 150;
  var COLD_VOC_FACTOR = 1.1;
  var LARGE_LOAD_W = 5000;
  var CUSTOM_LABEL = "Contact us for a custom design";
  var HYBRIDS = [
    { kva: 3.5, voltages: [24], pvKw: 5, trackers: 1, chargeA: 100, maxVoc: 500, minVmp: 90 },
    { kva: 5, voltages: [48], pvKw: 6, trackers: 1, chargeA: 100, maxVoc: 500, minVmp: 120 },
    { kva: 6.2, voltages: [48], pvKw: 6.5, trackers: 1, chargeA: 120, maxVoc: 500, minVmp: 120 },
    { kva: 8, voltages: [48], pvKw: 10, trackers: 2, chargeA: 150, maxVoc: 500, minVmp: 120 },
    { kva: 10, voltages: [48, 96], pvKw: 11, trackers: 2, chargeA: 180, maxVoc: 500, minVmp: 120 },
    { kva: 12, voltages: [48, 96], pvKw: 15, trackers: 2, chargeA: 220, maxVoc: 500, minVmp: 120 },
    { kva: 15, voltages: [48, 96], pvKw: 18, trackers: 2, chargeA: 250, maxVoc: 500, minVmp: 120 }
  ];

  var ASSUMPTIONS = "Estimate only, not a final installation design. Energy to supply is load watt-hours divided by 85% inverter efficiency. Battery watt-hours are that figure times autonomy days, divided by depth of discharge (80% LiFePO4, 50% tubular lead-acid). Auto picks the fewest modules with the least spare capacity, and series wiring has to land on the system voltage. Auto voltage steps up from 12V when battery current would pass about 150A or the array would need more than one charge controller. Inverter size is continuous load times 1.25 at 0.8 power factor. Hybrids from 3.5 kVA include MPPT (about 5 kW PV at 3.5 kVA, 6 kW at 5 kVA, 6.5–11 kW at 6.2–10 kVA, and more at 12–15 kVA). Separate MPPTs are used only when the array is larger than that. Panel open-circuit voltage is 49.5V for a 550W module, scaled by wattage, and checked at 1.1× against a 450–500V hybrid limit. Peak sun hours default to 5 for Abuja. At 5 kW and above, parallel inverters are an option and a site survey is recommended.";

  function ahModule(id, chemistry, nominalV, moduleV, ah) {
    return {
      id: id,
      chemistry: chemistry,
      kind: "ah",
      nominalV: nominalV,
      moduleV: moduleV,
      ah: ah,
      wh: null,
      label: (nominalV === 2 ? "2V " + ah + "Ah cell" : moduleV + "V " + ah + "Ah")
    };
  }

  function rackModule(id, wh) {
    var kwh = wh / 1000;
    return {
      id: id,
      chemistry: "lithium",
      kind: "kwh",
      nominalV: 48,
      moduleV: 48,
      ah: null,
      wh: wh,
      label: "48V " + kwh + "kWh rack/wall"
    };
  }

  var MODULES = [
    ahModule("tub-12-100", "tubular", 12, 12, 100),
    ahModule("tub-12-150", "tubular", 12, 12, 150),
    ahModule("tub-12-200", "tubular", 12, 12, 200),
    ahModule("tub-12-220", "tubular", 12, 12, 220),
    ahModule("tub-12-250", "tubular", 12, 12, 250),
    ahModule("tub-2-200", "tubular", 2, 2, 200),
    ahModule("tub-2-400", "tubular", 2, 2, 400),
    ahModule("tub-2-600", "tubular", 2, 2, 600),
    ahModule("tub-2-800", "tubular", 2, 2, 800),
    ahModule("tub-2-1000", "tubular", 2, 2, 1000),
    ahModule("tub-2-1500", "tubular", 2, 2, 1500),
    ahModule("lfp-12.8-100", "lithium", 12, 12.8, 100),
    ahModule("lfp-12.8-200", "lithium", 12, 12.8, 200),
    ahModule("lfp-25.6-100", "lithium", 24, 25.6, 100),
    ahModule("lfp-25.6-200", "lithium", 24, 25.6, 200),
    ahModule("lfp-51.2-100", "lithium", 48, 51.2, 100),
    ahModule("lfp-51.2-200", "lithium", 48, 51.2, 200),
    ahModule("lfp-51.2-280", "lithium", 48, 51.2, 280),
    ahModule("lfp-51.2-314", "lithium", 48, 51.2, 314),
    rackModule("lfp-rack-5", 5000),
    rackModule("lfp-rack-10", 10000)
  ];

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

  function roundUp(n) {
    var nearest = Math.round(n);
    if (Math.abs(n - nearest) < 1e-6) return nearest;
    return Math.ceil(n - 1e-9);
  }

  function formatGrouped(n) {
    var rounded = Math.round(n);
    var sign = rounded < 0 ? "-" : "";
    var digits = String(Math.abs(rounded));
    return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function almost(a, b) {
    return Math.abs(a - b) < 1e-9;
  }

  function findModule(id) {
    var i;
    for (i = 0; i < MODULES.length; i++) {
      if (MODULES[i].id === id) return MODULES[i];
    }
    return null;
  }

  function seriesFor(nominalV, systemV) {
    var series = systemV / nominalV;
    if (Math.abs(series - Math.round(series)) > 1e-9) return null;
    series = Math.round(series);
    if (series < 1) return null;
    return series;
  }

  function chemistryLabel(type) {
    return type === "tubular" ? "Tubular lead-acid" : "Lithium (LiFePO4)";
  }

  function bandVoltage(loadW) {
    if (loadW <= 1500) return 12;
    if (loadW <= 3500) return 24;
    return 48;
  }

  function inverterVoltages(kva) {
    if (kva <= 2) return [12];
    if (kva <= 4.2) return [24];
    if (kva < 10) return [48];
    return [48, 96];
  }

  function continuousWatts(kva) {
    return kva * 1000 * POWER_FACTOR;
  }

  function voltageCanHost(loadW, voltage) {
    if (voltage === 96 && !(loadW > MIN_LOAD_96V)) return false;
    var need = loadW * INVERTER_SAFETY;
    var i;
    for (i = 0; i < INVERTER_KVA.length; i++) {
      var kva = INVERTER_KVA[i];
      if (inverterVoltages(kva).indexOf(voltage) !== -1 && continuousWatts(kva) + 1e-6 >= need) {
        return true;
      }
    }
    return false;
  }

  function describeConfig(config) {
    var name = config.module.label;
    var bank = config.kind === "kwh"
      ? (config.installedWh / 1000).toFixed(1).replace(/\.0$/, "") + "kWh bank"
      : config.bankAh + "Ah bank";
    if (config.series === 1 && config.parallel === 1) return "1 × " + name + " (" + bank + ")";
    if (config.series === 1) return config.units + " × " + name + " in parallel (" + bank + ")";
    if (config.parallel === 1) return config.units + " × " + name + " in series (" + config.systemV + "V, " + bank + ")";
    return config.units + " × " + name + " (" + config.series + " in series × " + config.parallel + " parallel, " + bank + ")";
  }

  function buildConfig(module, systemV, requiredAh, requiredWh) {
    var series = seriesFor(module.nominalV, systemV);
    if (!series) return null;
    var parallel;
    var bankAh;
    var installedWh;
    if (module.kind === "kwh") {
      parallel = Math.max(1, roundUp(requiredWh / module.wh));
      installedWh = module.wh * parallel * series;
      bankAh = installedWh / systemV;
    } else {
      parallel = Math.max(1, roundUp(requiredAh / module.ah));
      bankAh = module.ah * parallel;
      installedWh = bankAh * systemV;
    }
    var config = {
      module: module,
      id: module.id,
      kind: module.kind,
      systemV: systemV,
      series: series,
      parallel: parallel,
      units: series * parallel,
      bankAh: bankAh,
      installedWh: installedWh,
      oversizeWh: installedWh - requiredWh
    };
    config.config = describeConfig(config);
    return config;
  }

  function configsFor(chemistry, systemV, requiredAh, requiredWh) {
    var list = [];
    var i;
    for (i = 0; i < MODULES.length; i++) {
      if (MODULES[i].chemistry !== chemistry) continue;
      var config = buildConfig(MODULES[i], systemV, requiredAh, requiredWh);
      if (config && config.installedWh + 1e-6 >= requiredWh) list.push(config);
    }
    list.sort(function (a, b) {
      if (a.units !== b.units) return a.units - b.units;
      if (Math.abs(a.oversizeWh - b.oversizeWh) > 1e-6) return a.oversizeWh - b.oversizeWh;
      if (a.module.nominalV !== b.module.nominalV) return b.module.nominalV - a.module.nominalV;
      return (b.module.ah || b.module.wh) - (a.module.ah || a.module.wh);
    });
    return list;
  }

  function modulesFor(chemistry, systemV) {
    return MODULES.filter(function (module) {
      if (chemistry && module.chemistry !== chemistry) return false;
      if (systemV && !seriesFor(module.nominalV, systemV)) return false;
      return true;
    });
  }

  function panelElectrical(panelW) {
    var scale = panelW / 550;
    var voc = 49.5 * scale;
    return { voc: voc, vmp: 41 * scale, coldVoc: voc * COLD_VOC_FACTOR };
  }

  function layoutText(series, parallel) {
    if (series === 1 && parallel === 1) return "1 panel";
    if (series === 1) return parallel + " strings of 1 panel";
    if (parallel === 1) return series + " panels in series";
    return series + " in series × " + parallel + " parallel";
  }

  function hybridFor(kva, systemV) {
    var i;
    for (i = 0; i < HYBRIDS.length; i++) {
      if (almost(HYBRIDS[i].kva, kva) && HYBRIDS[i].voltages.indexOf(systemV) !== -1) return HYBRIDS[i];
    }
    return null;
  }

  function batteryAmps(loadW, voltage) {
    return loadW / (EFFICIENCY * voltage);
  }

  function planStrings(panelW, minimumCount, window) {
    var elec = panelElectrical(panelW);
    var maxSeries = Math.max(1, Math.floor((window.maxVoc + 1e-6) / elec.coldVoc));
    var minSeries = Math.max(1, Math.ceil((window.minVmp - 1e-9) / elec.vmp));
    var cramped = false;
    if (minSeries > maxSeries) {
      cramped = true;
      minSeries = maxSeries;
    }
    var best = null;
    var series;
    for (series = minSeries; series <= maxSeries; series++) {
      var parallel = Math.max(1, roundUp(minimumCount / series));
      var count = series * parallel;
      var extra = count - minimumCount;
      var rank = extra * 100 - series;
      if (!best || rank < best.rank) {
        best = {
          series: series,
          parallel: parallel,
          count: count,
          extra: extra,
          rank: rank,
          stringVmp: series * elec.vmp,
          stringVoc: series * elec.voc,
          coldVoc: series * elec.coldVoc
        };
      }
    }
    var flags = [];
    if (best.coldVoc > window.maxVoc + 0.05 || cramped) {
      flags.push("Cold string Voc is " + Math.round(best.coldVoc) + "V, above the " + window.maxVoc + "V MPPT limit.");
    } else if (best.coldVoc > 450 && window.maxVoc >= 500) {
      flags.push("Cold string Voc is " + Math.round(best.coldVoc) + "V. That is under 500V, but check a 450V MPPT limit.");
    }
    best.vocOk = best.coldVoc <= window.maxVoc + 0.05 && !cramped;
    best.flags = flags;
    best.panelVoc = elec.voc;
    best.maxVoc = window.maxVoc;
    best.layout = layoutText(best.series, best.parallel);
    best.vocCheck = "Cold string Voc " + Math.round(best.coldVoc) + "V, " + (best.vocOk ? "within" : "above") + " the " + window.maxVoc + "V MPPT limit.";
    return best;
  }

  function separateController(installedW, systemV) {
    var requiredA = installedW / systemV * CONTROLLER_MARGIN;
    var needed = roundUp(requiredA);
    var rating = null;
    var i;
    for (i = 0; i < MPPT_RATINGS.length; i++) {
      if (MPPT_RATINGS[i] >= needed) {
        rating = MPPT_RATINGS[i];
        break;
      }
    }
    var count = 1;
    var multiple = false;
    if (!rating) {
      multiple = true;
      rating = 120;
      count = roundUp(needed / 120);
    }
    return {
      mode: "separate",
      requiredA: requiredA,
      amps: needed,
      rating: rating,
      count: count,
      multiple: multiple,
      label: count === 1 ? rating + "A MPPT" : count + " × " + rating + "A MPPT",
      note: multiple
        ? "The array is larger than a standard hybrid PV input, so these are separate MPPTs."
        : "Separate MPPT. This inverter has no built-in MPPT large enough for the array."
    };
  }

  function externalWindow(systemV, installedW) {
    var amps = installedW / systemV * CONTROLLER_MARGIN;
    return {
      minVmp: Math.max(18, systemV * 1.5),
      maxVoc: amps > 60 ? 250 : 150
    };
  }

  function hybridWindow(spec, systemV) {
    return {
      minVmp: systemV >= 96 ? Math.max(spec.minVmp, 200) : spec.minVmp,
      maxVoc: spec.maxVoc
    };
  }

  function solveArray(systemV, arrayW, panelW, inverter) {
    var minimum = Math.max(1, roundUp(arrayW / panelW));
    var spec = inverter.kva && inverter.voltageMatch && !inverter.undersized
      ? hybridFor(inverter.kva, systemV)
      : null;
    var roughW = minimum * panelW;
    var useHybrid = !!(spec && roughW / 1000 <= spec.pvKw + 1e-9);
    var window = useHybrid ? hybridWindow(spec, systemV) : externalWindow(systemV, roughW);
    var strings = planStrings(panelW, minimum, window);
    var installedW = strings.count * panelW;
    if (useHybrid && installedW / 1000 > spec.pvKw + 1e-9) {
      useHybrid = false;
      window = externalWindow(systemV, installedW);
      strings = planStrings(panelW, minimum, window);
      installedW = strings.count * panelW;
    }
    var controller;
    if (useHybrid) {
      var requiredA = installedW / systemV * CONTROLLER_MARGIN;
      controller = {
        mode: "hybrid",
        requiredA: requiredA,
        amps: roundUp(requiredA),
        rating: null,
        count: 1,
        multiple: false,
        trackers: spec.trackers,
        pvKw: spec.pvKw,
        label: inverter.kva + " kVA hybrid inverter with built-in MPPT",
        note: "Built-in MPPT covers about " + spec.pvKw + " kW of PV" + (spec.trackers > 1 ? " on " + spec.trackers + " trackers" : "") + "."
      };
    } else {
      controller = separateController(installedW, systemV);
      if (spec) {
        controller.note = "Array is about " + (installedW / 1000).toFixed(1) + " kW, above this hybrid's " + spec.pvKw + " kW PV input. Use separate MPPTs.";
      }
    }
    return { strings: strings, installedW: installedW, controller: controller, hybrid: useHybrid, spec: spec };
  }

  function voltageIsPractical(loadW, voltage, arrayW, panelW) {
    return voltageBlockers(loadW, voltage, arrayW, panelW).length === 0;
  }

  function voltageBlockers(loadW, voltage, arrayW, panelW) {
    var reasons = [];
    var amps = batteryAmps(loadW, voltage);
    if (amps > MAX_BATTERY_AMPS + 1e-6) reasons.push("about " + Math.round(amps) + "A of battery current");
    var inverter = chooseInverter(loadW, voltage, "auto", arrayW, panelW);
    if (!inverter.available || inverter.custom || !inverter.voltageMatch) {
      reasons.push("no single standard inverter");
    } else {
      var solved = solveArray(voltage, arrayW, panelW, inverter);
      var oneController = solved.hybrid || (solved.controller.count === 1 && !solved.controller.multiple);
      if (!oneController) reasons.push("more than one charge controller");
    }
    return reasons;
  }

  function chooseInverter(loadW, systemV, requested, arrayW, panelW) {
    var requiredW = loadW * INVERTER_SAFETY;
    var requiredKva = requiredW / (POWER_FACTOR * 1000);
    var auto = requested === undefined || requested === null || requested === "" || requested === "auto";
    var i;
    if (!auto) {
      var chosen = parseNumber(requested);
      var known = false;
      var i;
      if (chosen.kind === "ok") {
        for (i = 0; i < INVERTER_KVA.length; i++) {
          if (almost(INVERTER_KVA[i], chosen.value)) known = true;
        }
      }
      if (!known) {
        return { error: "Choose Auto or a standard inverter size." };
      }
      var kva = chosen.value;
      var allowed = inverterVoltages(kva);
      var flags = [];
      if (allowed.indexOf(systemV) === -1) {
        flags.push("A " + kva + " kVA inverter is typically " + allowed.join("V or ") + "V, not " + systemV + "V.");
      }
      if (continuousWatts(kva) + 1e-6 < requiredW) {
        flags.push("This inverter is below the " + formatGrouped(requiredW) + "W needed after 1.25× headroom.");
      }
      return {
        mode: "chosen",
        custom: false,
        available: true,
        kva: kva,
        label: kva + " kVA",
        requiredW: requiredW,
        requiredKva: requiredKva,
        continuousW: continuousWatts(kva),
        surgeW: continuousWatts(kva) * SURGE_FACTOR,
        voltageMatch: allowed.indexOf(systemV) !== -1,
        undersized: continuousWatts(kva) + 1e-6 < requiredW,
        flags: flags
      };
    }
    if (requiredKva > 15 + 1e-9) {
      return {
        mode: "auto",
        custom: true,
        available: false,
        kva: null,
        label: CUSTOM_LABEL,
        requiredW: requiredW,
        requiredKva: requiredKva,
        continuousW: null,
        surgeW: null,
        voltageMatch: true,
        undersized: false,
        flags: ["This load needs about " + requiredKva.toFixed(1) + " kVA, above 15 kVA."]
      };
    }
    var candidates = [];
    for (i = 0; i < INVERTER_KVA.length; i++) {
      if (inverterVoltages(INVERTER_KVA[i]).indexOf(systemV) !== -1 && continuousWatts(INVERTER_KVA[i]) + 1e-6 >= requiredW) {
        candidates.push(INVERTER_KVA[i]);
      }
    }
    var match = candidates.length ? candidates[0] : null;
    if (match !== null && arrayW && panelW) {
      function trialFor(kva) {
        return {
          mode: "auto",
          custom: false,
          available: true,
          kva: kva,
          label: kva + " kVA",
          requiredW: requiredW,
          requiredKva: requiredKva,
          continuousW: continuousWatts(kva),
          surgeW: continuousWatts(kva) * SURGE_FACTOR,
          voltageMatch: true,
          undersized: false,
          flags: []
        };
      }
      var smallestSolved = solveArray(systemV, arrayW, panelW, trialFor(match));
      if (!smallestSolved.hybrid && (smallestSolved.controller.multiple || smallestSolved.controller.count > 1)) {
        var h;
        for (h = 1; h < candidates.length; h++) {
          if (solveArray(systemV, arrayW, panelW, trialFor(candidates[h])).hybrid) {
            match = candidates[h];
            break;
          }
        }
      }
    }
    if (match === null) {
      return {
        mode: "auto",
        custom: false,
        available: false,
        kva: null,
        label: "No matching standard inverter",
        requiredW: requiredW,
        requiredKva: requiredKva,
        continuousW: null,
        surgeW: null,
        voltageMatch: false,
        undersized: true,
        flags: ["No standard " + systemV + "V inverter covers this load (about " + requiredKva.toFixed(1) + " kVA)."]
      };
    }
    return {
      mode: "auto",
      custom: false,
      available: true,
      kva: match,
      label: match + " kVA",
      requiredW: requiredW,
      requiredKva: requiredKva,
      continuousW: continuousWatts(match),
      surgeW: continuousWatts(match) * SURGE_FACTOR,
      voltageMatch: true,
      undersized: false,
      flags: []
    };
  }

  function calcSolar(input) {
    input = input || {};
    var errors = {};
    var load = parseNumber(input.load);
    var hours = parseNumber(input.hours);
    var pshGiven = input.peakSunHours === undefined || input.peakSunHours === null;
    var autoGiven = input.autonomyDays === undefined || input.autonomyDays === null;
    var panelGiven = input.panelW === undefined || input.panelW === null || input.panelW === "";
    var psh = pshGiven ? { kind: "ok", value: DEFAULT_PSH } : parseNumber(input.peakSunHours);
    var autonomy = autoGiven ? { kind: "ok", value: DEFAULT_AUTONOMY } : parseNumber(input.autonomyDays);
    var panelParsed = panelGiven ? { kind: "ok", value: DEFAULT_PANEL_W } : parseNumber(input.panelW);
    var batteryType = input.batteryType === undefined || input.batteryType === null || input.batteryType === ""
      ? "lithium"
      : String(input.batteryType);
    var voltageRaw = input.voltage === undefined || input.voltage === null || input.voltage === ""
      ? "auto"
      : String(input.voltage).trim().toLowerCase();
    var moduleRaw = input.batteryModule === undefined || input.batteryModule === null || input.batteryModule === ""
      ? "auto"
      : String(input.batteryModule);

    if (load.kind === "empty") errors.load = "Enter the total load in watts.";
    else if (load.kind === "invalid" || load.value <= 0) errors.load = "Load must be a number greater than 0.";
    else if (load.value > MAX_LOAD_W) errors.load = "Load must be 50,000 W or less.";

    if (hours.kind === "empty") errors.hours = "Enter how many hours you use this load each day.";
    else if (hours.kind === "invalid" || hours.value <= 0 || hours.value > MAX_HOURS) {
      errors.hours = hours.kind === "empty"
        ? "Enter how many hours you use this load each day."
        : (hours.kind === "invalid"
          ? "Hours must be a number greater than 0 and no more than 24."
          : "Hours per day must be greater than 0 and no more than 24.");
    }

    if (batteryType !== "lithium" && batteryType !== "tubular") {
      errors.batteryType = "Choose Lithium (LiFePO4) or tubular lead-acid.";
    }

    if (psh.kind !== "ok" || psh.value < 1 || psh.value > 12) {
      errors.peakSunHours = "Peak sun hours must be a number from 1 to 12.";
    }
    if (autonomy.kind !== "ok" || autonomy.value < 1 || autonomy.value > 14) {
      errors.autonomyDays = "Autonomy must be a number from 1 to 14 days.";
    }
    if (panelParsed.kind !== "ok" || PANEL_WATTS.indexOf(panelParsed.value) === -1) {
      errors.panelW = "Choose a panel size of 300, 400, 450, 500, 550, 600, or 650W.";
    }

    var voltageNumber = null;
    var voltageAuto = voltageRaw === "auto";
    if (!voltageAuto) {
      var parsedVoltage = parseNumber(voltageRaw);
      if (parsedVoltage.kind !== "ok" || VOLTAGES.indexOf(parsedVoltage.value) === -1) {
        errors.voltage = "Choose Auto, 12V, 24V, 48V, or 96V for a very large system.";
      } else {
        voltageNumber = parsedVoltage.value;
      }
    }

    if (Object.keys(errors).length) return { ok: false, errors: errors };

    var loadW = load.value;
    var sunHours = psh.value;
    var loadWhPreview = loadW * hours.value;
    var dailyWhPreview = loadWhPreview / EFFICIENCY;
    var arrayW = dailyWhPreview / (sunHours * PANEL_DERATE);
    var band = bandVoltage(loadW);
    var preferred = null;
    var ladder;
    for (ladder = 0; ladder < VOLTAGES.length; ladder++) {
      if (voltageIsPractical(loadW, VOLTAGES[ladder], arrayW, panelParsed.value)) {
        preferred = VOLTAGES[ladder];
        break;
      }
    }
    if (preferred === null) preferred = batteryAmps(loadW, 48) > MAX_BATTERY_AMPS ? 96 : 48;

    var stepped = false;
    var systemV = voltageNumber;
    if (voltageAuto) {
      systemV = preferred;
      stepped = systemV !== band;
    } else if (systemV === 96 && preferred !== 96 && batteryAmps(loadW, 48) <= MAX_BATTERY_AMPS + 1e-6) {
      return {
        ok: false,
        errors: { voltage: "96V is only for a very large system, when 48V would mean more than about 150A or more than one charge controller." }
      };
    }

    var dod = DOD[batteryType];
    var loadWh = loadW * hours.value;
    var dailyWh = loadWh / EFFICIENCY;
    var batteryWh = dailyWh * autonomy.value / dod;
    var batteryAh = roundUp(batteryWh / systemV);
    var catalog = configsFor(batteryType, systemV, batteryAh, batteryWh);
    var selected = null;
    var moduleAuto = moduleRaw === "auto";
    if (!moduleAuto) {
      var chosenModule = findModule(moduleRaw);
      if (!chosenModule || chosenModule.chemistry !== batteryType) {
        return { ok: false, errors: { batteryModule: "Choose a module for the selected battery type, or leave Auto." } };
      }
      selected = buildConfig(chosenModule, systemV, batteryAh, batteryWh);
      if (!selected) {
        return {
          ok: false,
          errors: {
            batteryModule: "That module cannot make " + systemV + "V. Its nominal voltage has to divide the system voltage exactly."
          }
        };
      }
    } else if (!catalog.length) {
      return { ok: false, errors: { batteryModule: "No standard module fits this voltage and chemistry." } };
    } else {
      selected = catalog[0];
    }

    var alternatives = [];
    var c;
    for (c = 0; c < catalog.length && alternatives.length < 2; c++) {
      if (catalog[c].id === selected.id) continue;
      alternatives.push(catalog[c]);
    }

    var advice = null;
    var rank = { 12: 1, 24: 2, 48: 3, 96: 4 };
    if (!voltageAuto && rank[systemV] < rank[preferred]) {
      advice = {
        recommended: preferred,
        message: "A " + systemV + "V system is small for this load (about " + Math.round(batteryAmps(loadW, systemV)) + "A from the battery). " + preferred + "V keeps current and charge control more reasonable."
      };
    }
    if (stepped) {
      var skipped = systemV === 96 ? 48 : systemV === 48 ? 24 : 12;
      var blockers = voltageBlockers(loadW, skipped, arrayW, panelParsed.value);
      advice = {
        recommended: systemV,
        message: "Auto chose " + systemV + "V instead of " + skipped + "V, which would mean " + (blockers.join(" and ") || "a poorer match") + "."
      };
    }

    var inverter = chooseInverter(loadW, systemV, input.inverter, arrayW, panelParsed.value);
    if (inverter.error) return { ok: false, errors: { inverter: inverter.error } };
    if (loadW >= LARGE_LOAD_W) {
      inverter.flags = inverter.flags.concat(["Above 5 kW, splitting the load across parallel inverters is an option. A site survey is recommended."]);
      inverter.largeLoad = true;
    }

    var power = solveArray(systemV, arrayW, panelParsed.value, inverter);
    var strings = power.strings;
    var installedW = power.installedW;
    var controller = power.controller;
    var minimumPanels = Math.max(1, roundUp(arrayW / panelParsed.value));

    var numbers = [loadWh, dailyWh, batteryWh, batteryAh, selected.installedWh, selected.units, minimumPanels, strings.count, installedW, controller.amps, inverter.requiredW];
    if (inverter.continuousW !== null) numbers.push(inverter.continuousW);
    var n;
    for (n = 0; n < numbers.length; n++) {
      if (typeof numbers[n] !== "number" || !Number.isFinite(numbers[n])) {
        return { ok: false, errors: { load: "Those values are too large to estimate. Try a smaller load or fewer hours." } };
      }
    }

    return {
      ok: true,
      loadW: loadW,
      hours: hours.value,
      voltage: systemV,
      voltageMode: voltageAuto ? "auto" : "chosen",
      bandVoltage: band,
      voltageStepped: stepped,
      preferredVoltage: preferred,
      batteryCurrentA: batteryAmps(loadW, systemV),
      batteryType: batteryType,
      batteryLabel: chemistryLabel(batteryType),
      batteryModuleMode: moduleAuto ? "auto" : "chosen",
      peakSunHours: psh.value,
      autonomyDays: autonomy.value,
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
        id: selected.id,
        config: selected.config,
        units: selected.units,
        series: selected.series,
        parallel: selected.parallel,
        bankAh: selected.bankAh,
        installedWh: selected.installedWh,
        oversizeWh: selected.oversizeWh,
        module: selected.module,
        alternatives: alternatives.map(function (item) {
          return { id: item.id, config: item.config, units: item.units, oversizeWh: item.oversizeWh };
        })
      },
      inverter: inverter,
      voltageAdvice: advice,
      panels: {
        moduleW: panelParsed.value,
        arrayW: dailyWh / (psh.value * PANEL_DERATE),
        minimumCount: minimumPanels,
        count: strings.count,
        series: strings.series,
        parallel: strings.parallel,
        layout: strings.layout,
        vmp: strings.stringVmp,
        stringVoc: strings.stringVoc,
        coldVoc: strings.coldVoc,
        vocCheck: strings.vocCheck,
        vocOk: strings.vocOk,
        vocFlags: strings.flags,
        installedW: installedW,
        arrayKW: installedW / 1000
      },
      chargeController: controller,
      assumptions: ASSUMPTIONS
    };
  }

  function formatResult(result) {
    var flags = result.inverter.flags.join(" ");
    var altText = result.battery.alternatives.length
      ? "Also: " + result.battery.alternatives.map(function (item) { return item.config; }).join(". Or ") + "."
      : "";
    var system = result.voltage + "V";
    var systemSub = (result.voltageMode === "auto" ? "Auto" : "Chosen") + " · " + result.batteryLabel;
    return {
      energy: formatGrouped(result.loadWh) + "Wh (" + result.loadKWh.toFixed(2) + " kWh)",
      energySub: formatGrouped(result.dailyWh) + "Wh to supply after 85% efficiency",
      system: system,
      systemSub: systemSub,
      batteryKwh: result.battery.kwh.toFixed(2) + " kWh",
      batteryAh: result.battery.ah + " Ah (" + result.voltage + "V system)",
      batteryConfig: result.battery.config,
      batteryAlt: altText,
      inverter: result.inverter.label,
      inverterSub: result.inverter.continuousW === null
        ? (flags || "Above the standard range.")
        : formatGrouped(result.inverter.continuousW) + "W continuous, " + formatGrouped(result.inverter.surgeW) + "W surge",
      inverterFlags: flags,
      panels: result.panels.count + " × " + result.panels.moduleW + "W",
      panelsSub: result.panels.arrayKW.toFixed(2) + " kW · " + result.panels.layout + " · " + result.panels.vocCheck,
      controller: result.chargeController.label,
      controllerNote: result.chargeController.note,
      advice: result.voltageAdvice ? result.voltageAdvice.message : ""
    };
  }

  function formatQuote(result) {
    var view = formatResult(result);
    var lines = [
      "Hi GridPoint Sunrise Energy, I used your solar calculator.",
      "",
      "Load: " + result.loadW + "W for " + result.hours + " hours/day",
      "System: " + view.system + " (" + view.systemSub + ")",
      "Peak sun hours: " + result.peakSunHours + ", Autonomy: " + result.autonomyDays + (result.autonomyDays === 1 ? " day" : " days"),
      "",
      "Daily energy: " + view.energy,
      "Energy to supply: " + formatGrouped(result.dailyWh) + "Wh after 85% inverter efficiency",
      "Battery: " + view.batteryKwh + ", " + view.batteryAh,
      "Battery config: " + view.batteryConfig
    ];
    if (view.batteryAlt) lines.push(view.batteryAlt);
    lines.push("Inverter: " + view.inverter + (result.inverter.continuousW === null ? "" : " (" + view.inverterSub + ")"));
    if (view.inverterFlags) lines.push(view.inverterFlags);
    if (view.advice) lines.push("Voltage note: " + view.advice);
    lines.push("Solar panels: " + view.panels + ", " + view.panelsSub);
    lines.push("Charge controller: " + view.controller + ". " + view.controllerNote);
    lines.push("");
    lines.push("Please send me a quote.");
    return lines.join("\n");
  }

  return {
    calcSolar: calcSolar,
    formatResult: formatResult,
    formatQuote: formatQuote,
    modulesFor: modulesFor,
    inverterVoltages: inverterVoltages,
    bandVoltage: bandVoltage,
    ASSUMPTIONS: ASSUMPTIONS,
    MODULES: MODULES,
    CONSTANTS: {
      EFFICIENCY: EFFICIENCY,
      PANEL_DERATE: PANEL_DERATE,
      POWER_FACTOR: POWER_FACTOR,
      INVERTER_SAFETY: INVERTER_SAFETY,
      DOD: DOD,
      INVERTER_KVA: INVERTER_KVA.slice(),
      PANEL_WATTS: PANEL_WATTS.slice(),
      MPPT_RATINGS: MPPT_RATINGS.slice(),
      DEFAULT_PSH: DEFAULT_PSH,
      DEFAULT_PANEL_W: DEFAULT_PANEL_W,
      MAX_BATTERY_AMPS: MAX_BATTERY_AMPS,
      LARGE_LOAD_W: LARGE_LOAD_W,
      CUSTOM_LABEL: CUSTOM_LABEL
    }
  };
});
