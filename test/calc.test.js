var assert = require("assert");
var api = require("../calc.js");
var calcSolar = api.calcSolar;

var failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("ok - " + name);
  } catch (err) {
    failed += 1;
    console.error("not ok - " + name);
    console.error(err && err.stack ? err.stack : err);
  }
}

function close(actual, expected, eps) {
  assert.ok(Math.abs(actual - expected) <= (eps || 1e-6), actual + " !== " + expected);
}

function base(overrides) {
  var input = {
    load: 500,
    hours: 6,
    voltage: "auto",
    batteryType: "lithium",
    batteryModule: "auto",
    inverter: "auto",
    panelW: 550,
    peakSunHours: 5,
    autonomyDays: 1
  };
  var key;
  overrides = overrides || {};
  for (key in overrides) input[key] = overrides[key];
  return input;
}

function finiteResult(result) {
  assert.strictEqual(result.ok, true, JSON.stringify(result.errors || result));
  var blob = JSON.stringify(result);
  assert.ok(blob.indexOf("NaN") === -1, blob);
  assert.ok(blob.indexOf("Infinity") === -1, blob);
}

test("500W x 6h auto lithium", function () {
  var result = calcSolar(base());
  finiteResult(result);
  assert.strictEqual(result.voltage, 12);
  assert.strictEqual(result.voltageMode, "auto");
  assert.strictEqual(result.voltageAdvice, null);
  close(result.loadWh, 3000);
  close(result.dailyWh, 3000 / 0.85);
  close(result.battery.wh, (3000 / 0.85) / 0.8);
  assert.strictEqual(result.battery.ah, 368);
  assert.strictEqual(result.battery.id, "lfp-12.8-200");
  assert.strictEqual(result.battery.units, 2);
  assert.strictEqual(result.battery.series, 1);
  assert.strictEqual(result.battery.parallel, 2);
  assert.strictEqual(result.battery.bankAh, 400);
  assert.ok(result.battery.alternatives.length >= 1);
  assert.strictEqual(result.battery.alternatives[0].id, "lfp-12.8-100");
  assert.strictEqual(result.inverter.label, "1 kVA");
  assert.strictEqual(result.inverter.voltageMatch, true);
  assert.strictEqual(result.panels.moduleW, 550);
  assert.strictEqual(result.panels.minimumCount, 2);
  assert.strictEqual(result.panels.count, 2);
  assert.strictEqual(result.panels.series, 2);
  assert.strictEqual(result.panels.parallel, 1);
  assert.strictEqual(result.panels.vocOk, true);
  assert.strictEqual(result.chargeController.mode, "separate");
  assert.strictEqual(result.chargeController.rating, 120);
  assert.strictEqual(result.chargeController.count, 1);
  var view = api.formatResult(result);
  assert.strictEqual(view.batteryKwh, "4.41 kWh");
  assert.strictEqual(view.panels, "2 × 550W");
  var quote = api.formatQuote(result);
  assert.ok(quote.indexOf("12.8V 200Ah") !== -1, quote);
  assert.ok(quote.indexOf("1 kVA") !== -1);
  assert.ok(quote.indexOf("120A MPPT") !== -1);
  assert.ok(quote.indexOf("NaN") === -1);
});

test("2000W x 8h auto lithium", function () {
  var result = calcSolar(base({ load: 2000, hours: 8 }));
  finiteResult(result);
  assert.strictEqual(result.voltage, 48);
  assert.strictEqual(result.bandVoltage, 24);
  assert.strictEqual(result.voltageStepped, true);
  close(result.batteryCurrentA, 2000 / 0.85 / 48);
  close(result.loadWh, 16000);
  close(result.battery.wh, (16000 / 0.85) / 0.8);
  assert.strictEqual(result.battery.ah, 491);
  assert.strictEqual(result.battery.id, "lfp-51.2-280");
  assert.strictEqual(result.battery.units, 2);
  assert.strictEqual(result.battery.series, 1);
  assert.strictEqual(result.battery.parallel, 2);
  assert.strictEqual(result.inverter.label, "5 kVA");
  assert.strictEqual(result.inverter.voltageMatch, true);
  assert.strictEqual(result.panels.count, 10);
  assert.strictEqual(result.panels.series, 5);
  assert.strictEqual(result.panels.parallel, 2);
  close(result.panels.arrayKW, 5.5);
  assert.strictEqual(result.panels.vocOk, true);
  assert.ok(result.panels.coldVoc < 450);
  assert.strictEqual(result.chargeController.mode, "hybrid");
  assert.ok(result.chargeController.label.indexOf("hybrid inverter with built-in MPPT") !== -1);
  assert.ok(result.battery.alternatives.length === 2);
});

test("2000W x 8h auto tubular uses 12V 250Ah modules", function () {
  var result = calcSolar(base({ load: 2000, hours: 8, batteryType: "tubular" }));
  finiteResult(result);
  assert.strictEqual(result.voltage, 48);
  close(result.battery.wh, (16000 / 0.85) / 0.5);
  assert.strictEqual(result.battery.ah, 785);
  assert.ok(result.battery.wh > calcSolar(base({ load: 2000, hours: 8 })).battery.wh);
  assert.strictEqual(result.battery.id, "tub-12-200");
  assert.strictEqual(result.battery.series, 4);
  assert.strictEqual(result.battery.parallel, 4);
  assert.strictEqual(result.battery.units, 16);
  assert.strictEqual(result.battery.bankAh, 800);
  assert.strictEqual(result.battery.alternatives[0].id, "tub-12-220");
  assert.strictEqual(result.inverter.label, "5 kVA");
  assert.strictEqual(result.panels.series, 5);
});

test("voltage bands and step-up when the inverter will not fit", function () {
  var stays = calcSolar(base({ load: 1280, hours: 1 }));
  assert.strictEqual(stays.voltage, 12);
  assert.strictEqual(stays.inverter.label, "2 kVA");
  var atBand = calcSolar(base({ load: 1500, hours: 1 }));
  assert.strictEqual(atBand.bandVoltage, 12);
  assert.strictEqual(atBand.voltage, 24);
  assert.strictEqual(atBand.voltageStepped, true);
  assert.strictEqual(atBand.inverter.label, "2.5 kVA");
  assert.strictEqual(calcSolar(base({ load: 1501, hours: 1 })).voltage, 24);
  assert.strictEqual(calcSolar(base({ load: 2688, hours: 1 })).voltage, 24);
  var stepped = calcSolar(base({ load: 3000, hours: 1 }));
  assert.strictEqual(stepped.bandVoltage, 24);
  assert.strictEqual(stepped.voltage, 48);
  assert.strictEqual(stepped.voltageStepped, true);
  assert.strictEqual(stepped.inverter.label, "5 kVA");
  assert.strictEqual(calcSolar(base({ load: 3500, hours: 1 })).voltage, 48);
  assert.strictEqual(calcSolar(base({ load: 4000, hours: 1 })).bandVoltage, 48);
});

test("user can override voltage and is warned when it is too low", function () {
  var ok = calcSolar(base({ load: 500, voltage: 48 }));
  finiteResult(ok);
  assert.strictEqual(ok.voltage, 48);
  assert.strictEqual(ok.voltageAdvice, null);
  assert.strictEqual(ok.inverter.label, "5 kVA");
  var low = calcSolar(base({ load: 2000, hours: 1, voltage: 12 }));
  assert.strictEqual(low.voltageAdvice.recommended, 24);
  assert.strictEqual(low.inverter.available, false);
});

test("96V is only for loads above 8 kW", function () {
  var small = calcSolar(base({ load: 5000, voltage: 96 }));
  assert.strictEqual(small.ok, false);
  assert.ok(small.errors.voltage.indexOf("150A") !== -1);
  var big = calcSolar(base({ load: 8500, hours: 1, voltage: 96 }));
  finiteResult(big);
  assert.strictEqual(big.voltage, 96);
  assert.strictEqual(big.inverter.kva >= 10, true);
  assert.strictEqual(big.inverter.voltageMatch, true);
});

test("every lithium and tubular module is valid on a divisible voltage and rejected otherwise", function () {
  api.MODULES.forEach(function (module) {
    [12, 24, 48, 96].forEach(function (voltage) {
      var result = calcSolar(base({
        load: 400,
        hours: 1,
        voltage: voltage,
        batteryType: module.chemistry,
        batteryModule: module.id
      }));
      var fits = (voltage / module.nominalV) >= 1 && Math.abs(voltage / module.nominalV - Math.round(voltage / module.nominalV)) < 1e-9;
      if (voltage === 96) {
        assert.strictEqual(result.ok, false);
        return;
      }
      if (fits) {
        assert.strictEqual(result.ok, true, module.id + " at " + voltage + " " + JSON.stringify(result.errors));
        assert.strictEqual(result.battery.series, voltage / module.nominalV);
      } else {
        assert.strictEqual(result.ok, false, module.id + " should not fit " + voltage);
        assert.ok(result.errors.batteryModule);
      }
    });
  });
});

test("a module from the other chemistry is rejected", function () {
  var result = calcSolar(base({ batteryType: "lithium", batteryModule: "tub-12-200", voltage: 12 }));
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.batteryModule);
});

test("2V cells are a valid series string and Auto keeps the smaller 12V bank", function () {
  var forced = calcSolar(base({
    load: 7651,
    hours: 1,
    voltage: 12,
    batteryType: "tubular",
    batteryModule: "tub-2-1500"
  }));
  finiteResult(forced);
  assert.strictEqual(forced.battery.ah, 1501);
  assert.strictEqual(forced.battery.series, 6);
  assert.strictEqual(forced.battery.parallel, 2);
  assert.strictEqual(forced.battery.units, 12);
  var autoPick = calcSolar(base({ load: 7651, hours: 1, voltage: 12, batteryType: "tubular" }));
  assert.strictEqual(autoPick.battery.id, "tub-12-220");
  assert.ok(autoPick.battery.units < forced.battery.units);
});

test("48V rack is chosen when one cabinet wastes less than a cell module", function () {
  var result = calcSolar(base({ load: 6596, hours: 1, voltage: 48, batteryType: "lithium" }));
  finiteResult(result);
  assert.strictEqual(result.battery.id, "lfp-rack-10");
  assert.strictEqual(result.battery.units, 1);
});

test("inverter catalog, match, and mismatch flags", function () {
  assert.deepStrictEqual(api.CONSTANTS.INVERTER_KVA, [1, 1.5, 2, 2.5, 3, 3.5, 4.2, 5, 6.2, 7.5, 8, 10, 12, 15]);
  assert.deepStrictEqual(api.inverterVoltages(2), [12]);
  assert.deepStrictEqual(api.inverterVoltages(3.5), [24]);
  assert.deepStrictEqual(api.inverterVoltages(4.2), [24]);
  assert.deepStrictEqual(api.inverterVoltages(5), [48]);
  assert.deepStrictEqual(api.inverterVoltages(8), [48]);
  assert.deepStrictEqual(api.inverterVoltages(10), [48, 96]);
  var matched = calcSolar(base({ load: 640, hours: 1, voltage: 12, inverter: 1 }));
  assert.strictEqual(matched.inverter.undersized, false);
  assert.strictEqual(matched.inverter.voltageMatch, true);
  var mismatch = calcSolar(base({ load: 500, voltage: 12, inverter: 5 }));
  assert.strictEqual(mismatch.inverter.voltageMatch, false);
  assert.ok(mismatch.inverter.flags[0].indexOf("48V") !== -1);
  var small = calcSolar(base({ load: 2000, hours: 1, voltage: 24, inverter: 1.5 }));
  assert.strictEqual(small.inverter.undersized, true);
  var custom = calcSolar(base({ load: 20000, hours: 1, voltage: 48 }));
  assert.strictEqual(custom.inverter.custom, true);
  assert.strictEqual(custom.inverter.label, "Contact us for a custom design");
  var unknown = calcSolar(base({ inverter: 9 }));
  assert.strictEqual(unknown.ok, false);
});

test("panel wattage changes the count and strings follow voltage", function () {
  var narrow = calcSolar(base({ panelW: 650, voltage: 12 }));
  var wide = calcSolar(base({ panelW: 300, voltage: 48 }));
  finiteResult(narrow);
  finiteResult(wide);
  assert.ok(narrow.panels.minimumCount <= 2);
  assert.ok(narrow.panels.series >= 1);
  assert.strictEqual(narrow.panels.count % narrow.panels.series, 0);
  assert.ok(wide.panels.series >= 2);
  assert.strictEqual(wide.panels.vocOk, true);
  assert.ok(wide.panels.coldVoc <= 500);
  assert.strictEqual(wide.panels.count % wide.panels.series, 0);
  [300, 400, 450, 500, 550, 600, 650].forEach(function (watt) {
    assert.strictEqual(calcSolar(base({ panelW: watt })).ok, true);
  });
  assert.strictEqual(calcSolar(base({ panelW: 580 })).ok, false);
});

test("hybrid MPPT is used when it covers the array, otherwise separate controllers", function () {
  var hybrid = calcSolar(base({ load: 2000, hours: 8 }));
  assert.strictEqual(hybrid.chargeController.mode, "hybrid");
  assert.ok(hybrid.chargeController.label.indexOf("built-in MPPT") !== -1);
  var separate = calcSolar(base({ load: 2000, hours: 8, voltage: 24 }));
  assert.strictEqual(separate.chargeController.mode, "separate");
  assert.strictEqual(separate.chargeController.rating, 120);
  assert.ok(separate.chargeController.count >= 2);
  assert.ok(separate.chargeController.note.indexOf("separate MPPT") !== -1);
  assert.ok(separate.voltageAdvice.recommended === 48);
});

test("5000W x 8h uses a 48V hybrid that covers the array", function () {
  var result = calcSolar(base({ load: 5000, hours: 8 }));
  finiteResult(result);
  assert.strictEqual(result.voltage, 48);
  assert.ok(result.batteryCurrentA < 150);
  assert.strictEqual(result.inverter.label, "12 kVA");
  assert.strictEqual(result.chargeController.mode, "hybrid");
  assert.strictEqual(result.battery.id, "lfp-51.2-314");
  assert.strictEqual(result.battery.units, 4);
  assert.strictEqual(result.panels.series, 8);
  assert.strictEqual(result.panels.parallel, 3);
  assert.strictEqual(result.panels.count, 24);
  assert.ok(result.panels.coldVoc < 450);
  assert.strictEqual(result.panels.vocOk, true);
  assert.strictEqual(result.panels.vocFlags.length, 0);
  assert.strictEqual(result.inverter.largeLoad, true);
  assert.ok(api.formatQuote(result).indexOf("site survey") !== -1);
});

test("10000W x 8h steps to 96V and asks for a custom design", function () {
  var result = calcSolar(base({ load: 10000, hours: 8 }));
  finiteResult(result);
  assert.strictEqual(result.voltage, 96);
  assert.ok(result.batteryCurrentA < 150);
  assert.ok(calcSolar(base({ load: 10000, hours: 1, voltage: 48 })).batteryCurrentA > 150);
  assert.strictEqual(result.inverter.custom, true);
  assert.strictEqual(result.chargeController.mode, "separate");
  assert.ok(result.chargeController.count >= 2);
  assert.ok(result.inverter.flags.join(" ").indexOf("parallel inverters") !== -1);
  assert.ok(result.inverter.flags.join(" ").indexOf("site survey") !== -1);
  assert.strictEqual(result.panels.vocOk, true);
});

test("autonomy scales the battery only, and lower sun hours add panels", function () {
  var one = calcSolar(base());
  var two = calcSolar(base({ autonomyDays: 2 }));
  close(two.battery.wh, one.battery.wh * 2);
  assert.strictEqual(two.panels.count, one.panels.count);
  var cloud = calcSolar(base({ peakSunHours: 4 }));
  assert.ok(cloud.panels.arrayW > one.panels.arrayW);
  assert.ok(cloud.panels.minimumCount >= one.panels.minimumCount);
});

test("rejects empty, zero, negative, non-numeric, and absurd inputs", function () {
  function errors(overrides) {
    var result = calcSolar(base(overrides));
    assert.strictEqual(result.ok, false);
    return result.errors;
  }
  assert.ok(errors({ load: "" }).load.indexOf("Enter") === 0);
  assert.ok(errors({ load: "abc" }).load.indexOf("number") !== -1);
  assert.ok(errors({ load: 0 }).load);
  assert.ok(errors({ load: -5 }).load);
  assert.ok(errors({ load: 50001 }).load.indexOf("50,000") !== -1);
  assert.ok(errors({ hours: "" }).hours);
  assert.ok(errors({ hours: 0 }).hours.indexOf("24") !== -1);
  assert.ok(errors({ hours: -1 }).hours);
  assert.ok(errors({ hours: 25 }).hours.indexOf("24") !== -1);
  assert.ok(errors({ hours: "six" }).hours.indexOf("number") !== -1);
  assert.ok(errors({ voltage: 36 }).voltage);
  assert.ok(errors({ batteryType: "agm" }).batteryType);
  assert.ok(errors({ peakSunHours: 0 }).peakSunHours);
  assert.ok(errors({ peakSunHours: 13 }).peakSunHours);
  assert.ok(errors({ autonomyDays: 0.5 }).autonomyDays);
  assert.ok(errors({ autonomyDays: 15 }).autonomyDays);
  assert.strictEqual(calcSolar(base({ hours: 24 })).ok, true);
  assert.strictEqual(calcSolar(base({ load: 50000, hours: 1, voltage: 48 })).ok, true);
  assert.strictEqual(calcSolar(base({ load: Infinity })).ok, false);
  assert.strictEqual(calcSolar(base({ hours: NaN })).ok, false);
  assert.strictEqual(calcSolar(base({ load: "1e3" })).ok, false);
  var bad = errors({ load: "nope", hours: -3 });
  assert.ok(JSON.stringify(bad).indexOf("NaN") === -1);
});

test("defaults stay simple when optional fields are omitted", function () {
  var result = calcSolar({ load: "500", hours: "6" });
  finiteResult(result);
  assert.strictEqual(result.batteryType, "lithium");
  assert.strictEqual(result.voltage, 12);
  assert.strictEqual(result.peakSunHours, 5);
  assert.strictEqual(result.autonomyDays, 1);
  assert.strictEqual(result.panels.moduleW, 550);
  assert.strictEqual(result.batteryModuleMode, "auto");
  assert.strictEqual(result.inverter.mode, "auto");
});

if (failed) {
  console.error(failed + " failed");
  process.exit(1);
}
console.log("all tests passed");
