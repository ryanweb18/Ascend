// Ascend — all sound is synthesised live with the Web Audio API (no audio files needed).
// Old-fashioned mechanical clicks, paper card sounds, a desk bell, and a music-box tune
// playing through a warm "old record" filter with gentle crackle.
const Sound = (() => {
  const PREFS_KEY = 'ascend.sound';
  let prefs = { musicOn: true, sfxOn: true, music: 0.5, sfx: 0.75 };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch {}
  const save = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} };

  let ctx, master, sfxBus, musicBus, room, crackleSrc, musicTimer, musicPlaying = false;
  let noiseBuf;
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);

    // Small wooden room — short, not a big modern hall.
    room = ctx.createConvolver();
    room.buffer = impulse(1.1, 3.5);
    const wet = ctx.createGain(); wet.gain.value = 0.35;
    room.connect(wet).connect(master);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    sfxBus = ctx.createGain(); sfxBus.gain.value = prefs.sfxOn ? prefs.sfx : 0;
    sfxBus.connect(master);
    const sfxSend = ctx.createGain(); sfxSend.gain.value = 0.4;
    sfxBus.connect(sfxSend).connect(room);

    // Music goes through a band-limited "old phonograph" filter.
    musicBus = ctx.createGain(); musicBus.gain.value = 0;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; lp.Q.value = 0.9;
    musicBus.connect(hp).connect(lp).connect(master);
    const musicSend = ctx.createGain(); musicSend.gain.value = 0.7;
    lp.connect(musicSend).connect(room);

    if (prefs.musicOn) startMusic();
  }

  function impulse(seconds, decay) {
    const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function tone({ freq, type = 'sine', dur = 0.2, vol = 0.2, attack = 0.003, when = 0, glideTo, dest }) {
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest || sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // A filtered burst of noise: the building block for clicks, clacks and paper.
  function burst({ dur = 0.03, vol = 0.3, type = 'bandpass', freq = 3000, q = 4, when = 0, sweepTo, dest }) {
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest || sfxBus);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }

  // Bell with slightly inharmonic overtones (desk bell / bicycle bell).
  function bell(freq, { vol = 0.1, when = 0, dur = 1.6 } = {}) {
    [[1, 1], [2.76, 0.45], [5.4, 0.2], [8.9, 0.08]].forEach(([ratio, amp]) =>
      tone({ freq: freq * ratio, dur: dur / (1 + ratio * 0.25), vol: vol * amp, when }));
  }

  const sfx = {
    // Typewriter-key style click: sharp tick + little body thump.
    click() {
      burst({ dur: 0.012, vol: 0.5, type: 'highpass', freq: 2500, q: 0.7 });
      burst({ dur: 0.025, vol: 0.35, freq: 1800, q: 6, when: 0.004 });
      tone({ freq: 160, glideTo: 90, dur: 0.05, vol: 0.18, type: 'triangle' });
    },
    hover() { burst({ dur: 0.006, vol: 0.06, type: 'highpass', freq: 4000, q: 0.7 }); },
    // Paper card slid off the deck.
    draw() {
      burst({ dur: 0.22, vol: 0.18, freq: 900, q: 0.8, sweepTo: 2800 });
      burst({ dur: 0.04, vol: 0.2, freq: 2400, q: 3, when: 0.2 });
    },
    // Card slapped into the rack: paper slap + wooden clack.
    place() {
      burst({ dur: 0.07, vol: 0.45, type: 'lowpass', freq: 1400, q: 0.8 });
      burst({ dur: 0.02, vol: 0.4, freq: 3200, q: 5, when: 0.03 });
      tone({ freq: 220, glideTo: 120, dur: 0.08, vol: 0.25, type: 'triangle', when: 0.02 });
      tone({ freq: 880, dur: 0.06, vol: 0.05, type: 'square', when: 0.03 });
    },
    // Card flicked onto the discard pile.
    discard() {
      burst({ dur: 0.18, vol: 0.2, freq: 2600, q: 0.8, sweepTo: 700 });
      burst({ dur: 0.05, vol: 0.3, type: 'lowpass', freq: 1200, q: 0.8, when: 0.16 });
    },
    otherMove() {
      burst({ dur: 0.05, vol: 0.2, type: 'lowpass', freq: 1300, q: 0.8 });
      burst({ dur: 0.015, vol: 0.18, freq: 3000, q: 5, when: 0.02 });
    },
    yourTurn() { bell(1568, { vol: 0.12 }); bell(1568, { vol: 0.07, when: 0.18 }); },
    join() { bell(1318.5, { vol: 0.09, dur: 1.2 }); bell(1046.5, { vol: 0.09, dur: 1.6, when: 0.28 }); }, // ding-dong
    error() { tone({ freq: 110, dur: 0.22, vol: 0.09, type: 'square' }); tone({ freq: 116, dur: 0.22, vol: 0.07, type: 'square' }); },
    pop() { tone({ freq: 700, glideTo: 520, dur: 0.07, vol: 0.18, type: 'triangle' }); burst({ dur: 0.01, vol: 0.2, freq: 2500, q: 4 }); }, // wood block
    // Little brass "ta-da!"
    win() {
      const brass = (m, when, dur) => {
        tone({ freq: mtof(m), type: 'sawtooth', dur, vol: 0.05, attack: 0.03, when });
        tone({ freq: mtof(m) * 1.003, type: 'square', dur, vol: 0.025, attack: 0.03, when });
      };
      brass(67, 0, 0.18); brass(72, 0.16, 0.18); brass(76, 0.32, 0.18); brass(79, 0.5, 1.1); brass(72, 0.5, 1.1);
      bell(2093, { vol: 0.06, when: 0.5, dur: 2 });
    },
    roundEnd() { bell(1046.5, { vol: 0.08 }); bell(1318.5, { vol: 0.07, when: 0.2 }); bell(1568, { vol: 0.07, when: 0.4, dur: 2 }); },
  };

  // ---- Music: an original little music-box waltz over soft oom-pah-pah chords ----
  const BEAT = 0.72; // seconds per beat, 3 beats per bar
  // [midi, beats] — 0 = rest
  const MELODY = [
    [76, 1], [79, 1], [84, 1], [83, 2], [79, 1], [81, 1], [79, 1], [76, 1], [74, 3],
    [77, 1], [81, 1], [86, 1], [84, 2], [81, 1], [79, 1], [76, 1], [74, 1], [72, 3],
    [79, 1], [76, 1], [79, 1], [81, 2], [77, 1], [76, 1], [72, 1], [76, 1], [74, 3],
    [76, 1], [77, 1], [79, 1], [81, 1], [83, 1], [84, 1], [86, 1], [83, 1], [79, 1], [84, 3],
    [0, 3], [0, 3],
  ];
  // one chord per bar: [bass, chord tones...]
  const BARS = [
    [48, 64, 67], [43, 62, 67], [45, 64, 69], [43, 62, 67],
    [41, 65, 69], [41, 65, 69], [43, 64, 67], [48, 64, 67],
    [48, 64, 67], [41, 65, 69], [48, 64, 67], [43, 62, 67],
    [48, 64, 67], [41, 65, 69], [43, 62, 65], [48, 64, 67],
    [41, 65, 69], [48, 64, 67],
  ];

  function musicBoxNote(m, t, vol) {
    // a tine: pure tone + bright quick-fading overtone
    [[1, 1, 2.2], [4, 0.18, 0.25], [6.9, 0.05, 0.1]].forEach(([r, a, d]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = mtof(m) * r;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * a, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(musicBus); o.start(t); o.stop(t + d + 0.05);
    });
  }
  function softNote(m, t, dur, vol, type = 'triangle') {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = mtof(m);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(musicBus); o.start(t); o.stop(t + dur + 0.05);
  }

  function scheduleLoop() {
    if (!musicPlaying) return;
    const start = ctx.currentTime + 0.15;
    let beat = 0;
    for (const [m, len] of MELODY) {
      if (m) musicBoxNote(m, start + beat * BEAT + (Math.random() * 0.012), 0.11);
      beat += len;
    }
    BARS.forEach(([bass, ...chord], bar) => {
      const t = start + bar * 3 * BEAT;
      softNote(bass, t, BEAT * 1.6, 0.12, 'sine');                 // oom
      for (const b of [1, 2]) chord.forEach(c => softNote(c - 12, t + b * BEAT, BEAT * 0.7, 0.035)); // pah pah
    });
    const loopSeconds = BARS.length * 3 * BEAT;
    musicTimer = setTimeout(scheduleLoop, loopSeconds * 1000 - 150);
  }

  // Old-record crackle and hiss, looping quietly under the music.
  function startCrackle() {
    const len = ctx.sampleRate * 6;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * 0.012; // hiss
      if (Math.random() < 0.0004) d[i] += (Math.random() < 0.5 ? -1 : 1) * (0.2 + Math.random() * 0.5); // pops
    }
    crackleSrc = ctx.createBufferSource(); crackleSrc.buffer = buf; crackleSrc.loop = true;
    const g = ctx.createGain(); g.gain.value = 0.35;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000;
    crackleSrc.connect(lp).connect(g).connect(musicBus);
    crackleSrc.start();
  }

  function startMusic() {
    if (!ctx || musicPlaying) return;
    musicPlaying = true;
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setTargetAtTime(prefs.music, ctx.currentTime, 0.8);
    startCrackle();
    scheduleLoop();
  }

  function stopMusic() {
    if (!ctx || !musicPlaying) return;
    musicPlaying = false;
    clearTimeout(musicTimer);
    musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    const src = crackleSrc; crackleSrc = null;
    setTimeout(() => { try { src.stop(); } catch {} }, 1500);
  }

  return {
    prefs,
    init,
    play(name) { if (ctx && prefs.sfxOn && sfx[name]) sfx[name](); },
    setMusicOn(on) { prefs.musicOn = on; save(); if (!ctx) return; on ? startMusic() : stopMusic(); },
    setSfxOn(on) { prefs.sfxOn = on; save(); if (sfxBus) sfxBus.gain.value = on ? prefs.sfx : 0; },
    setMusicVolume(v) { prefs.music = v; save(); if (ctx && musicPlaying) musicBus.gain.setTargetAtTime(v, ctx.currentTime, 0.1); },
    setSfxVolume(v) { prefs.sfx = v; save(); if (sfxBus && prefs.sfxOn) sfxBus.gain.value = v; },
  };
})();
