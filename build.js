#!/usr/bin/env node
/* Собирает ВСЁ приложение в один цельный index.html
   (HTML + CSS + three.js + весь игровой код, без единой внешней ссылки). */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const OUT = path.join(__dirname, 'index.html');

const NOTE = `<!--
  VR123 — единый файл. Внутри: three.js + весь код. Внешних запросов нет, работает офлайн.

  ЭТО НЕ УСТАНАВЛИВАЕМЫЙ .apk, А САМОДОСТАТОЧНЫЙ HTML.
  Android на файл с расширением .apk ругается «не удалось обработать этот пакет»:
  он ищет внутри ZIP с AndroidManifest.xml и classes.dex, а здесь HTML.
  Плюс WebXR в Android WebView не поддерживается вовсе (W3C: "Android WebView None"),
  так что apk-обёртка запустила бы игру ХУЖЕ, чем браузер.

  КАК ЗАПУСТИТЬ
  1) Телефон / планшет / ПК: открой этот файл в Chrome (или перетащи в браузер).
     Если Android не даёт открыть файл из загрузок — переименуй в vr123.html.
  2) Шлем (Quest / Pico): скопируй файл на устройство и открой в Oculus Browser —
     там есть WebXR, трекинг рук и кнопка «Войти в VR».

  ЕСЛИ ВСЁ ЖЕ НУЖЕН .apk
  Запусти GitHub Actions: вкладка Actions -> Build APK -> Run workflow,
  артефакт VR123-apk будет содержать app-debug.apk. Но учти: WebXR внутри такого
  apk работать не будет (нет в WebView), только плоский режим.
-->`;

const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(SRC, 'style.css'), 'utf8');
const JS_FILES = ['core.js', 'hands.js', 'tools.js', 'pointer.js', 'npcs.js', 'main.js'];
const js = JS_FILES.map(f => '/* ===== ' + f + ' ===== */\n' + fs.readFileSync(path.join(SRC, 'js', f), 'utf8'));
const three = fs.readFileSync(path.join(SRC, 'vendor', 'three.min.js'), 'utf8');

if (/<\/script>/i.test(three)) throw new Error('в three.min.js встретился </script> — нужна экранировка');
for (const j of js) if (/<\/script>/i.test(j)) throw new Error('</script> внутри игрового кода');

/* ВНИМАНИЕ: заменяем через indexOf, а не String.replace — внутри three.min.js
   есть литерал "$&", а строковая замена трактует $& как «вставить найденное». */
const sub = (hay, needle, repl) => {
  const i = hay.indexOf(needle);
  if (i < 0) throw new Error('не найдено для замены: ' + needle);
  return hay.slice(0, i) + repl + hay.slice(i + needle.length);
};

let out = html;
out = sub(out, '<link rel="stylesheet" href="style.css">', '<style>\n' + css + '\n</style>');
out = sub(out, '<script src="vendor/three.min.js"></script>', '<script>\n' + three + '\n</script>');
out = out.replace(/<script src="js\/[a-z]+\.js"><\/script>\n?/g, '');
out = sub(out, '</body>', '<script>\n' + js.join('\n\n') + '\n</script>\n</body>');
out = sub(out, '<!DOCTYPE html>', '<!DOCTYPE html>\n' + NOTE);

const leftover = (out.match(/(src|href)="[^"#][^"]*"/g) || []);
if (leftover.length) throw new Error('остались внешние ссылки: ' + leftover.join(', '));

fs.writeFileSync(OUT, out);
const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log('готово: ' + path.relative(__dirname, OUT) + '  —  ' + kb + ' КБ, ' +
  (JS_FILES.length + 1) + ' inline-блоков, 0 внешних запросов');
