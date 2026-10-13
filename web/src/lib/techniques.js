// The Relaxation Guide techniques, same ids and names as the app's Arcade
// (StressApp/modules/relaxation_guide/src/screens/MethodsScreen.js), each
// mapped to an exercise that runs in the browser.
//
// kind: 'breathing' (pattern of [label, seconds]) | 'steps' (timed guided
//       steps) | 'colorclash' | 'colormatch' | 'tracer' | 'biofeedback'

export const TECHNIQUES = [
  {
    id: 'flower_meadow', title: 'Calm Meadow', icon: '🌸', color: '#EC4899', minutes: 2,
    description: 'Breathe with blooming petals to calm down (4-7-8 rhythm).',
    kind: 'breathing', pattern: [['Breathe in', 4], ['Hold', 7], ['Breathe out', 8]], seconds: 120,
  },
  {
    id: 'water_lily_pond', title: 'Zen Lily Pond', icon: '🪷', color: '#10B981', minutes: 2,
    description: 'Slow, even breaths like ripples spreading on a pond.',
    kind: 'breathing', pattern: [['Breathe in', 5], ['Breathe out', 5]], seconds: 120,
  },
  {
    id: 'box_meditation', title: 'Focus Box', icon: '🧊', color: '#3B82F6', minutes: 2,
    description: 'A 4-second square rhythm to clear your mind.',
    kind: 'breathing', pattern: [['Breathe in', 4], ['Hold', 4], ['Breathe out', 4], ['Hold', 4]], seconds: 128,
  },
  {
    id: 'diaphragmatic_pace', title: 'Deep Belly Calm', icon: '🫁', color: '#0EA5E9', minutes: 2,
    description: 'Slow deep belly breathing: in for 4, out for 6.',
    kind: 'breathing', pattern: [['Breathe in', 4], ['Breathe out', 6]], seconds: 120,
  },
  {
    id: 'pattern_alignment', title: 'Color Match', icon: '🧩', color: '#8B5CF6', minutes: 1,
    description: 'A gentle pattern-matching puzzle to take your mind off worry.',
    kind: 'colormatch', rounds: 8,
  },
  {
    id: 'body_scan_mindful', title: 'Body Sweep', icon: '🧘', color: '#7C3AED', minutes: 3,
    description: 'Move your attention slowly through the body and let tension go.',
    kind: 'steps', steps: [
      ['Sit comfortably. Close your eyes or soften your gaze.', 8],
      ['Notice your feet. Let them feel heavy and warm.', 15],
      ['Move up to your legs. Let go of any tightness.', 15],
      ['Notice your stomach. Let it rise and fall softly.', 15],
      ['Relax your chest and shoulders. Let them drop.', 15],
      ['Soften your arms and hands, all the way to the fingertips.', 15],
      ['Relax your jaw, your cheeks and your forehead.', 15],
      ['Feel your whole body at once, calm and supported.', 15],
    ],
  },
  {
    id: 'autogenic_warmth', title: 'Warmth Flow', icon: '🔥', color: '#F59E0B', minutes: 3,
    description: 'Imagine soothing warmth flowing through your body.',
    kind: 'steps', steps: [
      ['Settle in and take a slow breath.', 8],
      ['Say quietly: “My right arm is heavy and warm.”', 15],
      ['Say quietly: “My left arm is heavy and warm.”', 15],
      ['Say quietly: “My legs are heavy and warm.”', 15],
      ['Say quietly: “My heartbeat is calm and regular.”', 15],
      ['Say quietly: “My breathing is slow and easy.”', 15],
      ['Say quietly: “My forehead is cool and clear.”', 15],
    ],
  },
  {
    id: 'stroop_decoupler', title: 'Color Clash', icon: '🎯', color: '#06B6D4', minutes: 2,
    description: 'A colour challenge to refocus your mind: pick the INK colour, not the word.',
    kind: 'colorclash', rounds: 10,
  },
  {
    id: 'pmr_crystal_squeeze', title: 'Somatic PMR', icon: '💎', color: '#EC4899', minutes: 4,
    description: 'Tense and release muscle groups one at a time to drop physical tension.',
    kind: 'steps', steps: [
      ['Make fists with both hands. Squeeze…', 5], ['Release. Feel the warmth spread.', 10],
      ['Tighten your arms and shoulders. Squeeze…', 5], ['Release. Let your shoulders drop.', 10],
      ['Scrunch your face and close your eyes tightly…', 5], ['Release. Soften your face.', 10],
      ['Tighten your stomach and chest…', 5], ['Release. Breathe out slowly.', 10],
      ['Press your legs and toes tight…', 5], ['Release. Let your legs go heavy.', 10],
      ['Notice your whole body, loose and calm.', 10],
    ],
  },
  {
    id: 'emdr_saccadic_trace', title: 'Cosmic Trace', icon: '✨', color: '#38BDF8', minutes: 1,
    description: 'Follow a moving dot with your eyes only. Keep your head still.',
    kind: 'tracer', seconds: 60,
  },
  {
    id: 'galvanic_biofeedback_flow', title: 'Bio GSR Pool', icon: '💧', color: '#06B6D4', minutes: 2,
    description: 'Breathe slowly while you watch your own skin response settle.',
    kind: 'biofeedback', pattern: [['Breathe in', 5], ['Breathe out', 6]], seconds: 120,
  },
];

// The service (and the app's fallback) also uses these ids.
const ALIASES = { progressive_muscle: 'pmr_crystal_squeeze' };

export function findTechnique(id) {
  const key = ALIASES[id] || id;
  return TECHNIQUES.find((t) => t.id === key) || null;
}
