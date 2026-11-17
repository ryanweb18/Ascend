// Ascend — all sound is synthesised live with the Web Audio API (no audio files needed).
// Old-fashioned mechanical clicks, paper card sounds, a desk bell, and slow ambient piano.
const Sound = (() => {
  const PREFS_KEY = 'ascend.sound';
  let prefs = { musicOn: true, sfxOn: true, music: 0.5, sfx: 0.75 };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch {}
  const save = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} };

  let ctx, master, sfxBus, musicBus, room, musicTimer, musicPlaying = false;
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

    // Music: gentle warmth filter, its own long hall reverb is added in startMusic().
    musicBus = ctx.createGain(); musicBus.gain.value = 0;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 45;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000;
    musicBus.connect(hp).connect(lp).connect(master);

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
    // Two typewriter keys and the little carriage bell.
    chat() {
      burst({ dur: 0.01, vol: 0.3, type: 'highpass', freq: 2500, q: 0.7 });
      burst({ dur: 0.01, vol: 0.25, type: 'highpass', freq: 2800, q: 0.7, when: 0.09 });
      bell(2637, { vol: 0.05, when: 0.2, dur: 0.9 });
    },
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

  // ---- Music: slow, spacious generative piano (original, never loops exactly) ----
  // Soft felt-piano chords, sparse broken arpeggios and a wandering melody with lots of
  // silence, played through a long hall reverb. Every pass is a little different.
  const BEAT = 0.95;                 // ~63 bpm
  const CHORD_BEATS = 8;             // each chord rings for two slow bars
  const SECTIONS = [
    // [bass, ...voicing] in MIDI notes
    [[41, 53, 57, 60, 64], [45, 52, 55, 60, 64], [36, 52, 55, 59, 64], [43, 50, 55, 59, 62]], // Fmaj7  Am7  Cmaj7  G6
    [[38, 53, 57, 60, 64], [41, 53, 57, 60, 65], [45, 55, 60, 64, 67], [40, 52, 55, 59, 62]], // Dm9  F  Am7  Em7
    [[41, 57, 60, 64, 67], [43, 55, 59, 62, 69], [45, 57, 60, 64, 71], [36, 55, 60, 64, 67]], // Fmaj9  G6/9  Am9  C
  ];
  const SCALE = [60, 62, 64, 67, 69, 71, 72, 74, 76, 79, 81, 83, 84]; // mostly pentatonic, gentle
  const ARPS = [
    [[1, 1], [2, 2], [3, 3], [5, 2], [6, 3]],
    [[0.5, 2], [1.5, 3], [2.5, 4], [4.5, 3], [5.5, 2]],
    [[2, 1], [2.5, 2], [3, 3], [3.5, 4], [6, 3]],
    [[1, 3], [3, 2], [5, 4]],
    [],
  ];
  let musicReverb, nextChordAt = 0, sectionIdx = 0, chordIdx = 0, melodyIdx = 7, passes = 0;

  function piano(m, t, vol, len = 4) {
    // A soft "felt" piano: a few harmonics, quick attack, long fading tail, darkening over time.
    const f = mtof(m);
    const out = ctx.createGain();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(4200, 900 + f * 3), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 1.2), t + len * 0.6);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(vol, t + 0.008);
    out.gain.exponentialRampToValueAtTime(vol * 0.35, t + 0.5);
    out.gain.exponentialRampToValueAtTime(0.0001, t + len);
    lp.connect(out).connect(musicBus);
    out.connect(musicReverb);
    [[1, 1, 0], [2, 0.32, 3], [3, 0.1, -4], [4, 0.04, 2]].forEach(([r, a, cents]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = r === 1 ? 'triangle' : 'sine';
      o.frequency.value = f * r; o.detune.value = cents;
      g.gain.value = a;
      o.connect(g).connect(lp);
      o.start(t); o.stop(t + len + 0.1);
    });
  }

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const human = () => (Math.random() - 0.5) * 0.04;

  function playChord(chord, t) {
    const [bass, ...voice] = chord;
    const dur = CHORD_BEATS * BEAT;
    // left hand: low bass note, sometimes doubled softly an octave up
    piano(bass, t, 0.13, dur + 2);
    if (Math.random() < 0.5) piano(bass + 12, t + 0.03, 0.05, dur);
    // a soft block chord on some passes, otherwise a broken arpeggio
    if (Math.random() < 0.3) voice.forEach((n, i) => piano(n, t + i * 0.025 + human(), 0.04, dur));
    for (const [beat, i] of pick(ARPS)) piano(voice[i % voice.length], t + beat * BEAT + human(), 0.045 + Math.random() * 0.02, 4.5);
    // right hand melody: a few notes wandering by step, often resting entirely
    if (Math.random() < 0.7) {
      const spots = [0, 1, 1.5, 2, 3, 4, 4.5, 5, 6, 7].filter(() => Math.random() < 0.33).slice(0, 4);
      for (const beat of spots) {
        melodyIdx = Math.max(3, Math.min(SCALE.length - 1, melodyIdx + pick([-2, -1, -1, 0, 1, 1, 2])));
        const note = SCALE[melodyIdx];
        piano(note, t + beat * BEAT + human(), 0.07 + Math.random() * 0.03, 5);
        if (Math.random() < 0.12) piano(note + 12, t + beat * BEAT + 0.01, 0.025, 4); // shimmer
      }
    }
  }

  function scheduleMusic() {
    if (!musicPlaying) return;
    const now = ctx.currentTime;
    if (nextChordAt < now + 0.1) nextChordAt = now + 0.3;
    const section = SECTIONS[sectionIdx];
    playChord(section[chordIdx], nextChordAt);
    nextChordAt += CHORD_BEATS * BEAT;
    chordIdx++;
    if (chordIdx >= section.length) {
      chordIdx = 0; passes++;
      // move to another section every couple of passes, sometimes leave a breath of silence
      if (passes % 2 === 0) sectionIdx = (sectionIdx + 1 + Math.floor(Math.random() * (SECTIONS.length - 1))) % SECTIONS.length;
      if (Math.random() < 0.25) nextChordAt += CHORD_BEATS * BEAT * 0.5;
    }
    musicTimer = setTimeout(scheduleMusic, Math.max(50, (nextChordAt - ctx.currentTime - 1) * 1000));
  }

  function startMusic() {
    if (!ctx || musicPlaying) return;
    musicPlaying = true;
    if (!musicReverb) {
      musicReverb = ctx.createConvolver();
      musicReverb.buffer = impulse(5.5, 2.4);
      const wet = ctx.createGain(); wet.gain.value = 0.8;
      musicReverb.connect(wet).connect(musicBus);
    }
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setTargetAtTime(prefs.music, ctx.currentTime, 1.2);
    nextChordAt = 0;
    scheduleMusic();
  }

  function stopMusic() {
    if (!ctx || !musicPlaying) return;
    musicPlaying = false;
    clearTimeout(musicTimer);
    musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
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
