# Alta Capital — חברת השקעות בניהול סוכנים

דשבורד סטטי (ללא build, ללא שרת) שמריץ צוות סוכנים שמאתר אסטרטגיות מסחר, בודק אותן על נתוני עבר, מייעל אותן,
פותח גרסה חדשה בכל שיפור של אחוז אחד ב־out-of-sample, ומייצא קוד לבוטים בקוד פתוח כמו Freqtrade, Jesse ו־OctoBot.

**המערכת מיועדת למחקר, בקטסטים ומסחר על נייר בלבד. אין בה חיבור לבורסה ואין שליחת פקודות.**

---

## מה יש כאן

| שכבה | קובץ | תפקיד |
| --- | --- | --- |
| שולחנות וסוכנים | `src/firm.js` | מחזורי עבודה, קידום גרסאות, dry-run, הרצת נייר |
| מנוע בקטסט | `src/backtest.js` | עמלות, סטופ ATR, סיזינג לפי סיכון, 70/30 IS/OOS |
| אופטימיזציה | `src/optimizer.js` | דגימה אקראית + טיפוס מקומי עם זרע מהגרסה הקיימת |
| אסטרטגיות | `src/strategies.js` | EMA, RSI, Donchian, מומנטום, MACD |
| נתוני שוק | `src/market.js` | Binance → Kraken → Coinbase, ונפילה לנתוני הדגמה |
| מחקר | `src/research.js` | GitHub Search, Fear & Greed, CoinGecko, Reddit, חדשות |
| ייצוא קוד | `src/platforms.js` | Freqtrade, Jesse, OctoBot, Superalgos, TradingView (Pine), JSON |
| יועץ | `src/advisor.js`, `src/llm.js` | OpenAI-compatible / Anthropic / Gemini + מצב כללים מקומי |
| מודל בדפדפן | `src/webllm.js` | WebLLM על WebGPU — inference ללא מפתח וללא מגבלה |
| ממשק | `src/views/*` | סקירה, שולחנות, צוות, מעבדה, גרסאות, מחקר, סנטימנט, יועץ, הגדרות, מדריך |

חמישה שולחנות לפי טווח זמן: 5 דקות, 15 דקות, נר שעה, יומי (סווינג חודשי), שבועי (סווינג שנתי).
כל שולחן מנהל גרסאות, פרמטרים ומדדים בנפרד.

---

## הרצה מקומית (macOS)

אין צורך ב־Node או ב־npm. צריך רק שרת סטטי, כי מודולי ES לא נטענים מ־`file://`.

```bash
cd ~/path/to/alta-capital
ruby -run -e httpd . -p 8080
open http://localhost:8080
```

Ruby מותקן בכל מקבוק, ולכן זו הפקודה הבטוחה. חלופה: `python3 -m http.server 8080` (דורש `xcode-select --install`),
או Live Server בתוך VS Code.

---

## העלאה ל־GitHub Pages

### בלי טרמינל

1. GitHub → **New repository** → ציבורי → **Create**.
2. **Add file → Upload files** → גרור את כל תוכן התיקייה → **Commit changes**.
3. **Settings → Pages → Source: Deploy from a branch → main / (root) → Save**.
4. האתר יעלה בכתובת `https://<USERNAME>.github.io/<REPO>/`.

### עם טרמינל

```bash
git init -b main
git add .
git commit -m "Alta Capital: agent-run trading research desk"
git remote add origin https://github.com/<USERNAME>/<REPO>.git
git push -u origin main
```

או עם GitHub CLI:

```bash
brew install gh
gh auth login
gh repo create alta-capital --public --source=. --push
```

אם בחרת ב־GitHub Actions: **Settings → Pages → Source: GitHub Actions**.
הפרויקט כולל `.github/workflows/pages.yml` שמפרסם בכל push ל־`main`.

---

## חיבור מודל

**הגדרות ומפתחות → מודל AI**: בחר ספק (OpenAI, OpenRouter, Groq, DeepSeek, Anthropic, Gemini, Ollama, מותאם),
הזן מפתח ובחר מודל, ואז **שמור ובדוק מודל**.

* המפתח נשמר ב־`localStorage` של הדפדפן שלך בלבד.
* אם ספק חוסם בקשות דפדפן (CORS), השתמש ב־OpenRouter/Groq/Gemini או בפרוקסי מקומי.
* בלי מפתח — היועץ עובד במצב כללים מתוך נתוני המערכת.

## חיבור זיכרון החברה ל־GitHub (אופציונלי)

צור Fine-grained PAT עם הרשאת **Contents: Read and write** על ריפו אחד, והזן בהגדרות:
טוקן, owner, repo ונתיב (ברירת מחדל `firm/context.json`).
במסך **מחקר וסריקה** יש **שמור ל־GitHub** — דוחף את הקונטקסט (פרמטרים, מדדים, רעיונות) כקומיט.

## חדשות (אופציונלי)

הזן endpoint שמחזיר JSON עם `articles` / `items` / `data` וכותרות בשדה `title`.
דוגמה: `https://newsapi.org/v2/everything?q=bitcoin&language=he`.

---

## מודל העבודה

1. **סריקה** — רעיונות מ־GitHub ומקורות ציבוריים נכנסים למאגר.
2. **בקטסט** — 70% ראשונים מהסדרה, עם עמלות והחלקה.
3. **אופטימיזציה** — חיפוש פרמטרים; הגרסה הקיימת משמשת כזרע, כך שאין נסיגה.
4. **חיזוק סטטיסטי** — walk-forward על 4 חלונות (עם אימון מחדש לכל חלון), Monte Carlo bootstrap על רצף
   העסקאות, ורגישות פרמטרים ±15%. מהם נגזר ציון **חוסן 0-100**.
5. **שערי סיכון** — תשואה חיובית, מספר עסקאות, Profit Factor, drawdown, OOS חיובי וחוסן מינימלי.
6. **גרסה** — שיפור ≥ **0.1%** ב־OOS (ברירת מחדל) ⇒ `v1.N` חדש + קוד לבוט + רשומת יומן.
7. **dry-run** — 3 מחזורים נקיים על נייר.
8. **חי על נייר** — פתיחה/סגירה של פוזיציות סימולציה מול מחיר בזמן אמת, עם ניתוח טכני שוטף.

## 24/7 ב־GitHub Actions

האתר סטטי, אבל `runner/run.mjs` מריץ את אותו מנוע ב־Node וכותב `data/state.json` ו־`strategies/`.
ה־workflow `.github/workflows/firm.yml` מריץ אותו כל 15 דקות, גם כשהמחשב סגור.

```bash
npm run firm        # מחזור אחד לכל שולחן
npm run firm:deep   # כולל כיול מעמיק
```

הדשבורד טוען את `data/state.json` אוטומטית ומציג "ענן 24/7 · פעיל". במצב הזה האוטופיילוט המקומי כבוי
כדי שלא ירוצו שני מנועים על אותו מצב.

### מודל לסוכנים בענן

הסוכנים מקבלים "אינטיליגציה" מהמודל דרך GitHub Secrets — המפתח לא נכנס לריפו:

```bash
gh secret set OPENAI_API_KEY          # או LLM_API_KEY
gh variable set LLM_MODEL --body "gpt-4o-mini"
# אופציונלי לספק אחר (OpenAI-compatible):
gh variable set LLM_BASE_URL --body "https://openrouter.ai/api/v1"
gh variable set LLM_PROVIDER --body "openrouter"
```

### בריכת מודלים חינמיים

אפשר (ומומלץ) לחבר כמה ספקים במקביל. כל מפתח שנמצא ב-environment נכנס לבריכה:
`GROQ_API_KEY`, `GEMINI_API_KEY`, `ZAI_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`,
`NVIDIA_API_KEY`, `COHERE_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY`, `TOGETHER_API_KEY`,
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, ו-`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`.
לרשימה מפורשת עם מודלים משלך: `LLM_KEYS` (JSON array של `{provider,key,model,baseUrl}`).
לכמה חשבונות Cloudflare: `CLOUDFLARE_KEYS` (JSON של `{accountId,token,model}` או שורות
`ACCOUNT_ID,TOKEN`) — כל חשבון מוסיף 10,000 Neurons ליום משלו, והבריכה מסובבת ביניהם.

הבריכה עובדת לפי least-recently-used, מכבדת RPM/RPD לכל ספק, מכניסה מפתח ל-cooldown
מעריכי על 429 ומשביתה אותו על 401, ותמיד ממשיכה לספק הבא במקום להיכשל. בדשבורד:
הגדרות → בריכת מודלים חינמיים (הוספה, בדיקה, סדר עדיפות, קירורים).

### בלי מגבלת API בכלל

לכל ספק חינמי יש תקרה. שני המסלולים היחידים בלי תקרה הם מודל שרץ אצלך:

**בדפדפן — WebLLM על WebGPU.** הגדרות → *מודל מקומי בדפדפן (WebLLM)* → בחר מודל (1B ≈ 0.7GB)
→ **טען מודל**. ההורדה חד-פעמית, ואחריה כל inference רץ על ה-GPU שלך: אין מפתח, אין rate limit ואין
קריאת רשת. המודל מתווסף אוטומטית לרשימת המועמדים אחרי הבריכה, כך שגם אם כל הספקים נגמרו — היועץ
והמנכ״ל ממשיכים לענות. דרוש Chrome/Edge 113+ או Safari עדכני.

**על השרת — Ollama.** לריצה 24/7 בלי מכסה צריך GPU בשרת, ולכן runner בבעלותך:

```bash
ollama pull qwen2.5:7b && ollama serve
gh variable set OLLAMA_BASE_URL --body "http://127.0.0.1:11434"
gh variable set OLLAMA_MODEL --body "qwen2.5:7b"
```

וה-workflow צריך `runs-on: self-hosted`. ה-runner מוסיף את Ollama לבריכה כספק בלי מפתח ובלי מכסה;
אם הוא לא זמין, השורה נכשלת והבריכה ממשיכה לספק הבא.

רוצה שער מרכזי? הרם [free-api-gateway](https://github.com/DeepakSilaych/free-api-gateway)
או [llm-keypool](https://github.com/piyush-tyagi-13/llm-keypool) והגדר `LLM_GATEWAY_URL`
ו-`LLM_GATEWAY_KEY` — הבריכה תשתמש בו כספק אחד.

לפני כל מחזור, סוכן ה-AI קורא את הדוח המלא (מדדים, חלונות, Monte Carlo, ניתוח טכני) ומחזיר
`focusDesk`, `strategyId`, טווח פרמטרים מצומצם, סקירה ופעולות הבאות. ההחלטה נשמרת ב-
`data/state.json` ומוצגת במעבדה, והמחזור הבא של אותו שולחן מיישם אותה. בלי מפתח — נפילה
לכללים מקומיים, והמערכת ממשיכה לעבוד.

הגנה: הריפו ציבורי, אבל רק לך יש הרשאת כתיבה; ה־workflow מנקה מפתחות לפני פרסום; הדשבורד חסר נתיב
כתיבה לשרת, וכל שינוי של מבקר נשמר רק בדפדפן שלו. להגנה על הענף עצמו — Branch protection על `main`
עם `github-actions[bot]` ברשימת ה־bypass. לתוכן לא פומבי — ריפו פרטי עם GitHub Pro.

---

## עמלות מסחר

הבקטסט והמערכת כוללות כעת חישוב עמלות רב-רכיבי המבוסס על מודל `virattt/ai-hedge-fund`:

- ** עמלת Maker/Taker** — `makerFee: 0.00025` (0.025%) ו‑`takerFee: 0.0004` (0.04%) ברירת מחדל
- **spread** — `spread: 0.001` (0.1%) על כל עסקה, המחושב כ‑`price × spread × |units|`
- **Impact cost** — על פי נוסחת virattt: `impactFactor × dailyVolatility × sqrt(|units| / (avgDailyVolume / 20))`. ברירת מחדל: `impactFactor: 1.0`, `dailyVolatility: 2%`, `avgDailyVolume: 1M`
- **exchangeFee** — עמלת בורסה נוספת (`exchangeFee: 0` ברירת מחדל)
- **feeRate** — שומר על תאימות לאחור (0.0004 = 0.04%)

כל עמלה מתווספת ל‑`PnL` של העסקה ומסומנת בשדה `fee` בפירוט העסקאות. הסיכום כולל כעת `totalFees` המציג את העמלות הכוללות שגבתה המערכת.

## TradingView וחשבון paper trading

**ל-TradingView אין API ציבורי לפקודות.** paper trading שם הוא כלי UI, ולכן אי אפשר לחבר את החשבון
באופן אוטומטי — לא מהמערכת הזו ולא מאף בוט. שלושה מסלולים, לפי מה שבאמת צריך:

1. **Pine Script (מומלץ).** בחר `TradingView (Pine Script)` בפלטפורמת היעד, או הגדרות → *ייצא Pine Script*.
   מקבלים קובץ `.pine` עם אותם פרמטרים של הגרסה המקודמת. הדבקה ב-Pine Editor → Add to chart,
   ו-TradingView מריצה את האסטרטגיה ומדמה כל כניסה ויציאה בחשבון הנייר שלה בזמן אמת.
2. **Alerts → Webhook.** חד-כיווני: TradingView מודיעה לשרת שלך על סיגנל. דורש תוכנית בתשלום.
3. **ברוקר נייר עם API אמיתי** (Alpaca paper / OKX demo) לפקודות בפועל, כשה-charts נשארים ב-TradingView.

## מגבלות

* אין חיבור לבורסה ואין שליחת פקודות — לא מ-TradingView ולא לשום מקום אחר.
* GitHub Pages סטטי: בלי ה־workflow הסוכנים פועלים רק כשהדף פתוח. עם `firm.yml` הם רצים בענן כל 15 דקות.
* אין ביצוע פקודות אמיתי, אין מפתחות בורסה, אין ניהול כסף.
* בקטסט + אופטימיזציה = סיכון מובנה ל־overfitting; OOS הוא בלם חלקי בלבד.
* נתוני Binance עשויים להיחסם לפי מדינה; יש Kraken/Coinbase ונתוני הדגמה כגיבוי.
* סנטימנט מרשתות הוא פרוקסי רועש, לא אות כניסה.
* אין ייעוץ השקעות. מסחר ממונף עלול להפסיד את כל ההון.

מדריך מפורט יותר נמצא בתוך האתר: **מדריך הקמה**.
