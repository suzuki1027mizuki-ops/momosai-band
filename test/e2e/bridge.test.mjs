// ブリッジを実際に起動して、VJ 本体（dist）とスマホの操作画面（remote.html）をつなぐ
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { launch, openApp, DIST } from '../helpers/browser.mjs';
import { startBridge, oscMessage } from '../../bridge/server.mjs';

let browser, bridge;
before(async () => {
  browser = await launch();
  bridge = await startBridge({ port: 0, oscPort: 0, pin: '2468' });
});
after(async () => { bridge.close(); await browser.close(); });

test('スマホの操作画面から暗証番号でつなぎ、シーン・暗転・曲送りを操作できる。状態がスマホに表示される。OSC でも操作できる', async () => {
  const { page, errors } = await openApp(browser, DIST, '', { width: 1000, height: 700 });
  // VJ 本体：設定パネル ⑦ でブリッジにつなぐ。鍵なしのアドレスでは、暗証番号はパネルに出さない（ブリッジの画面で見る）
  const setUrl = (url) => page.evaluate((url) => { document.getElementById('net-url').value = url; document.getElementById('net-url').dispatchEvent(new Event('change')); }, url);
  await setUrl(`ws://127.0.0.1:${bridge.port}/vj`);
  await page.check('#net-on');
  await page.waitForFunction(() => VJ.net.status === 'on' && VJ.net.info, null, { timeout: 10000 });
  await page.waitForFunction(() => /ブリッジの画面に出ている暗証番号/.test(document.getElementById('net-status').textContent), null, { timeout: 5000 });
  assert.doesNotMatch(await page.textContent('#net-status'), /2468/);
  // ブリッジの画面に出る鍵つきのアドレスにすると、パネルにも出る
  await setUrl(`ws://127.0.0.1:${bridge.port}/vj?k=${bridge.vjKey}`);
  await page.waitForFunction(() => /2468/.test(document.getElementById('net-status').textContent), null, { timeout: 10000 });
  await page.fill('#setlist', 'A | 2\nB | 3');

  // スマホ（別のページ）
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const phoneErrors = [];
  phone.on('pageerror', (e) => phoneErrors.push(String(e)));
  await phone.goto(`http://127.0.0.1:${bridge.port}/`);
  await phone.fill('#pin', '1111');
  await phone.click('#btn-login');
  await phone.waitForFunction(() => /違|Wrong/.test(document.getElementById('login-msg').textContent));
  await phone.fill('#pin', '2468');
  await phone.click('#btn-login');
  // 鍵つきでつないでいるので、VJ のパネル ⑦ で許可するまで待つ（スマホには案内が出る）
  await phone.waitForFunction(() => /許可|Allow/.test(document.getElementById('login-msg').textContent));
  await page.waitForSelector('#net-phones button[data-act="approve"]', { timeout: 10000 });
  assert.match(await page.textContent('#net-phones'), /つなごうとしています/);
  await page.click('#net-phones button[data-act="approve"]');
  await phone.waitForSelector('#login', { state: 'hidden' });
  assert.match(await phone.evaluate(() => localStorage.getItem('vj-device-token') || ''), /^[0-9a-f]{32}$/, '端末の鍵を覚える');
  await page.waitForFunction(() => /許可したスマホ/.test(document.getElementById('net-phones').textContent));
  await phone.waitForSelector('#scenes button[data-scene="orb"]');
  await phone.click('#scenes button[data-scene="orb"]');
  await page.waitForFunction(() => VJ.app.show.state.sceneId === 'orb', null, { timeout: 5000 });
  await phone.click('#btn-black');
  await page.waitForFunction(() => VJ.app.show.state.blackout === true);
  await phone.waitForFunction(() => document.getElementById('btn-black').classList.contains('on'));
  await phone.click('button[data-cmd="next"]');
  await page.waitForFunction(() => VJ.app.show.currentSong() && VJ.app.show.currentSong().title === 'A');
  await phone.waitForFunction(() => /M1 A/.test(document.getElementById('status').textContent));
  assert.match(await phone.textContent('#status'), /声の輪|Voice Orb|トンネル|Tunnel/);

  // OSC（照明卓などから）
  const udp = dgram.createSocket('udp4');
  udp.send(oscMessage('/vj/blackout', [0]), bridge.oscPort, '127.0.0.1');
  await page.waitForFunction(() => VJ.app.show.state.blackout === false);
  udp.send(oscMessage('/vj/scene', [3]), bridge.oscPort, '127.0.0.1');
  await page.waitForFunction(() => VJ.app.show.state.sceneId === 'horizon');
  udp.close();

  // ブリッジにつなぐのをやめると切れる
  await page.uncheck('#net-on');
  await page.waitForFunction(() => VJ.net.status === 'off');
  assert.deepEqual(errors, []);
  assert.deepEqual(phoneErrors, []);
  await phone.close();
  await page.close();
});

test('QR コード：パネルに QR が出て、暗証番号入りの URL で開くとそのままつながる。スマホにシーンの見本画像と出演バンドの切替', async () => {
  const { page, errors } = await openApp(browser, DIST, '', { width: 1000, height: 800 });
  await page.evaluate((url) => { document.getElementById('net-url').value = url; document.getElementById('net-url').dispatchEvent(new Event('change')); }, `ws://127.0.0.1:${bridge.port}/vj?k=${bridge.vjKey}`);
  await page.check('#net-on');
  await page.waitForFunction(() => VJ.net.status === 'on' && VJ.net.info, null, { timeout: 10000 });
  await page.waitForSelector('#btn-qr', { state: 'visible' });
  const urls = await page.evaluate(() => VJ.net.info.urls);
  await page.click('#btn-qr');
  if (urls.length) {
    await page.waitForSelector('#net-qr img');
    assert.match(await page.getAttribute('#net-qr img', 'src'), /^data:image\/svg\+xml/);
    assert.match(await page.textContent('#net-qr'), new RegExp(urls[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  // QR の URL（#p=暗証番号）で開く：ログイン画面を出さずにつながり、アドレスから暗証番号を消す
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const phoneErrors = [];
  phone.on('pageerror', (e) => phoneErrors.push(String(e)));
  phone.on('dialog', (d) => d.accept());
  await phone.goto(`http://127.0.0.1:${bridge.port}/#p=2468`);
  // 前のテストで許可した端末の鍵があれば、許可なしで入る。無ければパネルで許可する
  await Promise.race([
    phone.waitForSelector('#login', { state: 'hidden' }),
    page.waitForSelector('#net-phones button[data-act="approve"]').then(() => page.click('#net-phones button[data-act="approve"]')),
  ]);
  await phone.waitForSelector('#login', { state: 'hidden' });
  assert.equal(await phone.evaluate(() => location.hash), '');
  // シーンの見本画像
  await phone.waitForSelector('#scenes button[data-scene="aurora"] img');
  // 出演バンドが 2 組になるとスマホに切替ボタンが出て、押すと VJ が切り替わる
  assert.equal(await phone.isVisible('#band-box'), false);
  await page.evaluate(() => { VJ.bands.add(VJ.app.settings, 'Phone Band'); VJ.bandsUI.render(); });
  await phone.waitForSelector('#band-box', { state: 'visible' });
  await phone.click('button[data-cmd="band-next"]');
  await page.waitForFunction(() => VJ.app.settings.bandIdx === 1);
  await phone.waitForFunction(() => /Phone Band/.test(document.getElementById('band-now').textContent));
  await page.uncheck('#net-on');
  assert.deepEqual(errors, []);
  assert.deepEqual(phoneErrors, []);
  await phone.close();
  await page.close();
});

test('スマホの許可：2 画面のときも操作ウィンドウのパネルで許可・外すができる。外したスマホは切れる', async () => {
  const { page: ctrl, errors } = await openApp(browser, DIST, '', { width: 1000, height: 800 });
  await ctrl.evaluate((url) => { document.getElementById('net-url').value = url; document.getElementById('net-url').dispatchEvent(new Event('change')); }, `ws://127.0.0.1:${bridge.port}/vj?k=${bridge.vjKey}`);
  await ctrl.check('#net-on');
  const [out] = await Promise.all([ctrl.context().waitForEvent('page'), ctrl.click('#btn-output')]);
  await out.waitForFunction(() => window.VJ && VJ.app && VJ.net && VJ.net.status === 'on', null, { timeout: 30000 });
  // 別のブラウザのコンテキスト（端末の鍵を持っていない、新しいスマホ）
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await ctx.newPage();
  await phone.goto(`http://127.0.0.1:${bridge.port}/#p=2468`);
  await phone.waitForFunction(() => /許可|Allow/.test(document.getElementById('login-msg').textContent));
  await ctrl.waitForSelector('#net-phones button[data-act="approve"]', { timeout: 10000 });
  await ctrl.click('#net-phones button[data-act="approve"]');
  await phone.waitForSelector('#login', { state: 'hidden' });
  // 外す → スマホは切れて、案内が出る（前のテストで許可したスマホも一覧に残っているので、つながっている行のボタン）
  await ctrl.waitForSelector('#net-phones [data-online="1"] button[data-act="forget"]', { timeout: 10000 });
  await ctrl.click('#net-phones [data-online="1"] button[data-act="forget"]');
  await phone.waitForFunction(() => /断られました|declined/.test(document.getElementById('login-msg').textContent));
  assert.equal(await phone.evaluate(() => localStorage.getItem('vj-device-token')), null, '鍵を捨てる');
  await out.close();
  await ctx.close();
  await ctrl.close();
  assert.deepEqual(errors, []);
});
