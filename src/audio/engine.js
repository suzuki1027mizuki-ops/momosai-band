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
      // マイクの抜き差しだけで再接続する（「PC で再生中の音」の共有が終わったあとに、プロジェクターをつないだなどで
      // 勝手にマイクに切り替わらないように）
      this._onDeviceChange = () => { if (this.opts.source === 'mic' && (this.status === 'lost' || this.status === 'reconnecting')) this._tryReconnect(); };
      this._empty = new Float32Array(0);
    }

    on(fn) { this.listeners.push(fn); }
    _set(status, message) {
      this.status = status;
      this.message = message || '';
      for (const fn of this.listeners) { try { fn(status, this.message); } catch (e) { /* noop */ } }
    }

    get sampleRate() { return this._tap ? this._tap.sr : this.ctx ? this.ctx.sampleRate : 48000; }
    get running() { return this.status === 'running'; }

    /** AudioContext と固定のグラフ（解析・メーター・出力先）を用意 */
    _ensureContext() {
      if (this.ctx && this.ctx.state !== 'closed') return this.ctx;
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) throw new Error(VJ.t('このブラウザは Web Audio に対応していません'));
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

    /** トラックの音を、AudioContext を通さずにそのまま読む（「PC で再生中の音」用。理由は _startDisplay）。
     *  届いた分は tap.pend にためておき、pull() が描画フレームごとに取り出す */
    _startTap(track, sampleRate) {
      // 描画が止まっても取りこぼさないよう、N サンプルぶん（約 0.68 秒）まではブラウザ側にためられるようにする
      const proc = new MediaStreamTrackProcessor({ track, maxBufferSize: 96 });
      const reader = proc.readable.getReader();
      const tap = (this._tap = {
        reader, sr: sampleRate || 48000, ch: 2, stop: false, gap: false, started: performance.now(), lastIn: 0, lastFeed: 0,
        pend: new Float32Array(N), pn: 0,
        l: new Float32Array(4096), r: new Float32Array(4096),
        ml: new Float32Array(1024), mr: new Float32Array(1024),
      });
      (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            // 1 かたまりの読み取りに失敗しても、読み続ける
            try { if (!tap.stop) this._tapFrame(tap, value); } catch (e) { this.diag.gaps++; tap.gap = true; } finally { value.close(); }
            if (tap.stop) break;
          }
        } catch (e) { /* トラックが止まった */ }
        // 自分で止めたのでなければ、共有が終わったと知らせる（「動作中」のまま音が来ない状態にしない）
        if (!tap.stop && this._tap === tap) this._displayEnded();
      })();
    }

    /** 届いた 1 かたまり（AudioData）を、チャンネルの選択に合わせて 1 本にして pend へ。メーター用に左右も残す */
    _tapFrame(tap, d) {
      const n = d.numberOfFrames, ch = d.numberOfChannels;
      if (!n) return;
      tap.lastIn = performance.now();
      tap.sr = d.sampleRate;
      tap.ch = ch;
      if (ch !== this.channels) { this.channels = ch; this.meter.mono = ch < 2; }
      if (tap.l.length < n) { tap.l = new Float32Array(n); tap.r = new Float32Array(n); }
      const l = tap.l.subarray(0, n), r = tap.r.subarray(0, n);
      d.copyTo(l, { planeIndex: 0, format: 'f32-planar' });
      if (ch > 1) d.copyTo(r, { planeIndex: 1, format: 'f32-planar' });
      const keep = (dst, src) => { const k = Math.min(n, dst.length); dst.copyWithin(0, k); dst.set(src.subarray(n - k), dst.length - k); };
      keep(tap.ml, l);
      if (ch > 1) keep(tap.mr, r);
      // あふれたら（描画が 0.68 秒以上止まった）古い分を捨てて、解析をやり直してもらう
      const pend = tap.pend, m = Math.min(n, pend.length);
      if (tap.pn + m > pend.length) { const drop = tap.pn + m - pend.length; pend.copyWithin(0, drop, tap.pn); tap.pn -= drop; tap.gap = true; }
      const sel = ch > 1 ? this.opts.channel : 'left', o = tap.pn, s = n - m;
      if (sel === 'left') for (let i = 0; i < m; i++) pend[o + i] = l[s + i];
      else if (sel === 'right') for (let i = 0; i < m; i++) pend[o + i] = r[s + i];
      else for (let i = 0; i < m; i++) pend[o + i] = 0.5 * (l[s + i] + r[s + i]);
      tap.pn += m;
    }

    _resume() {
      const now = performance.now();
      if (!this.ctx || now - this._watch.lastResume < 500) return;
      this._watch.lastResume = now;
      this.ctx.resume().catch(() => {});
    }

    /** 入力を開始。source: 'mic' | 'demo'（demo: band / sing / speech）| 'file' | 'display' | 'buffer' */
    async start(opts) {
      Object.assign(this.opts, opts || {});
      // 開始の番号：共有の画面・マイクの許可を待っている間に、止めた・別の入力を始めたときは、あとから来た結果を捨てる
      const token = (this._startToken = (this._startToken || 0) + 1);
      this._set('starting');
      this._playToken = (this._playToken || 0) + 1;
      this._nextDecoded = null;
      this._stopSource();
      // 「PC で再生中の音」は AudioContext を使わない（作らない）。理由は _startDisplay
      const tapMode = this.opts.source === 'display' && typeof globalThis.MediaStreamTrackProcessor === 'function';
      const ctx = tapMode ? null : this._ensureContext();
      if (ctx) { try { await ctx.resume(); } catch (e) { /* noop */ } }
      try {
        if (this.opts.source === 'mic') {
          await this._startMic(this.opts.deviceId, token);
        } else if (this.opts.source === 'demo') {
          const kind = this.opts.demo || 'band';
          const s = kind === 'sing' || kind === 'speech' ? VJ.voiceSynth.demo(kind, ctx.sampleRate) : VJ.synth.demoSong(ctx.sampleRate);
          const ab = ctx.createBuffer(1, s.samples.length, ctx.sampleRate);
          ab.copyToChannel(s.samples, 0);
          this._startBuffer(ab, true);
        } else if (this.opts.source === 'file') {
          const files = this.opts.files && this.opts.files.length ? this.opts.files
            : this.opts.fileData ? [{ name: VJ.t('音声ファイル'), data: this.opts.fileData }] : [];
          if (!files.length) throw new Error(VJ.t('音声ファイルを選んでください'));
          this.playlist = files;
          await this._playFile(0);
          return 0;
        } else if (this.opts.source === 'display') {
          await this._startDisplay(tapMode, token);
        } else if (this.opts.source === 'buffer') {
          return this._startBuffer(this.opts.audioBuffer, !!this.opts.loop, this.opts.when);
        }
        this._set('running');
      } catch (e) {
        if (e && e.name === 'Superseded') return 0; // あとから始めた・止めた方が優先
        if (token !== this._startToken) return 0;
        this._set('error', describeError(e));
        throw e;
      }
      return 0;
    }

    /** 許可・共有を待っている間に start / stop がもう一度呼ばれていたら、受け取った入力を止めて Superseded を投げる */
    _checkToken(token, stream) {
      if (token === undefined || token === this._startToken) return;
      if (stream) for (const t of stream.getTracks()) t.stop();
      const e = new Error('superseded');
      e.name = 'Superseded';
      throw e;
    }

    async _startMic(deviceId, token) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(VJ.t('マイク入力が使えません（Chrome で開いてください）'));
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
      this._checkToken(token, stream);
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

    /** プレイリストの i 曲目を再生（1 曲ならループ。複数なら終わったら次へ、最後の次は最初へ） */
    async _playFile(i) {
      const list = this.playlist, ctx = this.ctx;
      const token = (this._playToken = (this._playToken || 0) + 1);
      const item = list[i % list.length];
      const ab = this._nextDecoded && this._nextDecoded.i === i ? await this._nextDecoded.p : await ctx.decodeAudioData(item.data.slice(0));
      if (token !== this._playToken) return;
      this._stopSource();
      this._startBuffer(ab, list.length === 1);
      this.nowPlaying = item.name;
      this.playIdx = i % list.length;
      this._set('running', list.length > 1 ? `▶ ${i % list.length + 1}/${list.length} ${item.name}` : '');
      if (list.length > 1) {
        const src = this.bufferSrc;
        const next = (i + 1) % list.length;
        // 次の曲を先にデコードしておく（曲間を短く）
        const p = ctx.decodeAudioData(list[next].data.slice(0));
        p.catch(() => {});
        this._nextDecoded = { i: next, p };
        src.onended = () => { if (this.bufferSrc === src && this.status === 'running') this._playFile(next).catch((e) => this._set('error', describeError(e))); };
      }
    }

    /** 次の曲へ（プレイリスト） */
    skipFile(d) {
      if (!this.playlist || this.opts.source !== 'file' || !this.bufferSrc) return false;
      const n = this.playlist.length;
      this._playFile((((this.playIdx || 0) + (d || 1)) % n + n) % n).catch((e) => this._set('error', describeError(e)));
      return true;
    }

    /** PC で再生中の音（画面共有の音声）。映像は使わないが、止めると共有自体が終わる環境があるので最小設定で残す。
     *
     *  tap = true（Chrome / Edge）：AudioContext を通さず、トラックから直接サンプルを読む。
     *  実機（Windows 11・Chrome 154・既定の再生デバイスが内蔵スピーカー）では、同じ Chrome が先に音の出力
     *  デバイスを開いていると、システム音声の取り込みが無音になった（トラックが muted のまま。出力を閉じて
     *  30 秒待っても戻らない。ヘッドホン端子が既定のときは起きなかった）。AudioContext は動かすだけで出力
     *  デバイスを開くので、この入力では使わない。「出力先なし」の AudioContext（sinkId: none）は出力を
     *  開かないが、描画で忙しいページでは時計が実時間の 65% ほどでしか進まず、音が間引かれてテンポがずれる
     *  （実測）ので使えない */
    async _startDisplay(tap, token) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        throw new Error(VJ.t('この環境では「PC で再生中の音」を使えません（Chrome / Edge で開いてください）'));
      }
      // Windows は PC 全体の音を取り込めるので、共有の画面を「画面全体」から開く（Mac はタブの音だけなので既定のまま）
      const video = { frameRate: 1, width: { max: 320 }, height: { max: 240 } };
      if (VJ.compat && VJ.compat.windows) video.displaySurface = 'monitor';
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        systemAudio: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'include',
      });
      this._checkToken(token, stream);
      const track = stream.getAudioTracks()[0];
      if (!track) {
        for (const t of stream.getTracks()) t.stop();
        const e = new Error(VJ.t('音声が共有されていません。共有の画面で「システムの音声を含めて共有する」（タブの場合は「タブの音声を含めて共有する」）をオンにしてから選び直してください。'));
        e.name = 'NoAudioShared';
        throw e;
      }
      for (const v of stream.getVideoTracks()) v.onended = () => this._displayEnded();
      this.stream = stream;
      const st = track.getSettings ? track.getSettings() : {};
      this.trackSettings = st;
      this.opts.deviceLabel = track.label || VJ.t('画面共有の音声');
      track.onended = () => this._displayEnded();
      // PC 全体の音（システム音声）が止められている（muted）ときは、原因と直し方を出す
      if (/loopback/i.test(String(st.deviceId || ''))) {
        const tell = () => {
          if (this.stream !== stream || this.status !== 'running') return;
          const msg = track.muted ? VJ.t('PC の音が届いていません。VJ をすべて閉じて開き直し、最初に「PC で再生中の音」を始めてください（先にほかの入力を始めていると、取り込めないことがあります）。') : '';
          if (msg !== this.message) this._set('running', msg);
        };
        track.onmute = tell;
        track.onunmute = tell;
        setTimeout(tell, 1500);
      }
      this.channels = st.channelCount || 2;
      this.meter.mono = this.channels < 2;
      this.hasTail = false;
      if (tap) { this._startTap(track, st.sampleRate); return; }
      this.srcNode = this.ctx.createMediaStreamSource(stream);
      this._route(this.srcNode, false);
    }

    _displayEnded() {
      if (this.opts.source !== 'display' || this.status === 'idle') return;
      this._set('lost', VJ.t('画面共有が終了しました。もう一度「▶ 開始」を押して共有し直してください。'));
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
      if (this._tap) { this._tap.stop = true; try { this._tap.reader.cancel().catch(() => {}); } catch (e) { /* noop */ } }
      this._tap = null;
      if (this.stream) for (const t of this.stream.getTracks()) { t.onended = t.onmute = t.onunmute = null; t.stop(); }
      this.stream = null;
      for (const n of [this.splitter, this.mixGain, this.selL, this.selR]) { if (n) try { n.disconnect(); } catch (e) { /* noop */ } }
      this.splitter = this.mixGain = this.selL = this.selR = null;
    }

    stop() {
      this._playToken = (this._playToken || 0) + 1;
      this._startToken = (this._startToken || 0) + 1;
      this._stopSource();
      this._set('idle');
    }

    _lost() {
      if (this.opts.source !== 'mic') return;
      this._set('lost', VJ.t('入力デバイスが切断されました。再接続を試みています…'));
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
        this._set('running', VJ.t('再接続しました'));
      } catch (e) {
        this._set('lost', VJ.t('入力デバイスが見つかりません。接続を確認してください（自動で再試行中）'));
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
      const tap = this._tap;
      if (tap) {
        // トラックから直接読んでいるとき：たまっている分をそのまま渡す（位置合わせは要らない）
        if (this.status !== 'running' && this.status !== 'lost') { out.samples = this._empty; out.gapped = false; this.hasTail = false; tap.pn = 0; return out; }
        // 音が届かない（共有が終わった・止められた）間は、無音として進める。解析が「大きい音」のまま止まって、
        // 映像が盛り上がったまま・タイトルにも戻らない、とならないように
        const nowMs = performance.now();
        if (tap.pn > 0) tap.lastFeed = nowMs;
        else if (this.status === 'lost' || nowMs - (tap.lastIn || tap.started || nowMs) > 150) {
          const z = Math.min(N >> 1, Math.round(((nowMs - (tap.lastFeed || nowMs)) * tap.sr) / 1000));
          if (z > 0) { tap.pend.fill(0, 0, z); tap.pn = z; }
          tap.lastFeed = nowMs;
        }
        const n = tap.pn, buf = this.buf;
        const gapped = tap.gap || !this.hasTail;
        buf.copyWithin(0, n);
        buf.set(tap.pend.subarray(0, n), N - n);
        tap.pn = 0;
        tap.gap = false;
        if (gapped && this.hasTail) this.diag.gaps++;
        this.hasTail = true;
        if (n > 0) { this.diag.chunk = n; if (n > this.diag.chunkMax) this.diag.chunkMax = n; }
        out.samples = gapped ? this._empty : buf.subarray(N - n);
        out.gapped = gapped;
        return out;
      }
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
      const tap = this._tap;
      if (!tap && (!this.anL || !(this.srcNode || this.bufferSrc))) {
        this.meter.l = this.meter.r = -120;
        return this.meter;
      }
      const m = this.meter;
      let b = this.meterBuf;
      // src：AnalyserNode か、トラックから読んだ直近のサンプル（Float32Array）
      const calc = (src) => {
        if (tap) b = src; else src.getFloatTimeDomainData(b);
        let s = 0, p = 0;
        for (let i = 0; i < b.length; i++) { const v = b[i]; s += v * v; const a = v < 0 ? -v : v; if (a > p) p = a; }
        return [VJ.util.powToDb(s / b.length), p];
      };
      const [l, lp] = calc(tap ? tap.ml : this.anL);
      const [r, rp] = this.meter.mono ? [-120, 0] : calc(tap ? tap.mr : this.anR);
      m.l = l; m.r = r;
      m.lPeak = Math.max(VJ.util.linToDb(lp), m.lPeak - 1.5);
      m.rPeak = Math.max(VJ.util.linToDb(rp), m.rPeak - 1.5);
      if (lp >= 0.999 || rp >= 0.999) m.clip = performance.now();
      return m;
    }

    /** 毎フレーム呼ぶ見張り：停止したら resume、時間が進まなければ作り直す */
    watchdog(perfNow) {
      const ctx = this.ctx;
      // トラックから直接読んでいるとき（PC で再生中の音）は AudioContext を使っていない
      if (!ctx || this._tap || this.status === 'idle' || this.status === 'error' || this.status === 'starting') return;
      if (ctx.state === 'suspended' || ctx.state === 'interrupted') { this._resume(); return; }
      if (ctx.state !== 'running') return;
      const w = this._watch;
      if (ctx.currentTime !== w.t) { w.t = ctx.currentTime; w.perf = perfNow; return; }
      if (perfNow - w.perf > 1500 && !this._restarting) {
        w.perf = perfNow;
        this.restart(VJ.t('音声処理が停止したため再起動しました'));
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
        sampleRate: this._tap ? this._tap.sr : ctx ? ctx.sampleRate : 0,
        baseLatency: ctx && ctx.baseLatency !== undefined ? ctx.baseLatency : null,
        outputLatency: ctx && ctx.outputLatency !== undefined ? ctx.outputLatency : null,
        trackLatency: this.trackSettings && this.trackSettings.latency !== undefined ? this.trackSettings.latency : null,
        channels: this.channels,
        device: this.opts.source === 'file' ? (this.nowPlaying || VJ.t('音声ファイル')) : this.opts.source === 'demo' ? VJ.t('デモ音源') + ({ sing: VJ.t('（歌）'), speech: VJ.t('（話し声）') }[this.opts.demo] || '')
          : this.opts.deviceLabel || (this.opts.source === 'mic' ? VJ.t('既定のデバイス') : this.opts.source),
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
    if (name === 'NoAudioShared') return e.message;
    if ((name === 'NotAllowedError' || name === 'AbortError') && e && /display|screen|share/i.test(String(e.message))) return VJ.t('画面共有がキャンセルされました。もう一度「▶ 開始」を押して、共有する画面（またはタブ）と音声を選んでください。');
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return VJ.t('マイクの使用が許可されていません。アドレスバー左のアイコン →「マイク」を「許可」にしてから、もう一度お試しください。')
        + VJ.t('（Mac: システム設定 > プライバシーとセキュリティ > マイク で Chrome を許可 / Windows: 設定 > プライバシー > マイク でデスクトップアプリのアクセスを許可）');
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return VJ.t('入力デバイスが見つかりません。オーディオインターフェースやマイクの接続を確認してください。');
    if (name === 'NotReadableError' || name === 'AbortError') return VJ.t('入力デバイスを開けません。ほかのアプリ（Zoom・DAW など）がデバイスを使っていないか確認して、閉じてから再試行してください。');
    if (name === 'NotSupportedError' || name === 'TypeError') return VJ.t('この環境ではマイクを使えません。Chrome で開き直してください（file:// で開いている場合は start-windows.bat / start-mac.command から起動）。');
    if (name === 'EncodingError') return VJ.t('音声ファイルを読み込めません（mp3 / wav / m4a などを選んでください）。');
    return (e && e.message) || String(e);
  }

  VJ.AudioEngine = AudioEngine;
  VJ.describeAudioError = describeError;
})(globalThis.VJ = globalThis.VJ || {});
