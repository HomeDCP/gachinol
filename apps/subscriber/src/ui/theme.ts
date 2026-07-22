/** 최소 스타일 상수 — 다음 단계에서 packages/ui 디자인시스템으로 승격 예정, 여기 이상 확장 금지 */

export const colors = {
  bg: '#F7F7F8',
  card: '#FFFFFF',
  border: '#E5E5EA',
  text: '#111114',
  textMuted: '#6E6E76',
  primary: '#2563EB',
  danger: '#DC2626',
  warning: '#D97706',
  success: '#16A34A',
  info: '#4F46E5',
  neutral: '#8E8E93',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

export const radii = { sm: 6, md: 10, lg: 16 } as const;

export const typo = { title: 20, body: 16, caption: 13 } as const;

/** tone → { bg(연한), fg(진한) } */
export const badgeTone = {
  neutral: { bg: '#EFEFF1', fg: '#5A5A63' },
  info: { bg: '#E9E8FB', fg: '#4F46E5' },
  success: { bg: '#E3F4E8', fg: '#16A34A' },
  warning: { bg: '#FBEEDC', fg: '#D97706' },
  danger: { bg: '#FBE3E3', fg: '#DC2626' },
} as const;

export type BadgeToneName = keyof typeof badgeTone;
