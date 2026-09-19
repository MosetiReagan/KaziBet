export interface ThemeColors {
  background: string;
  surface: string;
  surfaceLight: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
  primary: string;
  danger: string;
  warning: string;
  success: string;
  border: string;
}

export const DEFAULT_DARK_THEME: ThemeColors = {
  background: '#090d16',
  surface: '#121a29',
  surfaceLight: '#1e293b',
  textPrimary: '#f8fafc',
  textSecondary: '#94a3b8',
  accent: '#10b981', // emerald green
  primary: '#0284c7', // vibrant blue
  danger: '#ef4444',
  warning: '#f59e0b',
  success: '#10b981',
  border: '#334155'
};
