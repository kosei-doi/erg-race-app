// PM5 Bluetooth Smart のバイト列の解釈(DOM に依存しない純粋な関数)。
// 出典は README の「PM5 仕様の出典」を参照。値はすべてリトルエンディアン。
// 入力は DataView / Uint8Array / ArrayBuffer / 数値配列のどれでもよい。

export const UUID = Object.freeze({
  rowingService: 'ce060030-43e5-11e4-916c-0800200c9a66',
  generalStatus: 'ce060031-43e5-11e4-916c-0800200c9a66',
  additionalStatus1: 'ce060032-43e5-11e4-916c-0800200c9a66',
  additionalStatus2: 'ce060033-43e5-11e4-916c-0800200c9a66',
  generalStatusRate: 'ce060034-43e5-11e4-916c-0800200c9a66',
});

export function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof DataView) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (Array.isArray(input)) return Uint8Array.from(input);
  throw new TypeError('PM5 のデータはバイト列で渡してください');
}

const u16 = (v, o) => v[o] | (v[o + 1] << 8);
const u24 = (v, o) => v[o] | (v[o + 1] << 8) | (v[o + 2] << 16);

function need(v, n, name) {
  if (v.length < n) throw new RangeError(`${name} は ${n} バイト必要です(受信 ${v.length})`);
}

// 0x0031 一般状態(19 バイト)
export function parseGeneralStatus(input) {
  const v = toBytes(input);
  need(v, 19, '一般状態');
  return {
    elapsedTime: u24(v, 0) * 0.01, // 秒
    distance: u24(v, 3) * 0.1, // メートル
    workoutType: v[6],
    intervalType: v[7],
    workoutState: v[8],
    rowingState: v[9],
    strokeState: v[10],
    totalWorkDistance: u24(v, 11),
    workoutDuration: u24(v, 14),
    workoutDurationType: v[17],
    dragFactor: v[18],
  };
}

// 0x0032 追加状態1(16 バイト以上)
export function parseAdditionalStatus1(input) {
  const v = toBytes(input);
  need(v, 16, '追加状態1');
  return {
    elapsedTime: u24(v, 0) * 0.01,
    speed: u16(v, 3) * 0.001, // m/s
    strokeRate: v[5], // SPM
    heartRate: v[6], // 255 は未接続
    currentPace: u16(v, 7) * 0.01, // 秒 / 500m
    averagePace: u16(v, 9) * 0.01,
    restDistance: u16(v, 11),
    restTime: u24(v, 13) * 0.01,
  };
}

// 0x0033 追加状態2(20 バイト)
export function parseAdditionalStatus2(input) {
  const v = toBytes(input);
  need(v, 20, '追加状態2');
  return {
    elapsedTime: u24(v, 0) * 0.01,
    intervalCount: v[3],
    averagePower: u16(v, 4), // W
    totalCalories: u16(v, 6),
    splitAveragePace: u16(v, 8) * 0.01,
    splitAveragePower: u16(v, 10),
    splitAverageCalories: u16(v, 12),
    lastSplitTime: u24(v, 14) * 0.1,
    lastSplitDistance: u24(v, 17),
  };
}

// ペース(秒/500m)→ "2:05.3"。0 や不正値は "--:--"
export function formatPace(sec) {
  if (!Number.isFinite(sec) || sec <= 0 || sec >= 6000) return '--:--';
  const tenths = Math.round(sec * 10);
  const m = Math.floor(tenths / 600);
  const s = (tenths % 600) / 10;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

// 秒 → "12.34"(1分以上は "1:02.34")
export function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '--.--';
  const c = Math.round(sec * 100);
  const m = Math.floor(c / 6000);
  const s = (c % 6000) / 100;
  return m > 0 ? `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}` : s.toFixed(2);
}

// Concept2 の式: watts = 2.80 / (pace/500)^3 (pace は秒/500m)
export function wattsFromPace(paceSec) {
  if (!Number.isFinite(paceSec) || paceSec <= 0) return 0;
  const p = paceSec / 500;
  return Math.round(2.8 / (p * p * p));
}
