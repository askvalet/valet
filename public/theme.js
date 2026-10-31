// dark mode follows the system unless the config or the switch says otherwise, and the config's look goes back on from
// last time; loaded before first paint so there's no flash (a file, not inline: the page's content-security policy
// runs only Valet's own scripts)
(function () { var m = matchMedia('(prefers-color-scheme: dark)'), root = document.documentElement, l = null;
  var saved = function () { try { return localStorage.getItem('valet-theme'); } catch (e) { return null; } };
  try { l = JSON.parse(localStorage.getItem('valet-look')); } catch (e) {}
  if (l) { if (l.theme !== 'auto') root.dataset.theme = l.theme;
    for (var k in l.vars) root.style.setProperty(k, l.vars[k]);
    root.classList.add.apply(root.classList, l.classes); }
  var apply = function () { var t = root.dataset.theme || saved(); root.classList.toggle('dark', t ? t === 'dark' : m.matches); };
  apply(); m.addEventListener('change', apply); })();
