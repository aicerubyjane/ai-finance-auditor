const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const src = fs.readFileSync('static/js/app.js', 'utf8');
const code = src.slice(src.indexOf('const MONTH_CONFIG ='), src.indexOf('function renderMonthButtons()'));
const ctx = { numeric: Number, dashboardState: {} };
vm.createContext(ctx);
vm.runInContext(code, ctx);
function check(keys, expected) {
  ctx.getSortedTrendRows = () => keys.map(k => ({tanggal: k, hari: '1'}));
  assert.deepEqual(Array.from(vm.runInContext('getAvailableMonths().map(m => m.key)', ctx)), expected);
}
check(['sep','aug','jul','oct'], ['oct','sep','aug','jul']);
check(['oct','dec','nov','sep'], ['dec','nov','oct','sep']);
check([], []);
check(['sep','sep','jul'], ['sep','jul']);
console.log('PASS: October first, November/December order, empty and duplicate months');
