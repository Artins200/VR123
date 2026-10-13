# Как довести до публикации — пошагово

Всё уже собрано и лежит в этой папке. Этот файл — инструкция для агента (Claude Code / Codex)
или для человека, который будет публиковать. Ничего решать не надо, только выполнять.

## Что уже есть

| Что | Где |
|---|---|
| Исходники конвертера (C) | `src/` |
| Дизайн, источник правды | `sheets/*.json` |
| Генератор кода из таблиц | `tools/gen_data.mjs` |
| Проверка таблиц перед сборкой | `tools/preflight.mjs` |
| Тесты (58 юнит + end-to-end + Windows-сборка) | `tests/run_tests.sh` |
| Упаковка релиза | `tools/package.mjs` |
| Готовый архив для загрузки | `dist/TerrorStrike-1.0.0.zip` |
| Черновик рецепта установки | `melty.json` |

## Что нужно на ПК

1. **Node.js 22 или новее** — https://nodejs.org/en/download → «Windows Installer (.msi)», 64-bit,
   в установщике всё по умолчанию (галочка «Add to PATH» стоит сама).
   Версия важна: `@anthropic-ai/claude-code` требует `node >=22`.
2. **Агент** (нужен вход под твоим аккаунтом — это могу сделать только ты):
   - Claude Code: `npm install -g @anthropic-ai/claude-code` (проверено на npm: версия 2.1.296, 2026-10-09)
   - или Codex: `npm install -g @openai/codex` (версия 0.162.1, 2026-10-09)
3. **Обе игры** в Steam: Red Alert 2 / Yuri's Revenge и Counter-Strike: Source.
4. **Приложение Melty** — https://melty.gg/download (оно нужно для шага с тестом: Melty сам
   подхватывает релиз, ставит и запускает его).

## Шаг 0. Подключить Melty к агенту

```
claude mcp add --transport http melty https://melty.gg/api/mcp --header "Authorization: Bearer <ТОКЕН>"
```

`<ТОКЕН>` — строка из Publish prompt: melty.gg → Create → «Send instructions to coding agent»,
или в приложении Melty: Studio → Coding agents. Токен нигде не коммитить и не светить в чате.

Проверка: вызвать `list_my_mods`. Если отвечает — связь есть.

## Шаг 1. Собрать и проверить на настоящих играх

```
git clone https://github.com/Artins200/VR123.git
cd VR123 && git checkout arena/401b8d9e-vr123 && cd ra2-terror-strike
node tools/preflight.mjs
bash tests/run_tests.sh          # нужен любой C-компилятор; для Windows-сборки — pip install ziglang
```

Дальше прогон на реальных играх (пути подставь свои):

```
dist\TerrorStrike.exe --test ^
  --ra2 "C:\Program Files (x86)\Steam\steamapps\common\Command and Conquer Red Alert II" ^
  --css "C:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Source" ^
  --log melty.log
```

В `melty.log` должно быть:
- по строке `host: ... rules ini found ...` и `art ini found ...`;
- `companion: scripts/weapon_ak47.txt -> TSAK47 ...` и так по всем пяти оружию;
- `cameo tsakic.shp <- materials/models/weapons/v_models/...` по всем пяти иконкам;
- последняя строка `Terror Strike test build finished: clean`, код возврата 0.

Если что-то из этого не нашлось — это первое, что чинить: значит реальный архив игры отличается
от того, на чём тестировалось. Тогда запуск без `--test` и игра.

## Шаг 2. Реальный скриншот

Запустить без `--test` (мод сам стартует `gamemd.exe`), начать skirmish, построить бараки,
снять кадр с операторами и их иконками в сайдбаре (Win+Shift+S или оверлей Steam).
Никаких токенов и личных окон в кадре. Без этого шага публиковать нельзя.

## Шаг 3. Черновик на Melty

`create_mod` со значениями из `sheets/meta.json`:

- title: **Yuri's Revenge: Terror Strike**
- tagline: **Counter-Strike: Source's guns, sounds and bomb-defusal rules, converted into your own Red Alert 2 / Yuri's Revenge.**
- description: раздел «What a player gets» из `README.md`
- games: `pc-command-conquer-red-alert-2-and-yuri-s-revenge` — **primary**;
  `pc-counter-strike-source` — **companion**
- license: **MIT**, remix: **разрешён**
- credits: Westwood Studios / EA (хост), Valve / команда Counter-Strike (компаньон), автор мешапа (код, MIT)
- `githubRepo`: `Artins200/VR123` — если ответит «уже опубликован», значит репозиторий занят,
  тогда публиковать без githubRepo

Записать `modId`, он нужен дальше.

## Шаг 4. Загрузка

Сначала пересчитать размер и хеш именно того файла, который грузишь (после пересборки они меняются):

```
python -c "import hashlib,os;p='dist/TerrorStrike-1.0.0.zip';print(os.path.getsize(p), hashlib.sha256(open(p,'rb').read()).hexdigest())"
```

На момент последней сборки: **145194 байт**, sha256 `014a18a2b9187d544f31779289e41288aee47790b6b11eb748d3c33b2b419506`.

1. `start_upload` — fileName `TerrorStrike-1.0.0.zip`, размер и sha256 из команды выше
2. PUT байтов архива по выданным заголовкам (заголовок Authorization туда **не** добавлять)
3. `finish_upload` → получить `uploadId`

## Шаг 5. Отправить релиз

`submit_release`: version `1.0.0`, `uploadIds` из шага 4, рецепт из `melty.json`.
Перед этим прогнать `inspect_package`, `validate_recipe` и `one_click_check` и исправить всё,
что они покажут. `component.fileName` обязан совпадать с тем, что загружено.

Если публикуешь через `githubRepo` — положить проверенный рецепт в `melty.json` **в корень
репозитория** (сейчас он в `ra2-terror-strike/`), тогда Melty читает установку прямо из ссылки
на GitHub и следующие релизы публикуются сами.

## Шаг 6. Скриншот

`add_screenshot` → PUT по выданным заголовкам → `finish_screenshot`. До завершения этой загрузки
не публиковать.

## Шаг 7. Тест

`test_release` — Melty на этом ПК подхватит релиз в течение минуты, поставит его так же, как
получают игроки, и запустит. Дальше `test_result`, пока не закончится; что покажет — починить
и повторить. У мода есть режим для этого: `--test` (см. `recipe.test.checks`).

## Шаг 8. Публикация

`publish` → `mod_status`. «Live» можно считать только когда это подтвердил сервер; если статус
«на проверке» — так и говорить, и дать ссылку на Studio. `install_outcomes` покажет, как у
игроков проходят установки.

## Если что-то пойдёт не так

- `melty.gg` не отвечает — проблема сети на этой машине, токен ни при чём.
- `one_click_check` говорит «нет» — каждый пункт приходит со своим «как починить».
- Игра не видит новых юнитов — смотреть, записались ли `rulesmd.ini`/`artmd.ini` в папку игры
  и нет ли в логе `warn`.
- Пропали иконки — значит не нашлась палитра или текстура; мод при этом продолжает работать
  на родных иконках игры (так задумано).
- Откатить изменения в игре: удалить файлы из `terrorstrike-manifest.json` в папке RA2.
