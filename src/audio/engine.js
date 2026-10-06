/* AudioEngine：入力（マイク/ライン・デモ・音声ファイル）→ AnalyserNode。
 *
 * 低遅延のための方針
 *  - getUserMedia の echoCancellation / noiseSuppression / autoGainControl はすべて OFF
 *    （WebRTC の音声処理を通さない。立ち上がりも潰さない）
 *  - AudioContext は latencyHint:'interactive'。sampleRate は指定しない（余計なリサンプルを避ける）
 *  - AnalyserNode（smoothing 0）を描画フレームごとに同期読み出し。AudioWorklet / SharedArrayBuffer は
 *    file:// で使えないうえ、データの新しさは同じなので使わない
 *  - 新しく届いた分だけを DSP に渡す。前回の末尾 32 サンプルと完全一致する位置を探して
 *    取りこぼし・二重処理をなくす（見つからなければ currentTime の差から推定）
 *
 * マイク音は絶対にスピーカーへ出さない（Gain 0 経由で destination につなぐのは処理を確実に回すため）。 */
(function (VJ) {
  'use strict';

  const N = 32768; // Analyser の長さ（48kHz で約 0.68 秒分。描画が一瞬止まっても取りこぼさない）
  const K = 32; // 位置合わせに使う末尾サンプル数
  const Q = 128; // レンダー量子

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.status = 'idle'; // idle | starting | running | lost | reconnecting | error
      this.message = '';
      this.listeners = [];
      this.opts = { source: 'mic', deviceId: '', deviceLabel: '', channel: 'mix', monitor: true };
      this.buf = new Float32Array(N);
      this.tail = new Float32Array(K);
      this.hasTail = false;
      this.lastT = 0;
      this.stream = null;
      this.srcNode = null;
      this.bufferSrc = null;
      this.channels = 0;
      this.meter = { l: -120, r: -120, lPeak: -120, rPeak: -120, clip: 0, mono: false };
      this.meterBuf = new Float32Array(1024);
      this.diag = { chunk: 0, chunkMax: 0, align: 0, alignMiss: 0, gaps: 0, restarts: 0, reconnects: 0 };
      this._watch = { t: -1, perf: 0, lastResume: 0 };
      this._reconnectTimer = null;
      this._onDeviceChange = () => { if (this.status === 'lost' || this.status === 'reconnecting') this._tryReconnect(); };
      this._empty = new Float32Array(0);
    }

    on(fn) { this.listeners.push(fn); }
    _set(status, message) {
      this.status = status;
      this.message = message || '';
      for (const fn of this.listeners) { try { fn(status, this.message); } catch (e) { /* noop */ } }
    }

    get sampleRate() { return this.ctx ? this.ctx.sampleRate : 48000; }
    get running() { return this.status === 'running'; }

    /** AudioContext と固定のグラフ（解析・メーター・出力先）を用意 */
    _ensureContext() {
      if (this.ctx && this.ctx.state !== 'closed') return this.ctx;
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) throw new Error('このブラウザは Web Audio に対応していません');
      const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
      const an = (this.analyser = ctx.createAnalyser());
      an.fftSize = N;
      an.smoothingTimeConstant = 0;
      an.channelCount = 1;
      an.channelCountMode = 'explicit';
      an.channelInterpretation = 'speakers';
      this.anL = ctx.createAnalyser(); this.anL.fftSize = 2048; this.anL.smoothingTimeConstant = 0;
      this.anR = ctx.createAnalyser(); this.anR.fftSize = 2048; this.anR.smoothingTimeConstant = 0;
      this.sink = ctx.createGain();
      this.sink.gain.value = 0;
      for (const a of [an, this.anL, this.anR]) a.connect(this.sink);
      this.sink.connect(ctx.destination);
      this.monitorGain = ctx.createGain();
      this.monitorGain.gain.value = 0;
      this.monitorGain.connect(ctx.destination);
      ctx.onstatechange = () => { if (ctx.state === 'suspended' || ctx.state === 'interrupted') this._resume(); };
      this.hasTail = false;
      return ctx;
    }

    _resume() {
      const now = performance.now();
      if (!this.ctx || now - this._watch.lastResume < 500) return;
      this._watch.lastResume = now;
      this.ctx.resume().catch(() => {});
    }

    /** 入力を開始。source: 'mic' | 'demo' | 'file' | 'buffer' */
    async start(opts) {
      Object.assign(this.opts, opts || {});
      this._set('starting');
      this._stopSource();
      const ctx = this._ensureContext();
      try { await ctx.resume(); } catch (e) { /* noop */ }
      try {
        if (this.opts.source === 'mic') {
          await this._startMic(this.opts.deviceId);
        } else if (this.opts.source === 'demo') {
          const s = VJ.synth.demoSong(ctx.sampleRate);
          const ab = ctx.createBuffer(1, s.samples.length, ctx.sampleRate);
          ab.copyToChannel(s.samples, 0);
          this._startBuffer(ab, true);
        } else if (this.opts.source === 'file') {
          const ab = await ctx.decodeAudioData(this.opts.fileData.slice(0));
          this._startBuffer(ab, true);
        } else if (this.opts.source === 'buffer') {
          return this._startBuffer(this.opts.audioBuffer, !!this.opts.loop, this.opts.when);
        }
        this._set('running');
      } catch (e) {
        this._set('error', describeError(e));
        throw e;
      }
      return 0;
    }

    async _startMic(deviceId) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('マイク入力が使えません（Chrome で開いてください）');
      }
      const base = {
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        channelCount: { ideal: 2 }, latency: { ideal: 0 },
      };
      let stream = null;
      if (deviceId) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: Object.assign({ deviceId: { exact: deviceId } }, base) });
        } catch (e) {
          if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e;
          stream = null; // 指定デバイスが無い → 既定へ
        }
      }
      if (!stream) stream = await navigator.mediaDevices.getUserMedia({ audio: base });
      this.stream = stream;
      const track = stream.getAudioTracks()[0];
      const st = track.getSettings ? track.getSettings() : {};
      this.opts.deviceId = st.deviceId || deviceId || '';
      this.opts.deviceLabel = track.label || '';
      this.trackSettings = st;
      track.onended = () => this._lost();
      const ctx = this.ctx;
      this.srcNode = ctx.createMediaStreamSource(stream);
      this.channels = st.channelCount || 2;
      this._route(this.srcNode, false);
      if (navigator.mediaDevices.addEventListener) {
        navigator.mediaDevices.removeEventListener('devicechange', this._onDeviceChange);
        navigator.mediaDevices.addEventListener('devicechange', this._onDeviceChange);
      }
    }

    _startBuffer(audioBuffer, loop, when) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = audioBuffer;
      src.loop = !!loop;
      this.bufferSrc = src;
      this.channels = audioBuffer.numberOfChannels;
      this.trackSettings = { sampleRate: audioBuffer.sampleRate, channelCount: audioBuffer.numberOfChannels };
      this._route(src, true);
      const t = when || ctx.currentTime + 0.02;
      src.start(t);
      this._set('running');
      return t;
    }

    _route(node, isPlayback) {
      const ctx = this.ctx;
      this.splitter = ctx.createChannelSplitter(2);
      this.mixGain = ctx.createGain();
      this.selL = ctx.createGain();
      this.selR = ctx.createGain();
      node.connect(this.splitter);
      node.connect(this.mixGain);
      this.splitter.connect(this.anL, 0);
      this.splitter.connect(this.anR, 1);
      this.splitter.connect(this.selL, 0);
      this.splitter.connect(this.selR, 1);
      this.mixGain.connect(this.analyser);
      this.selL.connect(this.analyser);
      this.selR.connect(this.analyser);
      if (isPlayback) node.connect(this.monitorGain);
      this.meter.mono = this.channels < 2;
      this.setChannel(this.opts.channel);
      this.setMonitor(this.opts.monitor);
      this.hasTail = false;
    }

    setChannel(ch) {
      this.opts.channel = ch === 'left' || ch === 'right' ? ch : 'mix';
      if (!this.mixGain) return;
      const mono = this.channels < 2;
      this.mixGain.gain.value = this.opts.channel === 'mix' || mono ? 1 : 0;
      this.selL.gain.value = this.opts.channel === 'left' && !mono ? 1 : 0;
      this.selR.gain.value = this.opts.channel === 'right' && !mono ? 1 : 0;
    }

    setMonitor(on) {
      this.opts.monitor = !!on;
      if (this.monitorGain) this.monitorGain.gain.value = on && this.bufferSrc ? 1 : 0;
    }

    _stopSource() {
      clearTimeout(this._reconnectTimer);
      if (this.bufferSrc) { try { this.bufferSrc.stop(); } catch (e) { /* noop */ } try { this.bufferSrc.disconnect(); } catch (e) { /* noop */ } }
      this.bufferSrc = null;
      if (this.srcNode) { try { this.srcNode.disconnect(); } catch (e) { /* noop */ } }
      this.srcNode = null;
      if (this.stream) for (const t of this.stream.getTracks()) { t.onended = null; t.stop(); }
      this.stream = null;
      for (const n of [this.splitter, this.mixGain, this.selL, this.selR]) { if (n) try { n.disconnect(); } catch (e) { /* noop */ } }
      this.splitter = this.mixGain = this.selL = this.selR = null;
    }

    stop() {
      this._stopSource();
      this._set('idle');
    }

    _lost() {
      if (this.opts.source !== 'mic') return;
      this._set('lost', '入力デバイスが切断されました。再接続を試みています…');
      this._scheduleReconnect(300);
    }

    _scheduleReconnect(ms) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = setTimeout(() => this._tryReconnect(), ms);
    }

    async _tryReconnect() {
      if (this._reconnecting) return;
      this._reconnecting = true;
      this.status = 'reconnecting';
      try {
        let id = this.opts.deviceId;
        // 同じ ID が無ければ同じ名前のデバイスを探す
        const devs = await this.listDevices();
        if (!devs.some((d) => d.deviceId === id)) {
          const same = devs.find((d) => d.label && d.label === this.opts.deviceLabel);
          id = same ? same.deviceId : '';
        }
        this._stopSource();
        await this._startMic(id);
        this.diag.reconnects++;
        this._set('running', '再接続しました');
      } catch (e) {
        this._set('lost', '入力デバイスが見つかりません。接続を確認してください（自動で再試行中）');
        this._scheduleReconnect(1000);
      } finally {
        this._reconnecting = false;
      }
    }

    async listDevices() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter((d) => d.kind === 'audioinput');
    }

    /**
     * 新しく届いたサンプルを返す。
     * @returns {{samples: Float32Array, gapped: boolean}} gapped=true なら連続性が失われた（DSP を resync）
     */
    pull() {
      const out = this._pullOut || (this._pullOut = { samples: this._empty, gapped: false });
      const ctx = this.ctx, an = this.analyser;
      if (!ctx || !an || !this.status || (this.status !== 'running' && this.status !== 'lost' && this.status !== 'reconnecting')) {
        out.samples = this._empty; out.gapped = false; this.hasTail = false;
        return out;
      }
      const t = ctx.currentTime;
      const buf = this.buf;
      an.getFloatTimeDomainData(buf);
      const sr = ctx.sampleRate;
      const expected = Math.max(0, Math.round(((t - this.lastT) * sr) / Q) * Q);
      let n = expected;
      let gapped = !this.hasTail;
      if (this.hasTail) {
        let energy = 0;
        for (let i = 0; i < K; i++) energy += Math.abs(this.tail[i]);
        if (energy > 1e-6) {
          const c = this._align(expected);
          if (c >= 0) { n = c; this.diag.align++; } else { this.diag.alignMiss++; if (expected >= N - K) gapped = true; }
        }
        if (n > N - K) gapped = true;
      }
      if (gapped && this.hasTail) this.diag.gaps++;
      this.lastT = t;
      this.tail.set(buf.subarray(N - K));
      this.hasTail = true;
      if (n > 0) {
        this.diag.chunk = n;
        if (n > this.diag.chunkMax) this.diag.chunkMax = n;
      }
      out.samples = gapped ? this._empty : buf.subarray(N - n);
      out.gapped = gapped;
      return out;
    }

    /** 前回末尾が今回のどこにあるか（新規サンプル数）。見つからなければ -1 */
    _align(expected) {
      const buf = this.buf, tail = this.tail;
      const maxC = N - K;
      const match = (c) => {
        const pos = N - c - K;
        for (let i = 0; i < K; i++) if (buf[pos + i] !== tail[i]) return false;
        return true;
      };
      // 期待値に近い順に 128 刻みで探す
      for (let d = 0; d <= maxC; d += Q) {
        const a = expected - d, b = expected + d;
        if (a >= 0 && a <= maxC && match(a)) return a;
        if (d > 0 && b <= maxC && match(b)) return b;
      }
      return -1;
    }

    /** 最新 N サンプル（pull 後に有効） */
    latest() { return this.buf; }

    /** メーター更新（30Hz 程度で呼ぶ） */
    updateMeters() {
      if (!this.anL || !(this.srcNode || this.bufferSrc)) {
        this.meter.l = this.meter.r = -120;
        return this.meter;
      }
      const m = this.meter, b = this.meterBuf;
      const calc = (an) => {
        an.getFloatTimeDomainData(b);
        let s = 0, p = 0;
        for (let i = 0; i < b.length; i++) { const v = b[i]; s += v * v; const a = v < 0 ? -v : v; if (a > p) p = a; }
        return [VJ.util.powToDb(s / b.length), p];
      };
      const [l, lp] = calc(this.anL);
      const [r, rp] = this.meter.mono ? [-120, 0] : calc(this.anR);
      m.l = l; m.r = r;
      m.lPeak = Math.max(VJ.util.linToDb(lp), m.lPeak - 1.5);
      m.rPeak = Math.max(VJ.util.linToDb(rp), m.rPeak - 1.5);
      if (lp >= 0.999 || rp >= 0.999) m.clip = performance.now();
      return m;
    }

    /** 毎フレーム呼ぶ見張り：停止したら resume、時間が進まなければ作り直す */
    watchdog(perfNow) {
      const ctx = this.ctx;
      if (!ctx || this.status === 'idle' || this.status === 'error' || this.status === 'starting') return;
      if (ctx.state === 'suspended' || ctx.state === 'interrupted') { this._resume(); return; }
      if (ctx.state !== 'running') return;
      const w = this._watch;
      if (ctx.currentTime !== w.t) { w.t = ctx.currentTime; w.perf = perfNow; return; }
      if (perfNow - w.perf > 1500 && !this._restarting) {
        w.perf = perfNow;
        this.restart('音声処理が停止したため再起動しました');
      }
    }

    /** AudioContext ごと作り直す（ソフトリセット） */
    async restart(reason) {
      this._restarting = true;
      this.diag.restarts++;
      try {
        const opts = Object.assign({}, this.opts);
        this._stopSource();
        if (this.ctx) { try { await this.ctx.close(); } catch (e) { /* noop */ } }
        this.ctx = null;
        await this.start(opts);
        if (reason) this.message = reason;
      } catch (e) {
        this._set('error', describeError(e));
      } finally {
        this._restarting = false;
      }
    }

    diagnostics() {
      const ctx = this.ctx;
      return {
        status: this.status,
        sampleRate: ctx ? ctx.sampleRate : 0,
        baseLatency: ctx && ctx.baseLatency !== undefined ? ctx.baseLatency : null,
        outputLatency: ctx && ctx.outputLatency !== undefined ? ctx.outputLatency : null,
        trackLatency: this.trackSettings && this.trackSettings.latency !== undefined ? this.trackSettings.latency : null,
        channels: this.channels,
        device: this.opts.deviceLabel || (this.opts.source === 'mic' ? '既定のデバイス' : this.opts.source),
        chunk: this.diag.chunk,
        chunkMax: this.diag.chunkMax,
        align: this.diag.align,
        alignMiss: this.diag.alignMiss,
        gaps: this.diag.gaps,
        restarts: this.diag.restarts,
        reconnects: this.diag.reconnects,
      };
    }
  }

  function describeError(e) {
    const name = (e && e.name) || '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return 'マイクの使用が許可されていません。アドレスバー左のアイコン →「マイク」を「許可」にしてから、もう一度お試しください。'
        + '（Mac: システム設定 > プライバシーとセキュリティ > マイク で Chrome を許可 / Windows: 設定 > プライバシー > マイク でデスクトップアプリのアクセスを許可）';
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return '入力デバイスが見つかりません。オーディオインターフェースやマイクの接続を確認してください。';
    if (name === 'NotReadableError' || name === 'AbortError') return '入力デバイスを開けません。ほかのアプリ（Zoom・DAW など）がデバイスを使っていないか確認して、閉じてから再試行してください。';
    if (name === 'NotSupportedError' || name === 'TypeError') return 'この環境ではマイクを使えません。Chrome で開き直してください（file:// で開いている場合は start-windows.bat / start-mac.command から起動）。';
    if (name === 'EncodingError') return '音声ファイルを読み込めません（mp3 / wav / m4a などを選んでください）。';
    return (e && e.message) || String(e);
  }

  VJ.AudioEngine = AudioEngine;
  VJ.describeAudioError = describeError;
})(globalThis.VJ = globalThis.VJ || {});
