var assert = require("assert");
var calc = require("../calc.js");
var calcSolar = calc.calcSolar;

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
  assert.ok(Math.abs(actual - expected) <= (eps || 1e-9), actual + " !== " + expected);
}

function base(overrides) {
  var input = {
    load: 500,
    hours: 6,
    voltage: 12,
    batteryType: "lithium",
    peakSunHours: 5,
    autonomyDays: 1
  };
  var key;
  overrides = overrides || {};
  for (key in overrides) input[key] = overrides[key];
  return input;
}

function finiteResult(result) {
  assert.strictEqual(result.ok, true);
  var blob = JSON.stringify(result);
  assert.ok(blob.indexOf("NaN") === -1, blob);
  assert.ok(blob.indexOf("Infinity") === -1, blob);
  assert.ok(Number.isFinite(result.loadWh));
  assert.ok(Number.isFinite(result.dailyWh));
  assert.ok(Number.isFinite(result.battery.wh));
  assert.ok(Number.isFinite(result.battery.ah));
  assert.ok(Number.isFinite(result.panels.count));
  assert.ok(Number.isFinite(result.chargeController.amps));
}

test("500W x 6h on 12V lithium", function () {
  var result = calcSolar(base());
  finiteResult(result);
  close(result.loadWh, 3000);
  close(result.loadKWh, 3);
  close(result.dailyWh, 3000 / 0.85);
  close(result.battery.wh, (3000 / 0.85) / 0.8);
  close(result.battery.kwh, result.battery.wh / 1000);
  assert.strictEqual(result.battery.ah, Math.ceil(result.battery.wh / 12));
  assert.strictEqual(result.battery.ah, 368);
  assert.strictEqual(result.battery.unitAh, 200);
  assert.strictEqual(result.battery.series, 1);
  assert.strictEqual(result.battery.parallel, 2);
  assert.strictEqual(result.battery.count, 2);
  assert.strictEqual(result.battery.bankAh, 400);
  assert.strictEqual(result.inverter.label, "1 kVA");
  assert.strictEqual(result.inverter.custom, false);
  close(result.inverter.continuousW, 800);
  close(result.inverter.surgeW, 1600);
  assert.strictEqual(result.voltageAdvice, null);
  close(result.panels.arrayW, (3000 / 0.85) / (5 * 0.75));
  assert.strictEqual(result.panels.count, 2);
  close(result.panels.arrayKW, 1.1);
  assert.strictEqual(result.chargeController.amps, 115);
});

test("2000W x 8h on 24V lithium", function () {
  var result = calcSolar(base({ load: 2000, hours: 8, voltage: 24 }));
  finiteResult(result);
  close(result.loadWh, 16000);
  close(result.dailyWh, 16000 / 0.85);
  close(result.battery.wh, (16000 / 0.85) / 0.8);
  assert.strictEqual(result.battery.ah, 981);
  assert.strictEqual(result.battery.series, 2);
  assert.strictEqual(result.battery.parallel, 5);
  assert.strictEqual(result.battery.count, 10);
  assert.strictEqual(result.battery.bankAh, 1000);
  assert.strictEqual(result.inverter.label, "3.5 kVA");
  close(result.inverter.continuousW, 2800);
  close(result.inverter.surgeW, 5600);
  assert.strictEqual(result.voltageAdvice, null);
  assert.strictEqual(result.panels.count, 10);
  close(result.panels.arrayKW, 5.5);
  assert.strictEqual(result.chargeController.amps, 287);
});

test("1500W x 8h 24V lithium stores less than lead-acid", function () {
  var lithium = calcSolar(base({ load: 1500, hours: 8, voltage: 24, batteryType: "lithium" }));
  var lead = calcSolar(base({ load: 1500, hours: 8, voltage: 24, batteryType: "lead" }));
  finiteResult(lithium);
  finiteResult(lead);
  close(lithium.battery.wh, (12000 / 0.85) / 0.8);
  close(lead.battery.wh, (12000 / 0.85) / 0.5);
  assert.strictEqual(lithium.battery.ah, 736);
  assert.strictEqual(lead.battery.ah, 1177);
  assert.ok(lead.battery.wh > lithium.battery.wh);
  assert.ok(lead.battery.count > lithium.battery.count);
  assert.strictEqual(lithium.inverter.label, lead.inverter.label);
  assert.strictEqual(lithium.panels.count, lead.panels.count);
  assert.strictEqual(lithium.inverter.label, "2.5 kVA");
});

test("defaults are lithium, 5 peak sun hours, and 1 autonomy day", function () {
  var result = calcSolar({ load: "500", hours: "6", voltage: "12" });
  finiteResult(result);
  assert.strictEqual(result.batteryType, "lithium");
  assert.strictEqual(result.peakSunHours, 5);
  assert.strictEqual(result.autonomyDays, 1);
  assert.strictEqual(result.battery.ah, 368);
});

test("autonomy days scale only the battery", function () {
  var one = calcSolar(base({ autonomyDays: 1 }));
  var two = calcSolar(base({ autonomyDays: 2 }));
  close(two.battery.wh, one.battery.wh * 2);
  assert.strictEqual(two.panels.count, one.panels.count);
  assert.strictEqual(two.inverter.label, one.inverter.label);
});

test("lower peak sun hours add panels", function () {
  var abuja = calcSolar(base({ peakSunHours: 5 }));
  var cloudier = calcSolar(base({ peakSunHours: 4 }));
  assert.ok(cloudier.panels.arrayW > abuja.panels.arrayW);
  assert.strictEqual(cloudier.panels.count, 3);
  assert.strictEqual(abuja.battery.ah, cloudier.battery.ah);
});

test("48V uses four 12V batteries in series", function () {
  var result = calcSolar(base({ voltage: 48 }));
  assert.strictEqual(result.battery.ah, 92);
  assert.strictEqual(result.battery.series, 4);
  assert.strictEqual(result.battery.parallel, 1);
  assert.strictEqual(result.battery.unitAh, 100);
  assert.strictEqual(result.battery.count, 4);
});

test("a small bank uses a 100Ah battery instead of 200Ah", function () {
  var result = calcSolar(base({ load: 100, hours: 1 }));
  assert.ok(result.battery.ah <= 100);
  assert.strictEqual(result.battery.unitAh, 100);
  assert.strictEqual(result.battery.count, 1);
});

test("voltage advice for 12V and 24V", function () {
  assert.strictEqual(calcSolar(base({ load: 1500, voltage: 12 })).voltageAdvice, null);
  var mid = calcSolar(base({ load: 1501, voltage: 12 }));
  assert.strictEqual(mid.voltageAdvice.recommended, 24);
  var big = calcSolar(base({ load: 3001, voltage: 12 }));
  assert.strictEqual(big.voltageAdvice.recommended, 48);
  assert.strictEqual(calcSolar(base({ load: 3000, voltage: 24 })).voltageAdvice, null);
  var twentyFour = calcSolar(base({ load: 3001, voltage: 24 }));
  assert.strictEqual(twentyFour.voltageAdvice.recommended, 48);
  assert.strictEqual(calcSolar(base({ load: 4000, voltage: 48 })).voltageAdvice, null);
});

test("inverter steps and the 10 kVA limit", function () {
  assert.strictEqual(calcSolar(base({ load: 6400, hours: 1, voltage: 48 })).inverter.label, "10 kVA");
  var custom = calcSolar(base({ load: 6401, hours: 1, voltage: 48 }));
  assert.strictEqual(custom.inverter.custom, true);
  assert.strictEqual(custom.inverter.label, "Contact us for a custom design");
  assert.strictEqual(custom.inverter.kva, null);
  assert.strictEqual(calcSolar(base({ load: 50000, hours: 1, voltage: 48 })).inverter.custom, true);
});

test("quote text includes the new results and no NaN", function () {
  var result = calcSolar(base());
  var quote = calc.formatQuote(result);
  assert.ok(quote.indexOf("Hi Philip's Energy, I used your solar calculator.") === 0);
  assert.ok(quote.indexOf("3,000Wh (3.00 kWh)") !== -1);
  assert.ok(quote.indexOf("368 Ah") !== -1);
  assert.ok(quote.indexOf("1 kVA") !== -1);
  assert.ok(quote.indexOf("2 Panels (550W each)") !== -1);
  assert.ok(quote.indexOf("115 A") !== -1);
  assert.ok(quote.indexOf("2 × 12V 200Ah in parallel") !== -1);
  assert.ok(quote.indexOf("NaN") === -1);
  assert.ok(quote.indexOf("Infinity") === -1);
  var view = calc.formatResult(result);
  assert.strictEqual(view.batteryKwh, "4.41 kWh");
  assert.strictEqual(view.panelsSub, "1.10 kW array");
});

test("rejects empty, zero, negative, and non-numeric values", function () {
  function errors(overrides) {
    var result = calcSolar(base(overrides));
    assert.strictEqual(result.ok, false);
    return result.errors;
  }
  assert.strictEqual(errors({ load: "" }).load, "Enter the total load in watts.");
  assert.strictEqual(errors({ load: "   " }).load, "Enter the total load in watts.");
  assert.strictEqual(errors({ load: "abc" }).load, "Load must be a number greater than 0.");
  assert.strictEqual(errors({ load: "500W" }).load, "Load must be a number greater than 0.");
  assert.strictEqual(errors({ load: 0 }).load, "Load must be a number greater than 0.");
  assert.strictEqual(errors({ load: -20 }).load, "Load must be a number greater than 0.");
  assert.strictEqual(errors({ load: 50001 }).load, "Load must be 50,000 W or less.");
  assert.strictEqual(errors({ hours: "" }).hours, "Enter how many hours you use this load each day.");
  assert.strictEqual(errors({ hours: 0 }).hours.indexOf("no more than 24") !== -1, true);
  assert.strictEqual(errors({ hours: -1 }).hours.indexOf("greater than 0") !== -1, true);
  assert.strictEqual(errors({ hours: 24.01 }).hours.indexOf("no more than 24") !== -1, true);
  assert.strictEqual(errors({ hours: "six" }).hours.indexOf("number") !== -1, true);
  assert.strictEqual(errors({ voltage: 36 }).voltage.indexOf("12V") !== -1, true);
  assert.strictEqual(errors({ batteryType: "agm" }).batteryType.indexOf("lithium") !== -1, true);
  assert.strictEqual(errors({ peakSunHours: 0 }).peakSunHours.indexOf("1 to 12") !== -1, true);
  assert.strictEqual(errors({ peakSunHours: 13 }).peakSunHours.indexOf("1 to 12") !== -1, true);
  assert.strictEqual(errors({ autonomyDays: 0 }).autonomyDays.indexOf("1 to 14") !== -1, true);
  assert.strictEqual(errors({ autonomyDays: 15 }).autonomyDays.indexOf("1 to 14") !== -1, true);
  assert.strictEqual(calcSolar(base({ hours: 24 })).ok, true);
  assert.strictEqual(calcSolar(base({ load: 50000, hours: 1, voltage: 48 })).ok, true);
  var bad = errors({ load: "nope", hours: -3 });
  assert.ok(bad.load);
  assert.ok(bad.hours);
  assert.ok(JSON.stringify(bad).indexOf("NaN") === -1);
});

test("non-finite numbers are rejected", function () {
  assert.strictEqual(calcSolar(base({ load: Infinity })).ok, false);
  assert.strictEqual(calcSolar(base({ hours: NaN })).ok, false);
  assert.strictEqual(calcSolar(base({ load: "1e3" })).ok, false);
});

if (failed) {
  console.error(failed + " failed");
  process.exit(1);
}
console.log("all tests passed");
