// dark mode follows the device unless the config or the switch says otherwise, and the config's look goes back on from
// last time; loaded before first paint so there's no flash (a file, not inline: the page's content-security policy
// runs only Valet's own scripts)
(function () { var root = document.documentElement, l = null, own = null;
  try { l = JSON.parse(localStorage.getItem('valet-look')); } catch (e) {}
  try { own = localStorage.getItem('valet-theme'); } catch (e) {}
  if (l) { for (var k in l.vars) root.style.setProperty(k, l.vars[k]);
    if (l.classes) root.classList.add.apply(root.classList, l.classes); }
  try { var g = localStorage.getItem('valet-glass'); if (g) root.classList.toggle('glass-liquid', g === 'liquid'); } catch (e) {}
  // as look.ts's applyTheme decides: light and dark are the config's, auto over a wallpaper is dark glass, and otherwise
  // this browser's switch or the device's own setting (system follows the device over a wallpaper too)
  var t = l && l.theme, forced = t === 'light' || t === 'dark' ? t : t === 'auto' && l.wall ? 'dark' : '';
  if (forced) root.dataset.theme = forced;
  root.classList.toggle('dark', forced ? forced === 'dark' : own ? own === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches); })();
// the browser's own chrome (and an installed app's title bar) wears the page's background, whichever way it turns
(function () { var root = document.documentElement, meta = document.querySelector('meta[name="theme-color"]'); if (!meta) return;
  var paint = function () { meta.setAttribute('content', root.classList.contains('dark') ? '#0f0f10' : '#f5f5f7'); };
  paint(); new MutationObserver(paint).observe(root, { attributes: true, attributeFilter: ['class'] }); })();
