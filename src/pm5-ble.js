// PM5 との Web Bluetooth 接続(ブラウザ専用)。バイト列の解釈は pm5-parse.js に任せる。
import { UUID, parseGeneralStatus, parseAdditionalStatus1, parseAdditionalStatus2, wattsFromPace } from './pm5-parse.js';

const INFO_SERVICE = 'ce060010-43e5-11e4-916c-0800200c9a66';
const RETRY_MS = 2500;
const MAX_RETRIES = 20;

export const bluetoothAvailable = () => typeof navigator !== 'undefined' && !!navigator.bluetooth;

export class Pm5Link {
  /** @param {(sample:object)=>void} onSample  @param {(status:string, name:string)=>void} onStatus */
  constructor(onSample, onStatus) {
    this.onSample = onSample;
    this.onStatus = onStatus;
    this.device = null;
    this.name = '';
    this.status = 'idle'; // idle | connecting | connected | reconnecting | lost | error
    this.latest = { dist: NaN, pace: 0, spm: 0, power: 0 };
    this.wantConnected = false;
    this._retry = null;
    this._retries = 0;
    this._gen = 0; // 機器を替えるたびに増やし、古い機器の通知を捨てる
    this._onDisconnect = () => this._handleDisconnect();
  }

  _set(status) { this.status = status; this.onStatus(status, this.name); }

  // ユーザー操作(クリック)の中で呼ぶ。機器選択ダイアログを出す。
  // reject(device): 選んだ機器を断るときに理由の文字列を返す(もう一方のレーンと同じ機器など)
  async pair(reject) {
    if (!bluetoothAvailable()) { this._set('error'); throw new Error('Web Bluetooth が使えません'); }
    const before = this.status;
    this._set('connecting');
    let device;
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'PM5' }],
        optionalServices: [UUID.rowingService, INFO_SERVICE],
      });
    } catch (e) { this._set(before === 'connecting' ? 'idle' : before); throw e; }
    const why = reject?.(device);
    if (why) { this._set(before === 'connecting' ? 'idle' : before); throw new Error(why); }
    this._detach(); // 前の機器の GATT を切る(通知が新しい機器のデータに混ざらないように)
    this.device = device;
    this.name = device.name || 'PM5';
    device.addEventListener('gattserverdisconnected', this._onDisconnect);
    this.wantConnected = true;
    try { await this._connectGatt(); } catch (e) { this._set('lost'); this._scheduleRetry(); throw e; }
  }

  // 今の機器から離れる(切断・再接続の予約の取り消し・古い通知の無効化)
  _detach() {
    this.wantConnected = false;
    clearTimeout(this._retry);
    this._gen += 1;
    const old = this.device;
    if (old) {
      old.removeEventListener('gattserverdisconnected', this._onDisconnect);
      try { old.gatt?.disconnect(); } catch { /* 無視 */ }
    }
    this.latest = { dist: NaN, pace: 0, spm: 0, power: 0 };
  }

  async _connectGatt() {
    this._set(this.status === 'reconnecting' ? 'reconnecting' : 'connecting');
    const gen = this._gen;
    const device = this.device;
    // 待っている間に機器が替わった(_detach された)ら、つないだ GATT を切って抜ける。true なら抜ける
    const stale = () => {
      if (gen === this._gen) return false;
      if (device !== this.device) { try { device.gatt?.disconnect(); } catch { /* 無視 */ } }
      return true;
    };
    const server = await device.gatt.connect();
    if (stale()) return;
    const service = await server.getPrimaryService(UUID.rowingService);
    if (stale()) return;
    const listen = async (uuid, parse, withDist = false) => {
      const ch = await service.getCharacteristic(uuid);
      if (gen !== this._gen) return null;
      ch.addEventListener('characteristicvaluechanged', (ev) => {
        if (gen !== this._gen) return; try { this._merge(parse(ev.target.value), withDist); } catch { /* 壊れたパケットは捨てる */ }
      });
      await ch.startNotifications();
      return ch;
    };
    await listen(UUID.generalStatus, (v) => { const g = parseGeneralStatus(v); return { dist: g.distance, elapsed: g.elapsedTime, strokeState: g.strokeState }; }, true);
    if (stale()) return;
    await listen(UUID.additionalStatus1, (v) => { const a = parseAdditionalStatus1(v); return { pace: a.currentPace, spm: a.strokeRate, power: wattsFromPace(a.currentPace) }; });
    if (stale()) return;
    try { await listen(UUID.additionalStatus2, (v) => { const a = parseAdditionalStatus2(v); return { avgPower: a.averagePower }; }); } catch { /* 無くても動く */ }
    if (stale()) return;
    // 更新間隔を 250ms に(任意。失敗しても既定の間隔(約 500ms)で動く)。README の「未確認の点」参照
    try { const rate = await service.getCharacteristic(UUID.generalStatusRate); await rate.writeValue(Uint8Array.of(2)); } catch { /* 無視 */ }
    if (stale()) return;
    this._retries = 0;
    this._set('connected');
  }

  // 距離は一般状態(0031)の通知のときだけ渡す。ほかの通知で古い距離に新しい時刻が付くと、ゴールの補間がずれる
  _merge(part, withDist = false) {
    Object.assign(this.latest, part);
    const sample = { ...this.latest };
    if (!withDist) delete sample.dist;
    this.onSample(sample);
  }

  _handleDisconnect() {
    if (!this.wantConnected) return;
    this._set('lost');
    this._retries = 0;
    this._scheduleRetry();
  }

  _scheduleRetry() {
    clearTimeout(this._retry);
    if (!this.wantConnected || this._retries >= MAX_RETRIES) return;
    this._retry = setTimeout(async () => {
      this._retries += 1;
      this.status = 'reconnecting';
      const gen = this._gen;
      try { await this._connectGatt(); } catch { if (gen !== this._gen) return; this._set('lost'); this._scheduleRetry(); }
    }, RETRY_MS);
  }

  // 再接続ボタン。選び直さずに同じ機器へつなぎ直す(できなければ選び直す)
  async reconnect(reject) {
    clearTimeout(this._retry);
    if (this.device) {
      this._retries = 0; this.wantConnected = true;
      try { await this._connectGatt(); return; } catch { this._set('lost'); }
    }
    await this.pair(reject);
  }

  disconnect() {
    this.wantConnected = false;
    clearTimeout(this._retry);
    try { this.device?.gatt?.disconnect(); } catch { /* 無視 */ }
    this._set('idle');
  }
}
