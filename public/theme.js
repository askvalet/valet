// dark mode follows the system; loaded before first paint so there's no flash (a file, not inline: the page's
// content-security policy runs only Valet's own scripts)
(function () { var m = matchMedia('(prefers-color-scheme: dark)'), t = null;
  try { t = localStorage.getItem('valet-theme'); } catch (e) {}
  var apply = function () { document.documentElement.classList.toggle('dark', t ? t === 'dark' : m.matches); };
  apply(); m.addEventListener('change', apply); })();
