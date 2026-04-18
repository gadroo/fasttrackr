/**
 * Concrete color palettes for charts. Recharts requires actual hex strings —
 * CSS custom properties don't work reliably because getComputedStyle can
 * return empty values during hydration or before stylesheets load.
 *
 * These palettes are colorblind-safe (Wong palette adapted) with luminance
 * tuned per theme: muted-for-white, brighter-for-dark.
 */

const LIGHT_CHART_COLORS = [
  "#e66100", // orange
  "#5d3a9b", // purple
  "#1a85ff", // blue
  "#d41159", // magenta
  "#40b0a6", // teal
  "#e6a800", // gold
  "#7c4dff", // violet
  "#00a676", // emerald
  "#e8590c", // burnt orange
  "#8b5cf6", // lavender
];

const DARK_CHART_COLORS = [
  "#ff8a3d", // orange (brighter)
  "#b39ddb", // purple (lighter)
  "#64b5f6", // blue (lighter)
  "#f06292", // magenta (lighter)
  "#80cbc4", // teal (lighter)
  "#ffd54f", // gold (brighter)
  "#b388ff", // violet (lighter)
  "#69f0ae", // emerald (brighter)
  "#ff9e80", // burnt orange (lighter)
  "#ce93d8", // lavender (lighter)
];

export function getChartColors(isDark: boolean): string[] {
  return isDark ? DARK_CHART_COLORS : LIGHT_CHART_COLORS;
}

export function getChartVars(isDark: boolean) {
  if (isDark) {
    return {
      grid: "#2a2f42",
      axis: "#94a3b8",
      tooltipBg: "rgba(21, 25, 37, 0.96)",
      tooltipBorder: "#2a2f42",
      tooltipShadow: "0 12px 30px -18px rgba(0, 0, 0, 0.85)",
      label: "#f1f5f9",
      legend: "#94a3b8",
      text: "#f1f5f9",
      surface: "#151925",
      successFill: "#4ade80",
      mutedFill: "#232840",
    };
  }

  return {
    grid: "#e2e8f0",
    axis: "#64748b",
    tooltipBg: "rgba(255, 255, 255, 0.96)",
    tooltipBorder: "#cbd5e1",
    tooltipShadow: "0 12px 30px -18px rgba(15, 23, 42, 0.85)",
    label: "#0f172a",
    legend: "#475569",
    text: "#0f172a",
    surface: "#ffffff",
    successFill: "#16a34a",
    mutedFill: "#e2e8f0",
  };
}
