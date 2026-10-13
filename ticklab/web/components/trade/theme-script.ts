export const THEME_KEY = "tradeye-theme";

/** Inline head script to set the initial theme class before first paint. */
export function themeInitScript(): string {
  return `(function(){try{var s=localStorage.getItem('${THEME_KEY}');var d=s==='dark'||(s!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}})();`;
}
