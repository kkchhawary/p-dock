# P-Dock — Personal Dock

**Your Life. Securely Docked.**
Apne documents, bills aur chhoti-chhoti baatein ek jagah rakho aur poochh lo: "pichhla bijli ka bill kitna tha?", "gaadi ki service kitne km par hui?", "DL kab expire hoga?"

iPhone aur Mac dono par ek app ki tarah chalta hai. Na terminal chahiye, na Mac ko on rakhna.

## Data kahan rehta hai

```
  iPhone (home screen icon)  ⇄  aapka Google Drive (encrypted)  ⇄  Mac (Dock icon)
```

| Cheez | Kahan |
|---|---|
| Documents, yaadein, profile | Aapke device + **aapke Google Drive** ka chhupa P-Dock folder. Dono jagah encrypted. |
| Taale ki chaabi | Sirf aapke vault password / Face ID / recovery code mein. Google ke paas nahi. |
| App ka code | GitHub Pages par. Wahan **sirf code** hai, aapka data kabhi nahi jaata. |
| AI (agar chalu karo) | Sawaal + documents ki details (Aadhaar/PAN chhupa ke) Anthropic (Claude) ko jaati hain. |
| Reminders (agar chalu karo) | Google Calendar mein sirf chhota title ("DL expire ho raha hai", "Naresh se ₹500 lene hain"). |
| Gmail (agar use karo) | Sirf padhne ki permission. Sirf aapke chune hue bills aate hain. |
| Location (agar chalu karo) | Sirf phone ke andar match hoti hai, kahin nahi bheji jaati. |

P-Dock ko Google Drive ke **sirf apne chhupe folder** ki permission hai (`drive.appdata`). Aapki baaki Drive files tak uski koi pahunch nahi.

## Pehli baar setup (ek baar, ~15 minute)

### 1. GitHub (app ka code yahan rahega)
1. https://github.com/signup par free account banao.
2. Batao, baaki main kar dunga: repository banana, code daalna, Pages chalu karna.
3. App ka address kuch aisa hoga: `https://<aapka-username>.github.io/p-dock/`

### 2. Google Cloud (Drive mein likhne ki permission)
1. https://console.cloud.google.com kholo, apne Google account se.
2. Upar **Select a project → New Project** → naam `P-Dock` → **Create**.
3. **APIs & Services → Library**: "**Google Drive API**" → Enable. Phir "**Google Calendar API**" → Enable. Phir "**Gmail API**" → Enable.
4. **APIs & Services → OAuth consent screen** (ya "Google Auth Platform"):
   - User type: **External** → App name `P-Dock` → apna email → Save.
   - **Audience / Test users** mein apna Gmail address jodo. (App "Testing" mode mein hi rahega; sirf aap use kar sakte ho.)
5. **Credentials → Create Credentials → OAuth client ID**:
   - Type: **Web application**
   - Authorized JavaScript origins: `https://<aapka-username>.github.io`
   - Create → jo **Client ID** mile (`….apps.googleusercontent.com`), mujhe bhej do. (Yeh secret nahi hai.)

Main use `app/js/config.js` mein daal dunga.

> Login karte waqt Google ek "Google hasn't verified this app" screen dikhayega, kyunki app sirf aapka hai aur public nahi hai. **Continue** dabana.

### 3. iPhone par
1. Safari mein app ka address kholo → **Google Drive se jodo** → vault password banao.
2. **Recovery code** kaagaz par likh lo.
3. Share button → **Add to Home Screen**.
4. App kholo → Settings → **Face ID jodo**.

### 4. Mac par
1. Safari mein wahi address kholo → **Google Drive se jodo** → wahi vault password.
2. **File → Add to Dock**.
3. Settings → **Touch ID jodo**.

## Roz ka use
- **Poochho / batao:** chat mein jo bhi bolo, P-Dock samajh kar sahi jagah rakhta hai:
  - "Naresh ko 500 udhaar diye, 15 tareekh ko dega, number 98…" → **Udhaar** mein entry, Naresh **Log** mein, aur 15 tareekh ko reminder
  - "Naresh ne paise lauta diye" → hisaab poora
  - "Delhi jaaun to yaad dilana Lal Qila ghumna hai" → **jagah wala reminder**. Jab Delhi mein app khologe, ye dikhega.
  - "Parso bijli ka bill bharna hai, yaad dilana" → us din subah 9 baje phone par alert (Google Calendar se)
  - "Aaj gaadi ki service 45,200 km par hui" → **yaad**
  - "Is mahine khane pe kitna kharch hua?" → bills jod kar total
- **Photo / bill daalo:** P-Dock samjhega ki kis cheez ka bill hai (khana, kapde, petrol, gaadi service, dawai…), har item aur total, aur kiske liye tha (aapke, bachchon ke…). Pakka na ho to poochhega: "Yeh kapde kiske liye the?". Aapka jawab yaad rakha jaayega.
  - Aam photo (log, jagah) pehchaanne ke liye Settings mein **"AI ko photo dikhao"** chalu karna hoga.
  - "Mere baare mein" mein family ke naam likh doge (jaise "Beti: <naam>, 6 saal"), to AI behtar samjhega.
- **Documents:** PDF ya photo daalo, ya iPhone se seedha photo khincho. App khud padh kar type aur expiry nikaal lega.
- Ek device par kuch daalo, wo doosre par apne aap aa jaayega (Google Drive se).
- 10 minute kuch na karo, ya app 3 minute band rahe, to wo apne aap lock ho jaata hai.

## Gmail se bills
Settings → **Gmail mein bills dhoondo**. P-Dock sirf bill / invoice / receipt / policy / ticket wale mail dhoondhta hai aur unke PDF/photo ki list dikhata hai. Aap tick karke chunte ho kaunse laane hain.
- Permission sirf **padhne** ki hai (`gmail.readonly`). Koi mail bheja ya mitaya nahi jaata.
- Sab browser ke andar hota hai. Mail kisi server par nahi jaate. Laaye gaye bills baaki documents ki tarah encrypt hokar aapke Drive mein jaate hain.
- Jo bill pehle laa chuke ho, wo "Pehle se hai" dikhte hain, isliye duplicate nahi banta.
- Password wali PDF (jaise bank statement) aa jaayegi aur khulegi bhi, lekin P-Dock uska text nahi padh sakta.

## Suraksha
- Har cheez device par hi AES-256 se encrypt hoti hai, phir Google Drive jaati hai.
- Vault password se chaabi banti hai (PBKDF2, 600,000 rounds). Face ID se bhi chaabi khulti hai (WebAuthn PRF); ye sirf darwaza nahi, asli taala hai.
- **Password + recovery code dono kho gaye to data koi nahi khol sakta**, P-Dock banane wala bhi nahi.
- Lock screen par dikhta hai: *"Yeh Krishan ka P-Dock hai. Main sirf Krishan ya mere boss ko bataunga."*

## Developer notes
- Pure static web app (`app/`), koi server nahi. Build step nahi.
- `npm test` chalata hai 29 tests: encryption, password/recovery/Face ID unlock, do devices ka merge, nakli Google Drive ke saath poora sync (Mac → Drive → iPhone → delete → Mac), udhaar/reminders/log actions, calendar events, location matching, Gmail attachment parsing, aur local mode mein Drive ko na chhoona.
- `npm run dev` se local preview: http://localhost:5173
- Files: `js/crypto.js` (taala), `js/model.js` (data + merge), `js/vault.js` (save + sync), `js/drive.js` (Google Drive), `js/calendar.js`, `js/passkey.js` (Face ID), `js/ocr.js` (browser OCR: pdf.js + Tesseract), `js/ai.js` (Claude), `js/actions.js` (chat se udhaar/reminder/log), `js/places.js` (jagah wale reminder), `js/gmail.js` (Gmail se bills), `js/app.js` (UI).
- Purana Mac/terminal wala version `old-mac-version/` mein hai (git mein nahi).
