// Entitlements & Tier Gating for TradingView Charting Workspace
// Free vs Pro tier with graceful badges and upgrade prompts

export const ENTITLEMENTS = {
  free: {
    maxIndicators: 3,
    maxTemplates: 2,
    maxAlerts: 3,
    multiChart: false,
    replayMode: false,
    advancedExport: false,
    volumeProfile: false,
  },
  pro: {
    maxIndicators: 50,
    maxTemplates: 100,
    maxAlerts: 50,
    multiChart: true,
    replayMode: true,
    advancedExport: true,
    volumeProfile: true,
  },
};

export function getUserTier(state) {
  // Can be configured in settings or defaults to 'pro' for our hedge fund users
  return state?.settings?.userTier || 'pro';
}

export function canAccessFeature(featureName, state) {
  const tier = getUserTier(state);
  const limits = ENTITLEMENTS[tier] || ENTITLEMENTS.free;

  if (typeof limits[featureName] === 'boolean') {
    return { allowed: limits[featureName], tier, required: 'pro' };
  }
  return { allowed: true, limit: limits[featureName] || Infinity, tier };
}
