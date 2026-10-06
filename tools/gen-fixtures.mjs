// E2E テスト用の音声（偽マイク入力に使う WAV）と正解データを作る。
import fs from 'node:fs';
import path from 'node:path';
import { loadVJ, ROOT } from '../test/helpers/load-src.mjs';

const VJ = loadVJ();
const OUT = path.join(ROOT, 'test', 'fixtures');
fs.mkdirSync(OUT, { recursive: true });
const SR = 48000;

const tracks = {
  drums: VJ.synth.song({ sampleRate: SR, bpm: 128, seed: 21, sections: [{ bars: 8, drums: '8beat', bass: true, guitar: 'chug' }] }),
  click: VJ.synth.song({ sampleRate: SR, bpm: 120, seed: 1, humanize: 0, sections: [{ bars: 4, drums: 'click' }] }),
};
const silence = { samples: new Float32Array(SR * 4), onsets: {} };

for (const [name, s] of Object.entries(tracks)) {
  fs.writeFileSync(path.join(OUT, name + '.wav'), VJ.synth.toWav(s.samples, SR));
  fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify({ sampleRate: SR, onsets: s.onsets, duration: s.duration }));
}
fs.writeFileSync(path.join(OUT, 'silence.wav'), VJ.synth.toWav(silence.samples, SR));
console.log('fixtures:', fs.readdirSync(OUT).join(', '));
