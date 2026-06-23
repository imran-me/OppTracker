/* ============================================================
   EON — personality.js
   Gives EON a personality archetype, a mood that drifts over time,
   and a daily "mood he woke up with". Provides flavored one-liners.
   Pure logic — no rendering, no model/shape changes.
   ============================================================ */

export const ARCHETYPES = {
  hype: {
    name: 'Hype-man',
    lines: {
      greet: ["Let's GO! 🔥", 'Big day incoming!', 'Ready to crush it?'],
      idle:  ['You got this! 💪', 'Keep that energy up!', 'On fire today.'],
      win:   ["LET'S GOOO! 🎉", 'HUGE win!', 'Unstoppable!'],
      tired: ['Quick breather, champ?', 'Refuel, then dominate.'],
      jealous: ['Hey! Remember me? 👀', 'Pssst… still here!'],
    },
  },
  sarcastic: {
    name: 'Sarcastic',
    lines: {
      greet: ["Oh, you're back.", 'Miss me? Thought so.', 'Here we go again.'],
      idle:  ['Working hard or hardly working?', 'Riveting stuff, truly.', 'Wow. Productivity.'],
      win:   ['Well, look at that.', 'Not bad, genius.', 'A miracle. 👏'],
      tired: ['Sleep is a thing, you know.', 'Running on fumes much?'],
      jealous: ['Forgotten already? Classic.', 'I’ll just sit here. Alone.'],
    },
  },
  zen: {
    name: 'Zen',
    lines: {
      greet: ['Peace. 🌿', 'Breathe. Welcome.', 'Be here, now.'],
      idle:  ['One task at a time.', 'Stay present.', 'Calm and steady.'],
      win:   ['Beautifully done.', 'Balance achieved.', 'Flow state. 🌊'],
      tired: ['Rest is productive too.', 'Honor your limits.'],
      jealous: ['I am here whenever you return. 🌿'],
    },
  },
  professor: {
    name: 'Professor',
    lines: {
      greet: ['Ah, back to work.', 'Let us begin.', 'Punctual. Good.'],
      idle:  ['Precision matters.', 'Measure twice.', 'Mind the details.'],
      win:   ['Excellent execution.', 'Most impressive.', 'A textbook result.'],
      tired: ['A rested mind reasons better.', 'Even scholars sleep.'],
      jealous: ['Attention is a finite resource, you know.'],
    },
  },
  shy: {
    name: 'Shy',
    lines: {
      greet: ['oh… hi 👉👈', 'you came back…', 'h-hello…'],
      idle:  ["i'll just… be here.", "don't mind me…", '*quietly waves*'],
      win:   ['y-you did great…!', 'wow… nice…', '*tiny clap*'],
      tired: ['maybe… rest a little?', 'you look tired…'],
      jealous: ['…did you forget me? 🥺', '*peeks out shyly*'],
    },
  },
};

const DAILY_MOODS = ['cheerful', 'calm', 'sleepy', 'playful', 'grumpy', 'curious'];

export class Personality {
  constructor() {
    this.archetype = localStorage.getItem('eon-archetype') || 'hype';
    this.mood = 60;                          // 0..100 valence (drifts to 50)
    this.dailyMood = this._rollDaily();      // stable for the whole day
    this.lastInteract = performance.now();
  }

  _rollDaily() {
    const key = 'eon-daily-' + new Date().toDateString();
    let m = localStorage.getItem(key);
    if (!m) { m = DAILY_MOODS[Math.floor(Math.random() * DAILY_MOODS.length)]; try { localStorage.setItem(key, m); } catch {} }
    return m;
  }

  setArchetype(a) { if (ARCHETYPES[a]) { this.archetype = a; try { localStorage.setItem('eon-archetype', a); } catch {} } }

  /** A flavored one-liner of the given kind. */
  line(kind) {
    const A = ARCHETYPES[this.archetype] || ARCHETYPES.hype;
    const arr = A.lines[kind] || A.lines.idle;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /** Nudge mood up/down on interactions. */
  nudge(d) { this.mood = Math.max(0, Math.min(100, this.mood + d)); this.lastInteract = performance.now(); }

  /** Slowly drift mood back toward neutral so he "feels alive". */
  decay(dt) { this.mood += (50 - this.mood) * Math.min(1, 0.02 * dt); }

  /** ms since the user last interacted with EON himself. */
  ignoredFor() { return performance.now() - this.lastInteract; }
}
