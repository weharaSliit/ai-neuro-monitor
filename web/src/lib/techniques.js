// The Relaxation Guide techniques: same ids, names, order, colours and
// descriptions as the app (StressApp/modules/relaxation_guide/src/screens/
// MethodsScreen.js and games/GamePlayerScreen.js). `engine` names the web
// game that runs it (src/components/games).

export const TECHNIQUES = [
  {
    id: 'flower_meadow', level: 1, title: 'Calm Meadow', icon: '🌸', color: '#EC4899',
    gradient: ['#F43F5E', '#EC4899', '#FDE68A'], meaningTitle: 'Garden Bloom Breathing',
    description: 'Breathe with blooming petals to calm down.', suggestedMin: 3, engine: 'flower',
  },
  {
    id: 'water_lily_pond', level: 2, title: 'Zen Lily Pond', icon: '🪷', color: '#10B981',
    gradient: ['#059669', '#10B981', '#06B6D4'], meaningTitle: 'Breathe with Water Lilies',
    description: 'Tap water ripples with floating water lilies.', suggestedMin: 3, engine: 'lily',
  },
  {
    id: 'box_meditation', level: 3, title: 'Focus Box', icon: '🧊', color: '#3B82F6',
    gradient: ['#1E1B4B', '#3B82F6', '#38BDF8'], meaningTitle: 'Square Breathing Rhythm',
    description: '4-second square rhythm to clear your mind.', suggestedMin: 3, engine: 'box',
  },
  {
    id: 'diaphragmatic_pace', level: 4, title: 'Deep Belly Calm', icon: '🫁', color: '#0EA5E9',
    gradient: ['#0284C7', '#0EA5E9', '#6EE7B7'], meaningTitle: 'Deep Belly Breathing',
    description: 'Slow deep breathing to lower stress.', suggestedMin: 3, engine: 'belly',
  },
  {
    id: 'pattern_alignment', level: 5, title: 'Color Match', icon: '🧩', color: '#8B5CF6',
    gradient: ['#8B5CF6', '#D946EF', '#F59E0B'], meaningTitle: 'Color Pattern Puzzle',
    description: 'Pattern matching puzzle to distract from worry.', suggestedMin: 2, engine: 'colormatch',
  },
  {
    id: 'body_scan_mindful', level: 6, title: 'Body Sweep', icon: '🧘', color: '#7C3AED',
    gradient: ['#4C1D95', '#7C3AED', '#C4B5FD'], meaningTitle: 'Mindful Body Scan',
    description: 'Interactive map to sweep muscle tension.', suggestedMin: 4, engine: 'bodyscan',
  },
  {
    id: 'autogenic_warmth', level: 7, title: 'Warmth Flow', icon: '🔥', color: '#F59E0B',
    gradient: ['#B91C1C', '#EF4444', '#F59E0B'], meaningTitle: 'Gentle Thermal Warmth',
    description: 'Soothing warmth flowing through your body.', suggestedMin: 3, engine: 'warmth',
  },
  {
    id: 'stroop_decoupler', level: 8, title: 'Color Clash', icon: '🎯', color: '#06B6D4',
    gradient: ['#0891B2', '#06B6D4', '#A855F7'], meaningTitle: 'Speed Color Challenge',
    description: 'Color challenge to refocus your mind.', suggestedMin: 3, engine: 'stroop',
  },
  {
    id: 'pmr_crystal_squeeze', level: 9, title: 'Somatic PMR', icon: '💎', color: '#EC4899',
    gradient: ['#881337', '#BE185D', '#F472B6'], meaningTitle: 'PMR Iso-Tension & Release',
    description: 'Isometric crystal squeeze & release to drop SCL conductance.', suggestedMin: 3, engine: 'pmr',
  },
  {
    id: 'emdr_saccadic_trace', level: 10, title: 'Cosmic Trace', listTitle: 'Cosmic Trace (EMDR)', icon: '✨', color: '#38BDF8',
    gradient: ['#0369A1', '#38BDF8', '#C084FC'], meaningTitle: 'EMDR Saccadic Desensitization',
    description: 'Bilateral saccadic eye pursuit to down-regulate amygdala.', suggestedMin: 3, engine: 'emdr',
  },
  {
    id: 'galvanic_biofeedback_flow', level: 11, title: 'Bio GSR Pool', icon: '💧', color: '#06B6D4',
    gradient: ['#083344', '#06B6D4', '#67E8F9'], meaningTitle: 'GSR Fluid Closed-Loop Biofeedback',
    description: 'Real-time EDA fluid biofeedback to cool sudomotor SCR bursts.', suggestedMin: 3, engine: 'biogsr',
  },
].map((t) => ({ ...t, minutes: t.suggestedMin }));

// The service (and the app's fallback) also uses these ids.
const ALIASES = {
  progressive_muscle: 'pmr_crystal_squeeze',
  breathing_garden: 'flower_meadow',
  guided_meditation: 'box_meditation',
  cosmic_nebula: 'emdr_saccadic_trace',
};

export function findTechnique(id) {
  const key = ALIASES[id] || id;
  return TECHNIQUES.find((t) => t.id === key) || null;
}
