/* MOMOSAI VJ 単体アプリ（Electron）。中身は配布版と同じ momosai-vj.html で、ブラウザ版の制約をアプリ側で解消する：
 *   - マイク・MIDI・USB-DMX の許可確認を出さない（毎回「許可」を押さなくてよい）
 *   - 出力ウィンドウ（2 画面）をプロジェクター側の画面に開いて自動で全画面にする
 *   - 「PC で再生中の音」：画面を選ぶ画面を出さずに PC 全体の音を取り込む（Windows。Mac は OS の対応による）
 *   - ブリッジ（スマホ操作・OSC・Art-Net）を内蔵して自動でつなぐ
 *   - 画面のスリープ防止・裏に回っても描画を間引かない
 * 環境変数 MOMOSAI_SMOKE=1 のときは、偽のマイクで起動して自己診断し、結果を表示して終了する（テスト用）。 */
'use strict';
const { app, BrowserWindow, session, screen, desktopCapturer, powerSaveBlocker, dialog, Menu, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SMOKE = !!process.env.MOMOSAI_SMOKE;
const WEB = path.join(__dirname, 'web');
const ALLOWED = new Set(['media', 'midi', 'fullscreen', 'display-capture', 'window-management', 'wake-lock', 'screen-wake-lock', 'serial', 'keyboardLock', 'pointerLock']);

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
// Mac：画面共有でシステムの音を取り込む（macOS 13 以降・対応する Electron のとき）
if (process.platform === 'darwin') app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride');
if (SMOKE) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
  if (process.env.MOMOSAI_FAKE_WAV) app.commandLine.appendSwitch('use-file-for-fake-audio-capture', process.env.MOMOSAI_FAKE_WAV);
  // GPU の無い CI でも WebGL2 を使う（ソフトウェア描画）
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  // 仮想ディスプレイ（xvfb）には垂直同期が無く、描画の周期が来ないため
  app.commandLine.appendSwitch('disable-gpu-vsync');
  app.commandLine.appendSwitch('disable-frame-rate-limit');
}

let bridge = null;
let mainWin = null;
const log = (...a) => { if (SMOKE || process.env.MOMOSAI_DEBUG) console.log('[app]', ...a); };

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); } });
  app.whenReady().then(start);
}

async function startBridge() {
  try {
    const mod = await import(pathToFileURL(path.join(WEB, 'bridge', 'server.mjs')).href);
    // OSC は既定でこの PC からだけ。LAN の照明卓から受けるときは MOMOSAI_OSC_LAN=1 で起動
    bridge = await mod.startBridge({ port: SMOKE ? 0 : 8787, oscPort: SMOKE ? 0 : 9000, oscHost: process.env.MOMOSAI_OSC_LAN ? '0.0.0.0' : '127.0.0.1', log });
    log('bridge', bridge.port, 'pin', bridge.pin);
  } catch (e) {
    // ポートが使われている（ブリッジを別に起動している）など。アプリはそのまま使える
    log('bridge failed:', e.message);
    bridge = null;
  }
}

function setupSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, cb) => cb(ALLOWED.has(permission)));
  ses.setPermissionCheckHandler((wc, permission) => ALLOWED.has(permission));
  ses.setDevicePermissionHandler((d) => d.deviceType === 'serial');
  // 「PC で再生中の音」：画面全体 + システムの音（ループバック）
  ses.setDisplayMediaRequestHandler((req, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      if (!sources.length) { cb({}); return; }
      const opt = { video: sources[0] };
      if (process.platform === 'win32' || process.platform === 'darwin') opt.audio = 'loopback';
      cb(opt);
    }).catch(() => cb({}));
  });
  // USB-DMX のポート選び（1 つならそれ、複数なら選ぶ）
  ses.on('select-serial-port', (event, ports, wc, cb) => {
    event.preventDefault();
    if (!ports.length) { cb(''); return; }
    if (ports.length === 1) { cb(ports[0].portId); return; }
    const win = BrowserWindow.fromWebContents(wc) || mainWin;
    dialog.showMessageBox(win, {
      type: 'question', message: 'USB-DMX のポートを選んでください',
      buttons: [...ports.map((p) => p.displayName || p.portName || p.portId), 'キャンセル'], cancelId: ports.length,
    }).then((r) => cb(r.response < ports.length ? ports[r.response].portId : '')).catch(() => cb(''));
  });
}

/** 出力ウィンドウ：プロジェクター（主画面でない方）があればそこに全画面で開く */
function outputWindowOptions() {
  const primary = screen.getPrimaryDisplay();
  const ext = screen.getAllDisplays().find((d) => d.id !== primary.id);
  const b = (ext || primary).bounds;
  return {
    x: ext ? b.x : undefined, y: ext ? b.y : undefined,
    width: ext ? b.width : 960, height: ext ? b.height : 540,
    fullscreen: !!ext, backgroundColor: '#000000', autoHideMenuBar: true, title: 'MOMOSAI VJ 出力',
    webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true },
  };
}

function createMain() {
  mainWin = new BrowserWindow({
    width: 1280, height: 800, backgroundColor: '#000000', title: 'MOMOSAI VJ', autoHideMenuBar: true,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true },
  });
  const query = { app: '1' };
  if (bridge) query.bridge = `ws://127.0.0.1:${bridge.port}/vj`;
  if (SMOKE) query.test = '1';
  mainWin.loadFile(path.join(WEB, 'momosai-vj.html'), { query });
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('file:') && url.includes('role=output')) return { action: 'allow', overrideBrowserWindowOptions: outputWindowOptions() };
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // ページ内のリンクで別のページへ移らない
  mainWin.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  mainWin.on('closed', () => { mainWin = null; });
  return mainWin;
}

function setupMenu() {
  if (process.platform !== 'darwin') { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: '表示', submenu: [{ role: 'togglefullscreen', label: '全画面' }, { role: 'reload', label: '再読み込み' }] },
    { role: 'windowMenu' },
  ]));
}

async function start() {
  setupSession();
  setupMenu();
  await startBridge();
  powerSaveBlocker.start('prevent-display-sleep');
  const win = createMain();
  if (SMOKE) smoke(win);
}

// 本番中の離脱確認（ページの beforeunload）。Electron は何も表示せずに閉じるのを取り消すので、ここで確かめる
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-prevent-unload', (e) => {
    const win = BrowserWindow.fromWebContents(wc);
    const r = dialog.showMessageBoxSync(win || undefined, {
      type: 'warning', message: '本番中です。閉じますか？', detail: '閉じると映像が止まります。',
      buttons: ['閉じる', '閉じない'], defaultId: 1, cancelId: 1, noLink: true,
    });
    if (r === 0) e.preventDefault(); // 確認を無視して閉じる
  });
});

app.on('window-all-closed', () => {
  if (bridge) bridge.close();
  app.quit();
});

/** 自己診断（MOMOSAI_SMOKE=1）：起動・マイク（偽）・描画・ブリッジ・出力ウィンドウを確かめる */
function smoke(win) {
  const done = (res) => {
    console.log('SMOKE ' + JSON.stringify(res));
    if (bridge) bridge.close();
    app.exit(res.ok ? 0 : 1);
  };
  // 時間切れのときは、どこで止まったか（window.__smoke）も出す
  const timer = setTimeout(() => {
    const t0 = Date.now();
    const ws = BrowserWindow.getAllWindows().map((w) => ({ pid: w.webContents.getOSProcessId(), visible: w.isVisible(), focused: w.isFocused() }));
    win.webContents.executeJavaScript('JSON.stringify({ stage: window.__smoke || "", beatAge: Date.now() - (window.__beat || 0), vis: document.visibilityState, focus: document.hasFocus() })', true).catch(() => '?')
      .then((stage) => done({ ok: false, error: 'timeout', stage, rtt: Date.now() - t0, windows: ws }));
  }, 60000);
  win.webContents.once('did-finish-load', async () => {
    try {
      const js = (code) => win.webContents.executeJavaScript(code, true);
      const fatal = await js(`new Promise((r) => { const t = setInterval(() => {
        const el = document.getElementById('fatal');
        if (el && !el.hidden) { clearInterval(t); r(el.textContent); }
        else if (window.VJ && VJ.app && VJ.app.renderer && VJ.panel && VJ.panel.app) { clearInterval(t); r(''); }
      }, 50); })`);
      if (fatal) throw new Error('起動できません: ' + fatal);
      const res = await js(`(async () => {
        const app = VJ.app;
        window.__smoke = 'startAudio';
        setInterval(() => { window.__beat = Date.now(); }, 200);
        await VJ.panel.startAudio({ source: 'mic' });
        window.__smoke = 'frames';
        const f0 = app.frameNo;
        await new Promise((r) => setTimeout(r, 2500));
        const out = {
          engine: app.engine.status, frames: app.frameNo - f0, level: app.lastFeatures ? app.lastFeatures.rmsDb : -999,
          failed: app.renderer.info().failed, net: VJ.net.status, pin: VJ.net.info && VJ.net.info.pin, params: VJ.params,
          visibility: document.visibilityState, focus: document.hasFocus(), raf: await new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else r(n); }; requestAnimationFrame(f); }),
        };
        window.__smoke = 'openOutput';
        VJ.link.openOutput(app);
        const tw = performance.now();
        for (let i = 0; i < 100 && !(VJ.link.lastStatus && VJ.link.lastStatus.engineStatus === 'running' && VJ.link.lastStatus.io.net.status === 'on'); i++) {
          const ls = VJ.link.lastStatus;
          window.__smoke = 'openOutput i=' + i + ' t=' + Math.round(performance.now() - tw) + ' role=' + VJ.link.role + ' peer=' + !!VJ.link.peer
            + ' closed=' + (VJ.link.peer && VJ.link.peer.closed) + ' st=' + (ls ? ls.engineStatus + '/' + (ls.io && ls.io.net.status) : '-');
          await new Promise((r) => setTimeout(r, 100));
        }
        out.role = VJ.link.role;
        out.outputStatus = VJ.link.lastStatus ? VJ.link.lastStatus.engineStatus : null;
        out.outputNet = VJ.link.lastStatus && VJ.link.lastStatus.io ? VJ.link.lastStatus.io.net.status : null;
        // 本番開始（離脱確認あり）のあとでも、操作側から出力ウィンドウを閉じて 1 画面に戻れる
        window.__smoke = 'startShow';
        await VJ.link.request({ t: 'cmd', target: 'ui', name: 'startShow', args: [] }).catch(() => {});
        window.__smoke = 'closeOutput';
        VJ.link.closeOutput();
        for (let i = 0; i < 60 && VJ.link.role !== 'solo'; i++) await new Promise((r) => setTimeout(r, 100));
        out.afterClose = VJ.link.role;
        return out;
      })()`);
      res.windows = BrowserWindow.getAllWindows().length;
      // 2 つ目のウィンドウは、上の「閉じる」で閉じているはず
      res.ok2 = res.afterClose === 'solo' && res.windows === 1;
      res.bridgePin = bridge ? bridge.pin : null;
      res.ok = res.engine === 'running' && res.frames > 30 && (!process.env.MOMOSAI_FAKE_WAV || res.level > -60) && res.failed.length === 0 && res.net === 'on' && res.pin === res.bridgePin
        && res.ok2 && res.role === 'control' && res.outputStatus === 'running' && res.outputNet === 'on';
      clearTimeout(timer);
      done(res);
    } catch (e) {
      clearTimeout(timer);
      done({ ok: false, error: String(e && e.stack || e) });
    }
  });
}
