export const motionProfiles = {
  expressive: {
    spatial: {
      fast: { duration: 0.35, ease: [0.42, 1.67, 0.21, 0.9] } as const,
      default: { duration: 0.5, ease: [0.38, 1.21, 0.22, 1] } as const,
      slow: { duration: 0.65, ease: [0.39, 1.29, 0.35, 0.98] } as const,
    },
    effects: {
      fast: { duration: 0.15, ease: [0.31, 0.94, 0.34, 1] } as const,
      default: { duration: 0.2, ease: [0.34, 0.8, 0.34, 1] } as const,
      slow: { duration: 0.3, ease: [0.34, 0.88, 0.34, 1] } as const,
    },
  },
  standard: {
    spatial: {
      fast: { duration: 0.35, ease: [0.27, 1.06, 0.18, 1] } as const,
      default: { duration: 0.5, ease: [0.27, 1.06, 0.18, 1] } as const,
      slow: { duration: 0.75, ease: [0.27, 1.06, 0.18, 1] } as const,
    },
    effects: {
      fast: { duration: 0.15, ease: [0.31, 0.94, 0.34, 1] } as const,
      default: { duration: 0.2, ease: [0.34, 0.8, 0.34, 1] } as const,
      slow: { duration: 0.3, ease: [0.34, 0.88, 0.34, 1] } as const,
    },
  },
} as const

export const uiMotion = {
  overlay: {
    fadeDefault: motionProfiles.standard.effects.default,
  },
  modal: {
    sheetOpen: motionProfiles.standard.spatial.default,
    sheetOpenExpressive: motionProfiles.expressive.spatial.fast,
    openExpressiveSpatial: motionProfiles.expressive.spatial.fast,
  },
  trade: {
    tabIndicator: motionProfiles.standard.spatial.default,
    segmentedIndicator: motionProfiles.expressive.spatial.fast,
    tabContentFade: motionProfiles.standard.effects.default,
    advancedPanel: motionProfiles.expressive.effects.default,
    advancedOptions: motionProfiles.expressive.spatial.fast,
    searchSheet: motionProfiles.expressive.spatial.fast,
  },
} as const
