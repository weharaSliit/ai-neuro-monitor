export const calculateBadges = (historyList = [], profileData = null) => {
  const baseCount = profileData?.recent_interventions_count ?? 3;
  const completedCount = baseCount + (historyList?.length || 0);

  const baseXP = profileData?.xp_points ?? 250;
  const historyXP = (historyList || []).reduce((acc, sess) => {
    const ratingBonus = (sess.star_rating || 5) * 20;
    return acc + 150 + ratingBonus;
  }, 0);
  const liveXP = baseXP + historyXP;

  const baseStreak = profileData?.streak_days ?? 3;
  const uniqueDays = new Set(
    (historyList || []).map((h) => {
      const d = h.timestamp ? new Date(h.timestamp * 1000) : new Date();
      return d.toISOString().split('T')[0];
    })
  );
  const liveStreak = Math.max(baseStreak, baseStreak + uniqueDays.size);

  return [
    {
      id: 'streak_legend',
      title: 'Streak Legend',
      icon: '🔥',
      description: `Maintained ${liveStreak}-day streak`,
      unlocked: liveStreak >= 1
    },
    {
      id: 'zen_novice',
      title: 'Zen Novice',
      icon: '🌱',
      description: 'Completed 1st relaxation technique',
      unlocked: completedCount >= 1
    },
    {
      id: 'calm_champion',
      title: 'Calm Champion',
      icon: '🧘',
      description: 'Completed 5+ guided sessions',
      unlocked: completedCount >= 5
    },
    {
      id: 'deep_relief',
      title: 'Deep Recovery',
      icon: '🌊',
      description: 'Achieved high recovery rating',
      unlocked: completedCount >= 3 || (historyList || []).some((s) => (s.star_rating || 5) >= 4)
    },
    {
      id: 'xp_overachiever',
      title: 'XP Overachiever',
      icon: '⚡',
      description: 'Earned 500+ total XP points',
      unlocked: liveXP >= 500
    },
    {
      id: 'mindfulness_guru',
      title: 'Mindfulness Guru',
      icon: '🏆',
      description: 'Completed 10+ total sessions',
      unlocked: completedCount >= 10
    }
  ];
};

export const checkNewlyUnlockedBadges = (prevHistoryList = [], newHistoryList = [], profileData = null) => {
  const prevBadges = calculateBadges(prevHistoryList, profileData);
  const newBadges = calculateBadges(newHistoryList, profileData);

  const prevUnlockedIds = new Set(prevBadges.filter((b) => b.unlocked).map((b) => b.id));
  return newBadges.filter((b) => b.unlocked && !prevUnlockedIds.has(b.id));
};
