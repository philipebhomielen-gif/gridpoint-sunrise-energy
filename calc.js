/* Off-grid sizing for Philip's Energy.
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
 * Array      = dailyWh / (peakSunHours × 0.75), then the chosen module
 *              wattage, completed into equal series/parallel strings.
 * Controller = installed array watts / voltage × 1.25, matched to
 *              30, 40, 60, 80, 100, or 120A. Above 120A, use several
 *              controllers or the inverter's built-in MPPT.
 *
 * Auto voltage: ≤1.5 kW → 12V, ≤3.5 kW → 24V, otherwise 48V.
 * If that voltage has no inverter large enough, Auto steps up.
 * 96V is allowed only above 8 kW. Autonomy enlarges the battery only.
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
  var MIN_LOAD_96V = 8000;
  var CUSTOM_LABEL = "Contact us for a custom design";

  var ASSUMPTIONS = "Estimate only, not a final installation design. Energy to supply is load watt-hours divided by 85% inverter efficiency. Battery watt-hours are that figure times autonomy days, divided by depth of discharge (80% LiFePO4, 50% tubular lead-acid). Auto picks the battery module that meets this with the fewest units and the least spare capacity. Series count has to land exactly on the system voltage. Inverter size is continuous load times 1.25 at 0.8 power factor. A 12V inverter is typically up to 2 kVA, 24V up to 4.2 kVA, and 5 kVA and above are 48V. The array uses your panel wattage, peak sun hours, and a 0.75 derate, then equal strings. Charge current is installed array watts divided by voltage, times 1.25. Peak sun hours default to 5 for Abuja. Auto voltage is 12V up to 1.5 kW, 24V up to 3.5 kW, then 48V, and steps up if that voltage has no large enough inverter. 96V is only for loads above 8 kW.";

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

  function panelVmp(panelW) {
    return panelW <= 350 ? 18 : 41;
  }

  function stringPlan(panelW, systemV, minimumCount) {
    var vmp = panelVmp(panelW);
    var series = Math.max(1, roundUp((systemV * 1.25) / vmp));
    var maxStringV = Math.max(150, systemV * 4);
    while (series > 1 && series * vmp > maxStringV) series -= 1;
    var parallel = Math.max(1, roundUp(minimumCount / series));
    var count = series * parallel;
    var layout;
    if (series === 1 && parallel === 1) layout = "1 panel";
    else if (series === 1) layout = parallel + " strings of 1 panel";
    else if (parallel === 1) layout = series + " panels in series";
    else layout = series + " in series × " + parallel + " parallel";
    return { vmp: vmp, series: series, parallel: parallel, count: count, minimumCount: minimumCount, layout: layout };
  }

  function controllerFor(installedW, systemV, inverterKva) {
    var requiredA = installedW / systemV * CONTROLLER_MARGIN;
    var needed = roundUp(requiredA);
    var rating = null;
    var count = 1;
    var i;
    for (i = 0; i < MPPT_RATINGS.length; i++) {
      if (MPPT_RATINGS[i] >= needed) {
        rating = MPPT_RATINGS[i];
        break;
      }
    }
    var multiple = false;
    var note = "Or use the inverter's built-in MPPT if it accepts this array.";
    if (!rating) {
      multiple = true;
      rating = 120;
      count = roundUp(needed / 120);
      note = count + " separate 120A controllers, or an inverter whose built-in MPPT covers this array.";
    }
    var label = count === 1 ? rating + "A MPPT" : count + " × " + rating + "A MPPT";
    return {
      requiredA: requiredA,
      amps: needed,
      rating: rating,
      count: count,
      multiple: multiple,
      label: label,
      note: note,
      inverterKva: inverterKva
    };
  }

  function chooseInverter(loadW, systemV, requested) {
    var requiredW = loadW * INVERTER_SAFETY;
    var requiredKva = requiredW / (POWER_FACTOR * 1000);
    var auto = requested === undefined || requested === null || requested === "" || requested === "auto";
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
    var match = null;
    for (i = 0; i < INVERTER_KVA.length; i++) {
      if (inverterVoltages(INVERTER_KVA[i]).indexOf(systemV) !== -1 && continuousWatts(INVERTER_KVA[i]) + 1e-6 >= requiredW) {
        match = INVERTER_KVA[i];
        break;
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
    var band = bandVoltage(loadW);
    var stepped = false;
    var systemV = voltageNumber;
    if (voltageAuto) {
      var order = [band, 12, 24, 48, 96];
      var seen = {};
      var v;
      systemV = null;
      for (v = 0; v < order.length; v++) {
        var candidate = order[v];
        if (seen[candidate]) continue;
        seen[candidate] = true;
        if (candidate === 12 && band > 12) continue;
        if (candidate === 24 && band > 24) continue;
        if (voltageCanHost(loadW, candidate)) {
          systemV = candidate;
          stepped = candidate !== band;
          break;
        }
      }
      if (systemV === null) systemV = band;
    } else if (systemV === 96 && !(loadW > MIN_LOAD_96V)) {
      return {
        ok: false,
        errors: { voltage: "96V is only for very large systems, above 8 kW." }
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
    if (!voltageAuto && systemV !== 96) {
      var rank = { 12: 1, 24: 2, 48: 3, 96: 4 };
      if (rank[systemV] < rank[band]) {
        advice = {
          recommended: band,
          message: "A " + systemV + "V system is small for this load. " + band + "V is a better fit."
        };
      }
    }
    if (stepped) {
      advice = {
        recommended: systemV,
        message: "This load is in the " + band + "V band, but it needs a larger inverter than " + band + "V models usually are. Auto chose " + systemV + "V."
      };
    }

    var inverter = chooseInverter(loadW, systemV, input.inverter);
    if (inverter.error) return { ok: false, errors: { inverter: inverter.error } };

    var minimumPanels = roundUp(dailyWh / (psh.value * PANEL_DERATE) / panelParsed.value);
    var strings = stringPlan(panelParsed.value, systemV, minimumPanels);
    var installedW = strings.count * panelParsed.value;
    var controller = controllerFor(installedW, systemV, inverter.kva);

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
        vmp: strings.vmp,
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
      panelsSub: result.panels.arrayKW.toFixed(2) + " kW · " + result.panels.layout,
      controller: result.chargeController.label,
      controllerNote: result.chargeController.note,
      advice: result.voltageAdvice ? result.voltageAdvice.message : ""
    };
  }

  function formatQuote(result) {
    var view = formatResult(result);
    var lines = [
      "Hi Philip's Energy, I used your solar calculator.",
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
      MIN_LOAD_96V: MIN_LOAD_96V,
      CUSTOM_LABEL: CUSTOM_LABEL
    }
  };
});
