// Before the page paints: the theme the visitor chose last, if any; otherwise
// home.css follows the system's light or dark setting.
try {
  const theme = localStorage.getItem('artifex-theme');
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
} catch (e) { /* storage refused: the system's setting holds */ }
