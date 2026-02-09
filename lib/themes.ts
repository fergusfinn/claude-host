export interface TerminalTheme {
  id: string;
  name: string;
  mode: "dark" | "light";
  /** Swatch color shown in the picker */
  swatch: string;
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export const themes: TerminalTheme[] = [
  {
    id: "emerald",
    name: "Emerald",
    mode: "dark",
    swatch: "#34d399",
    background: "#09090b",
    foreground: "#d4d4d8",
    cursor: "#34d399",
    cursorAccent: "#09090b",
    selectionBackground: "#34d39930",
    black: "#18181b",
    red: "#f87171",
    green: "#34d399",
    yellow: "#fbbf24",
    blue: "#60a5fa",
    magenta: "#c084fc",
    cyan: "#22d3ee",
    white: "#e4e4e7",
    brightBlack: "#3f3f46",
    brightRed: "#fca5a5",
    brightGreen: "#6ee7b7",
    brightYellow: "#fde68a",
    brightBlue: "#93c5fd",
    brightMagenta: "#d8b4fe",
    brightCyan: "#67e8f9",
    brightWhite: "#ffffff",
  },
  {
    id: "dracula",
    name: "Dracula",
    mode: "dark",
    swatch: "#bd93f9",
    background: "#282a36",
    foreground: "#f8f8f2",
    cursor: "#f8f8f2",
    cursorAccent: "#282a36",
    selectionBackground: "#44475a",
    black: "#21222c",
    red: "#ff5555",
    green: "#50fa7b",
    yellow: "#f1fa8c",
    blue: "#6272a4",
    magenta: "#bd93f9",
    cyan: "#8be9fd",
    white: "#f8f8f2",
    brightBlack: "#6272a4",
    brightRed: "#ff6e6e",
    brightGreen: "#69ff94",
    brightYellow: "#ffffa5",
    brightBlue: "#d6acff",
    brightMagenta: "#ff92df",
    brightCyan: "#a4ffff",
    brightWhite: "#ffffff",
  },
  {
    id: "nord",
    name: "Nord",
    mode: "dark",
    swatch: "#88c0d0",
    background: "#2e3440",
    foreground: "#d8dee9",
    cursor: "#d8dee9",
    cursorAccent: "#2e3440",
    selectionBackground: "#434c5e",
    black: "#3b4252",
    red: "#bf616a",
    green: "#a3be8c",
    yellow: "#ebcb8b",
    blue: "#81a1c1",
    magenta: "#b48ead",
    cyan: "#88c0d0",
    white: "#e5e9f0",
    brightBlack: "#4c566a",
    brightRed: "#bf616a",
    brightGreen: "#a3be8c",
    brightYellow: "#ebcb8b",
    brightBlue: "#81a1c1",
    brightMagenta: "#b48ead",
    brightCyan: "#8fbcbb",
    brightWhite: "#eceff4",
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    mode: "dark",
    swatch: "#7aa2f7",
    background: "#1a1b26",
    foreground: "#c0caf5",
    cursor: "#c0caf5",
    cursorAccent: "#1a1b26",
    selectionBackground: "#33467c",
    black: "#15161e",
    red: "#f7768e",
    green: "#9ece6a",
    yellow: "#e0af68",
    blue: "#7aa2f7",
    magenta: "#bb9af7",
    cyan: "#7dcfff",
    white: "#a9b1d6",
    brightBlack: "#414868",
    brightRed: "#f7768e",
    brightGreen: "#9ece6a",
    brightYellow: "#e0af68",
    brightBlue: "#7aa2f7",
    brightMagenta: "#bb9af7",
    brightCyan: "#7dcfff",
    brightWhite: "#c0caf5",
  },
  {
    id: "solarized",
    name: "Solarized Dark",
    mode: "dark",
    swatch: "#268bd2",
    background: "#002b36",
    foreground: "#839496",
    cursor: "#839496",
    cursorAccent: "#002b36",
    selectionBackground: "#073642",
    black: "#073642",
    red: "#dc322f",
    green: "#859900",
    yellow: "#b58900",
    blue: "#268bd2",
    magenta: "#d33682",
    cyan: "#2aa198",
    white: "#eee8d5",
    brightBlack: "#586e75",
    brightRed: "#cb4b16",
    brightGreen: "#586e75",
    brightYellow: "#657b83",
    brightBlue: "#839496",
    brightMagenta: "#6c71c4",
    brightCyan: "#93a1a1",
    brightWhite: "#fdf6e3",
  },
  {
    id: "monokai",
    name: "Monokai",
    mode: "dark",
    swatch: "#a6e22e",
    background: "#272822",
    foreground: "#f8f8f2",
    cursor: "#f8f8f0",
    cursorAccent: "#272822",
    selectionBackground: "#49483e",
    black: "#272822",
    red: "#f92672",
    green: "#a6e22e",
    yellow: "#f4bf75",
    blue: "#66d9ef",
    magenta: "#ae81ff",
    cyan: "#a1efe4",
    white: "#f8f8f2",
    brightBlack: "#75715e",
    brightRed: "#f92672",
    brightGreen: "#a6e22e",
    brightYellow: "#f4bf75",
    brightBlue: "#66d9ef",
    brightMagenta: "#ae81ff",
    brightCyan: "#a1efe4",
    brightWhite: "#f9f8f5",
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    mode: "dark",
    swatch: "#cba6f7",
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    cursor: "#f5e0dc",
    cursorAccent: "#1e1e2e",
    selectionBackground: "#45475a",
    black: "#45475a",
    red: "#f38ba8",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    blue: "#89b4fa",
    magenta: "#cba6f7",
    cyan: "#94e2d5",
    white: "#bac2de",
    brightBlack: "#585b70",
    brightRed: "#f38ba8",
    brightGreen: "#a6e3a1",
    brightYellow: "#f9e2af",
    brightBlue: "#89b4fa",
    brightMagenta: "#cba6f7",
    brightCyan: "#94e2d5",
    brightWhite: "#a6adc8",
  },
  {
    id: "rose-pine",
    name: "Rose Pine",
    mode: "dark",
    swatch: "#c4a7e7",
    background: "#191724",
    foreground: "#e0def4",
    cursor: "#524f67",
    cursorAccent: "#e0def4",
    selectionBackground: "#2a283e",
    black: "#26233a",
    red: "#eb6f92",
    green: "#31748f",
    yellow: "#f6c177",
    blue: "#9ccfd8",
    magenta: "#c4a7e7",
    cyan: "#ebbcba",
    white: "#e0def4",
    brightBlack: "#6e6a86",
    brightRed: "#eb6f92",
    brightGreen: "#31748f",
    brightYellow: "#f6c177",
    brightBlue: "#9ccfd8",
    brightMagenta: "#c4a7e7",
    brightCyan: "#ebbcba",
    brightWhite: "#e0def4",
  },
  {
    id: "everforest",
    name: "Everforest Dark",
    mode: "dark",
    swatch: "#a7c080",
    background: "#2d353b",
    foreground: "#d3c6aa",
    cursor: "#d3c6aa",
    cursorAccent: "#2d353b",
    selectionBackground: "#475258",
    black: "#343f44",
    red: "#e67e80",
    green: "#a7c080",
    yellow: "#dbbc7f",
    blue: "#7fbbb3",
    magenta: "#d699b6",
    cyan: "#83c092",
    white: "#d3c6aa",
    brightBlack: "#5c6a72",
    brightRed: "#e67e80",
    brightGreen: "#a7c080",
    brightYellow: "#dbbc7f",
    brightBlue: "#7fbbb3",
    brightMagenta: "#d699b6",
    brightCyan: "#83c092",
    brightWhite: "#e4e1cd",
  },
  {
    id: "gruvbox",
    name: "Gruvbox Dark",
    mode: "dark",
    swatch: "#fabd2f",
    background: "#282828",
    foreground: "#ebdbb2",
    cursor: "#ebdbb2",
    cursorAccent: "#282828",
    selectionBackground: "#3c3836",
    black: "#282828",
    red: "#cc241d",
    green: "#98971a",
    yellow: "#d79921",
    blue: "#458588",
    magenta: "#b16286",
    cyan: "#689d6a",
    white: "#a89984",
    brightBlack: "#928374",
    brightRed: "#fb4934",
    brightGreen: "#b8bb26",
    brightYellow: "#fabd2f",
    brightBlue: "#83a598",
    brightMagenta: "#d3869b",
    brightCyan: "#8ec07c",
    brightWhite: "#ebdbb2",
  },
  {
    id: "one-dark",
    name: "One Dark",
    mode: "dark",
    swatch: "#61afef",
    background: "#282c34",
    foreground: "#abb2bf",
    cursor: "#528bff",
    cursorAccent: "#282c34",
    selectionBackground: "#3e4451",
    black: "#282c34",
    red: "#e06c75",
    green: "#98c379",
    yellow: "#e5c07b",
    blue: "#61afef",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: "#abb2bf",
    brightBlack: "#5c6370",
    brightRed: "#e06c75",
    brightGreen: "#98c379",
    brightYellow: "#e5c07b",
    brightBlue: "#61afef",
    brightMagenta: "#c678dd",
    brightCyan: "#56b6c2",
    brightWhite: "#ffffff",
  },
  {
    id: "kanagawa",
    name: "Kanagawa",
    mode: "dark",
    swatch: "#7e9cd8",
    background: "#1f1f28",
    foreground: "#dcd7ba",
    cursor: "#c8c093",
    cursorAccent: "#1f1f28",
    selectionBackground: "#2d4f67",
    black: "#16161d",
    red: "#c34043",
    green: "#76946a",
    yellow: "#c0a36e",
    blue: "#7e9cd8",
    magenta: "#957fb8",
    cyan: "#6a9589",
    white: "#c8c093",
    brightBlack: "#727169",
    brightRed: "#e82424",
    brightGreen: "#98bb6c",
    brightYellow: "#e6c384",
    brightBlue: "#7fb4ca",
    brightMagenta: "#938aa9",
    brightCyan: "#7aa89f",
    brightWhite: "#dcd7ba",
  },
  {
    id: "ayu-dark",
    name: "Ayu Dark",
    mode: "dark",
    swatch: "#e6b450",
    background: "#0d1017",
    foreground: "#bfbdb6",
    cursor: "#e6b450",
    cursorAccent: "#0d1017",
    selectionBackground: "#273747",
    black: "#01060e",
    red: "#ea6c73",
    green: "#91b362",
    yellow: "#f9af4f",
    blue: "#53bdfa",
    magenta: "#fae994",
    cyan: "#90e1c6",
    white: "#c7c7c7",
    brightBlack: "#686868",
    brightRed: "#f07178",
    brightGreen: "#c2d94c",
    brightYellow: "#ffb454",
    brightBlue: "#59c2ff",
    brightMagenta: "#ffee99",
    brightCyan: "#95e6cb",
    brightWhite: "#ffffff",
  },
  {
    id: "nightfox",
    name: "Nightfox",
    mode: "dark",
    swatch: "#719cd6",
    background: "#192330",
    foreground: "#cdcecf",
    cursor: "#cdcecf",
    cursorAccent: "#192330",
    selectionBackground: "#2b3b51",
    black: "#393b44",
    red: "#c94f6d",
    green: "#81b29a",
    yellow: "#dbc074",
    blue: "#719cd6",
    magenta: "#9d79d6",
    cyan: "#63cdcf",
    white: "#dfdfe0",
    brightBlack: "#575860",
    brightRed: "#d16983",
    brightGreen: "#8ebaa4",
    brightYellow: "#e0c989",
    brightBlue: "#86abdc",
    brightMagenta: "#baa1e2",
    brightCyan: "#7ad5d6",
    brightWhite: "#e4e4e5",
  },
  {
    id: "palenight",
    name: "Palenight",
    mode: "dark",
    swatch: "#c792ea",
    background: "#292d3e",
    foreground: "#a6accd",
    cursor: "#ffcc00",
    cursorAccent: "#292d3e",
    selectionBackground: "#3c435e",
    black: "#292d3e",
    red: "#f07178",
    green: "#c3e88d",
    yellow: "#ffcb6b",
    blue: "#82aaff",
    magenta: "#c792ea",
    cyan: "#89ddff",
    white: "#a6accd",
    brightBlack: "#676e95",
    brightRed: "#f07178",
    brightGreen: "#c3e88d",
    brightYellow: "#ffcb6b",
    brightBlue: "#82aaff",
    brightMagenta: "#c792ea",
    brightCyan: "#89ddff",
    brightWhite: "#ffffff",
  },
  // ---- Light themes ----
  {
    id: "github-light",
    name: "GitHub Light",
    mode: "light",
    swatch: "#0969da",
    background: "#f6f8fa",
    foreground: "#1f2328",
    cursor: "#044289",
    cursorAccent: "#f6f8fa",
    selectionBackground: "#0969da20",
    black: "#24292f",
    red: "#cf222e",
    green: "#116329",
    yellow: "#4d2d00",
    blue: "#0550ae",
    magenta: "#6639ba",
    cyan: "#1b7c83",
    white: "#c8cdd3",
    brightBlack: "#484f58",
    brightRed: "#e16f76",
    brightGreen: "#47a14b",
    brightYellow: "#633c01",
    brightBlue: "#0969da",
    brightMagenta: "#8250df",
    brightCyan: "#3192aa",
    brightWhite: "#dde3ea",
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    mode: "light",
    swatch: "#268bd2",
    background: "#fdf6e3",
    foreground: "#657b83",
    cursor: "#586e75",
    cursorAccent: "#fdf6e3",
    selectionBackground: "#eee8d5",
    black: "#073642",
    red: "#c43030",
    green: "#6a8800",
    yellow: "#946e00",
    blue: "#1a6faa",
    magenta: "#b02868",
    cyan: "#1a877e",
    white: "#e2dcc8",
    brightBlack: "#586e75",
    brightRed: "#dc322f",
    brightGreen: "#859900",
    brightYellow: "#b58900",
    brightBlue: "#268bd2",
    brightMagenta: "#6c71c4",
    brightCyan: "#2aa198",
    brightWhite: "#f5efd8",
  },
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    mode: "light",
    swatch: "#8839ef",
    background: "#eff1f5",
    foreground: "#4c4f69",
    cursor: "#dc8a78",
    cursorAccent: "#eff1f5",
    selectionBackground: "#acb0be",
    black: "#5c5f77",
    red: "#d20f39",
    green: "#40a02b",
    yellow: "#b87010",
    blue: "#1a58d0",
    magenta: "#7030cc",
    cyan: "#107080",
    white: "#d2d6dd",
    brightBlack: "#6c6f85",
    brightRed: "#e5435a",
    brightGreen: "#50b038",
    brightYellow: "#df8e1d",
    brightBlue: "#1e66f5",
    brightMagenta: "#8839ef",
    brightCyan: "#179299",
    brightWhite: "#d7dae1",
  },
  {
    id: "rose-pine-dawn",
    name: "Rose Pine Dawn",
    mode: "light",
    swatch: "#907aa9",
    background: "#faf4ed",
    foreground: "#575279",
    cursor: "#575279",
    cursorAccent: "#faf4ed",
    selectionBackground: "#dfdad9",
    black: "#575279",
    red: "#b4637a",
    green: "#286983",
    yellow: "#c47a1a",
    blue: "#3e7a84",
    magenta: "#725a8a",
    cyan: "#b0605c",
    white: "#e6ddd4",
    brightBlack: "#9893a5",
    brightRed: "#d0707e",
    brightGreen: "#3a8098",
    brightYellow: "#ea9d34",
    brightBlue: "#56949f",
    brightMagenta: "#907aa9",
    brightCyan: "#d7827e",
    brightWhite: "#efe8df",
  },
  {
    id: "everforest-light",
    name: "Everforest Light",
    mode: "light",
    swatch: "#8da101",
    background: "#fdf6e3",
    foreground: "#5c6a72",
    cursor: "#5c6a72",
    cursorAccent: "#fdf6e3",
    selectionBackground: "#e6e2cc",
    black: "#5c6a72",
    red: "#c24040",
    green: "#6e8a00",
    yellow: "#a87800",
    blue: "#2a7a9f",
    magenta: "#b84a95",
    cyan: "#2a8a60",
    white: "#dbd7c0",
    brightBlack: "#939f91",
    brightRed: "#d44040",
    brightGreen: "#8da101",
    brightYellow: "#c49000",
    brightBlue: "#3a94c5",
    brightMagenta: "#d060a8",
    brightCyan: "#35a77c",
    brightWhite: "#f3eed5",
  },
  {
    id: "gruvbox-light",
    name: "Gruvbox Light",
    mode: "light",
    swatch: "#d65d0e",
    background: "#fbf1c7",
    foreground: "#3c3836",
    cursor: "#3c3836",
    cursorAccent: "#fbf1c7",
    selectionBackground: "#ebdbb2",
    black: "#3c3836",
    red: "#cc241d",
    green: "#7a8a00",
    yellow: "#b57614",
    blue: "#076678",
    magenta: "#8f3f71",
    cyan: "#427b58",
    white: "#e0d0a4",
    brightBlack: "#928374",
    brightRed: "#d44030",
    brightGreen: "#98971a",
    brightYellow: "#d79921",
    brightBlue: "#458588",
    brightMagenta: "#b16286",
    brightCyan: "#689d6a",
    brightWhite: "#f2e8b5",
  },
  {
    id: "one-light",
    name: "One Light",
    mode: "light",
    swatch: "#4078f2",
    background: "#fafafa",
    foreground: "#383a42",
    cursor: "#526eff",
    cursorAccent: "#fafafa",
    selectionBackground: "#e5e5e6",
    black: "#383a42",
    red: "#e45649",
    green: "#50a14f",
    yellow: "#c18401",
    blue: "#4078f2",
    magenta: "#a626a4",
    cyan: "#0184bc",
    white: "#d3d3d4",
    brightBlack: "#a0a1a7",
    brightRed: "#e06c75",
    brightGreen: "#50a14f",
    brightYellow: "#c18401",
    brightBlue: "#4078f2",
    brightMagenta: "#a626a4",
    brightCyan: "#0184bc",
    brightWhite: "#fafafa",
  },
  {
    id: "ayu-light",
    name: "Ayu Light",
    mode: "light",
    swatch: "#ff9940",
    background: "#fafafa",
    foreground: "#575f66",
    cursor: "#ff6a00",
    cursorAccent: "#fafafa",
    selectionBackground: "#d1e4f4",
    black: "#575f66",
    red: "#c53030",
    green: "#5a8c00",
    yellow: "#b87d1a",
    blue: "#1a7bbf",
    magenta: "#7c54a8",
    cyan: "#2e946e",
    white: "#d1d2d3",
    brightBlack: "#828c99",
    brightRed: "#e65050",
    brightGreen: "#6ca000",
    brightYellow: "#cc8f30",
    brightBlue: "#399ee6",
    brightMagenta: "#a37acc",
    brightCyan: "#3aaa80",
    brightWhite: "#fafafa",
  },
  {
    id: "tokyo-night-light",
    name: "Tokyo Night Light",
    mode: "light",
    swatch: "#34548a",
    background: "#d5d6db",
    foreground: "#343b59",
    cursor: "#343b59",
    cursorAccent: "#d5d6db",
    selectionBackground: "#9699a3",
    black: "#343b59",
    red: "#8c4351",
    green: "#33635c",
    yellow: "#8f5e15",
    blue: "#34548a",
    magenta: "#5a4a78",
    cyan: "#0f4b6e",
    white: "#9699a3",
    brightBlack: "#9699a3",
    brightRed: "#8c4351",
    brightGreen: "#33635c",
    brightYellow: "#8f5e15",
    brightBlue: "#34548a",
    brightMagenta: "#5a4a78",
    brightCyan: "#0f4b6e",
    brightWhite: "#d5d6db",
  },
  {
    id: "nord-light",
    name: "Nord Light",
    mode: "light",
    swatch: "#5e81ac",
    background: "#eceff4",
    foreground: "#2e3440",
    cursor: "#2e3440",
    cursorAccent: "#eceff4",
    selectionBackground: "#d8dee9",
    black: "#2e3440",
    red: "#a5323b",
    green: "#637a4a",
    yellow: "#a07020",
    blue: "#4a6a8c",
    magenta: "#8a5d84",
    cyan: "#4c8a7e",
    white: "#d8dee9",
    brightBlack: "#4c566a",
    brightRed: "#bf3b44",
    brightGreen: "#768c5c",
    brightYellow: "#b88830",
    brightBlue: "#5e81ac",
    brightMagenta: "#a06a98",
    brightCyan: "#5a9a8e",
    brightWhite: "#eceff4",
  },
];

export interface TerminalFont {
  id: string;
  name: string;
  fontFamily: string;
  /** Google Fonts URL to load, if not a system font */
  googleFontsUrl?: string;
}

export const fonts: TerminalFont[] = [
  {
    id: "ibm-plex-mono",
    name: "IBM Plex Mono",
    fontFamily: "'IBM Plex Mono', 'Symbols Nerd Font Mono', 'Noto Sans Mono', monospace",
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap",
  },
  {
    id: "jetbrains-mono",
    name: "JetBrains Mono",
    fontFamily: "'JetBrains Mono', 'Symbols Nerd Font Mono', 'Noto Sans Mono', monospace",
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap",
  },
  {
    id: "fira-code",
    name: "Fira Code",
    fontFamily: "'Fira Code', 'Symbols Nerd Font Mono', 'Noto Sans Mono', monospace",
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&display=swap",
  },
  {
    id: "source-code-pro",
    name: "Source Code Pro",
    fontFamily: "'Source Code Pro', 'Symbols Nerd Font Mono', 'Noto Sans Mono', monospace",
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=Source+Code+Pro:wght@400;500;600&display=swap",
  },
  {
    id: "inconsolata",
    name: "Inconsolata",
    fontFamily: "'Inconsolata', 'Symbols Nerd Font Mono', 'Noto Sans Mono', monospace",
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=Inconsolata:wght@400;500;600&display=swap",
  },
  {
    id: "sf-mono",
    name: "SF Mono",
    fontFamily: "'SF Mono', 'Symbols Nerd Font Mono', 'Noto Sans Mono', monospace",
  },
  {
    id: "menlo",
    name: "Menlo",
    fontFamily: "Menlo, 'Symbols Nerd Font Mono', 'Noto Sans Mono', monospace",
  },
  {
    id: "monaco",
    name: "Monaco",
    fontFamily: "Monaco, 'Symbols Nerd Font Mono', 'Noto Sans Mono', monospace",
  },
  {
    id: "cascadia-code",
    name: "Cascadia Code",
    fontFamily: "'Cascadia Code', 'Symbols Nerd Font Mono', 'Noto Sans Mono', monospace",
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=Cascadia+Code:wght@400;500;600&display=swap",
  },
  {
    id: "roboto-mono",
    name: "Roboto Mono",
    fontFamily: "'Roboto Mono', 'Symbols Nerd Font Mono', 'Noto Sans Mono', monospace",
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500;600&display=swap",
  },
  {
    id: "ubuntu-mono",
    name: "Ubuntu Mono",
    fontFamily: "'Ubuntu Mono', 'Symbols Nerd Font Mono', 'Noto Sans Mono', monospace",
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=Ubuntu+Mono:wght@400;700&display=swap",
  },
  {
    id: "space-mono",
    name: "Space Mono",
    fontFamily: "'Space Mono', 'Symbols Nerd Font Mono', 'Noto Sans Mono', monospace",
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap",
  },
  {
    id: "geist-mono",
    name: "Geist Mono",
    fontFamily: "'Geist Mono', 'Symbols Nerd Font Mono', 'Noto Sans Mono', monospace",
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600&display=swap",
  },
  {
    id: "commit-mono",
    name: "Commit Mono",
    fontFamily: "'Commit Mono', 'Symbols Nerd Font Mono', 'Noto Sans Mono', monospace",
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=Commit+Mono:wght@400;700&display=swap",
  },
  {
    id: "hack",
    name: "Hack",
    fontFamily: "Hack, 'Symbols Nerd Font Mono', 'Noto Sans Mono', monospace",
  },
];

export const DEFAULT_FONT_ID = "ibm-plex-mono";

export function getFontById(id: string): TerminalFont {
  return fonts.find((f) => f.id === id) ?? fonts[0];
}

/** Load a Google Font if needed. No-ops if already loaded or not a Google Font. */
export function ensureFontLoaded(font: TerminalFont): void {
  if (!font.googleFontsUrl || typeof document === "undefined") return;
  const linkId = `font-${font.id}`;
  if (document.getElementById(linkId)) return;
  const link = document.createElement("link");
  link.id = linkId;
  link.rel = "stylesheet";
  link.href = font.googleFontsUrl;
  document.head.appendChild(link);
}

export const DEFAULT_DARK_THEME = "gruvbox";
export const DEFAULT_LIGHT_THEME = "github-light";

export function getThemeById(id: string): TerminalTheme {
  return themes.find((t) => t.id === id) ?? themes[0];
}

export function getDefaultThemeForMode(mode: "dark" | "light"): TerminalTheme {
  return getThemeById(mode === "dark" ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME);
}

export function themesForMode(mode: "dark" | "light"): TerminalTheme[] {
  return themes.filter((t) => t.mode === mode);
}

/** Extract the xterm ITheme object from our theme definition */
export function toXtermTheme(theme: TerminalTheme) {
  const { id, name, mode, swatch, ...xtermFields } = theme;
  return xtermFields;
}

/* ---- Chrome color derivation ---- */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Blend `color` toward `target` by `amount` (0 = color, 1 = target) */
function mix(color: string, target: string, amount: number): string {
  const [r1, g1, b1] = hexToRgb(color);
  const [r2, g2, b2] = hexToRgb(target);
  return rgbToHex(
    r1 + (r2 - r1) * amount,
    g1 + (g2 - g1) * amount,
    b1 + (b2 - b1) * amount,
  );
}

/**
 * Derive all UI chrome CSS custom properties from a terminal theme.
 * This makes the tab bar, backgrounds, borders, text, and accent colors
 * match the selected terminal color scheme.
 */
export function themeToChromeVars(theme: TerminalTheme): Record<string, string> {
  const bg = theme.background;
  const fg = theme.foreground;
  const accent = theme.swatch;
  const isDark = theme.mode === "dark";

  // Mix toward the theme's own white/black to preserve color temperature
  // (pure #fff/#000 strips warmth from Gruvbox, coolness from Nord, etc.)
  const step = isDark ? theme.white : theme.black;

  // Background levels — step toward the theme's own light/dark tone
  const bg0 = bg;
  const bg1 = mix(bg, step, 0.06);
  const bg2 = mix(bg, step, 0.12);
  const bg3 = mix(bg, step, 0.18);
  const bg4 = mix(bg, step, 0.24);

  // Borders — anchor on brightBlack (the theme's "comment" gray)
  const border = mix(bg, theme.brightBlack, 0.40);
  const borderHover = mix(bg, theme.brightBlack, 0.65);

  // Text levels — use the theme's palette for natural hierarchy:
  //   text-0: foreground (primary)
  //   text-1: slightly muted toward the theme's gray
  //   text-2: the theme's brightBlack ("comment" color)
  //   text-3: brightBlack faded toward background
  const text0 = fg;
  const text1 = mix(fg, theme.brightBlack, 0.20);
  const text2 = theme.brightBlack;
  const text3 = mix(theme.brightBlack, bg, 0.40);

  // Accent from theme swatch
  const accentDim = `${accent}26`;
  const accentHover = isDark
    ? mix(accent, theme.brightWhite, 0.25)
    : mix(accent, theme.black, 0.20);

  // Danger
  const danger = isDark ? "#ef4444" : "#dc2626";
  const dangerDim = isDark ? "rgba(239,68,68,0.1)" : "rgba(220,38,38,0.1)";

  // Terminal preview areas
  const termBg = isDark ? mix(bg, "#000000", 0.30) : theme.black;
  const termText = mix(fg, bg, 0.35);
  const termBorder = mix(bg, theme.brightBlack, 0.30);

  // Shadows & backdrop
  const shadowDropdown = isDark ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0.1)";
  const shadowDialog = isDark ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.15)";
  const backdrop = isDark ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.2)";

  return {
    "--bg-0": bg0,
    "--bg-1": bg1,
    "--bg-2": bg2,
    "--bg-3": bg3,
    "--bg-4": bg4,
    "--border": border,
    "--border-hover": borderHover,
    "--text-0": text0,
    "--text-1": text1,
    "--text-2": text2,
    "--text-3": text3,
    "--accent": accent,
    "--accent-dim": accentDim,
    "--accent-hover": accentHover,
    "--danger": danger,
    "--danger-dim": dangerDim,
    "--term-bg": termBg,
    "--term-text": termText,
    "--term-border": termBorder,
    "--shadow-dropdown": shadowDropdown,
    "--shadow-dialog": shadowDialog,
    "--backdrop": backdrop,
  };
}
