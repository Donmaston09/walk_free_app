# WalkFree 💓
### Advanced Cardiovascular Health Companion

> *The world's most clinically grounded free cardiovascular prevention app — no hardware, no subscription, no compromise.*

**Inspired by Tony Onoja** · School of Health Sciences, University of Surrey, United Kingdom  
📧 a.onoja@surrey.ac.uk · donmaston09@gmail.com  
💙 Support: [paypal.me/Onoja412](https://paypal.me/Onoja412)

---

## 🌐 Live App
Hosted on Render: **https://walkfree.onrender.com** *(update after deploy)*

---

## 🏆 What Makes WalkFree Better

| Feature | WalkFree | Fitbit | Apple Health |
|---------|----------|--------|-------------|
| 50/10 Sedentary Firewall | ✓ | ✗ | ✗ |
| Condition-adjusted CV goals (CAD, HF, AF, Diabetes) | ✓ | ✗ | ✗ |
| MET-accurate calorie engine (6 activity types) | ✓ | ✗ | ✗ |
| 5-Zone HR Training Panel | ✓ | Partial | Watch only |
| Arterial Age Estimator (Paluch JAMA 2021) | ✓ | ✗ | ✗ |
| Camera rPPG Heart Rate — no wearable | ✓ | ✗ | ✗ |
| MediaPipe AI pose step detection | ✓ | ✗ | ✗ |
| Borg RPE safety gate + HR cooldown | ✓ | ✗ | ✗ |
| 6-type Micro-Intervention engine | ✓ | ✗ | ✗ |
| Local-first privacy (zero cloud upload) | ✓ | ✗ | ✗ |
| Requires wearable hardware | **Never** | Recommended | Required |
| Free & open source | ✓ | Freemium | iOS only |

---

## ⚕️ Clinical Foundation

Built on evidence-based guidelines:

- **AHA Physical Activity Guidelines (2023)** — 7,000–10,000 steps/day
- **Paluch et al. (2021) JAMA Network Open** — Step count & all-cause mortality
- **Dunstan et al. (2012) Diabetes Care** — 50/10 sedentary break rule
- **Morishima et al. (2017)** — Calf raises & popliteal artery blood flow
- **Borg (1982)** — Rate of Perceived Exertion scale
- **Ainsworth et al. (2011)** — Compendium of Physical Activities (MET values)

---

## 🚀 Features

### Core Screens
- **📊 Dashboard** — Dual-ring step counter (steps + kcal), 5-zone HR panel, Arterial Age Estimator, 50/10 Sedentary Firewall, AHA goal progress, rPPG heart rate
- **📷 Active Session** — MediaPipe AI pose detection, real-time step counting, MET calorie tracking, cadence bar, RPE safety check
- **⚡ MoveNow** — 6 clinical micro-interventions (Calf Raises, March, Brisk Walk, Squats, Stretches, Stairs) with 2-min timer
- **📈 Progress** — Steps/Sitting/Calorie charts, cardiovascular risk gauge, arterial age trend, weekly summary table

### Activity Modes
🚶 Walking · 🏃 Running · 🚴 Cycling · ⚽ Sport · 🏊 Swimming · 🧘 Yoga

Each mode uses its correct MET value for accurate calorie calculation.

### Safety Guardrails
- Borg RPE scale (6–20) blocks continuation at ≥17
- Max HR formula: `(220 − age) × 0.85` — AHA Cardiac Rehab standard
- Immediate cooldown protocol when threshold exceeded
- Physician disclaimer throughout

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML5 / CSS3 / JavaScript (ES2022) |
| Fonts | Google Fonts — Inter, Space Grotesk |
| Pose Detection | MediaPipe Pose (CDN-ready) |
| Heart Rate | rPPG via CHROM algorithm (camera) |
| Storage | localStorage (local-first, zero cloud) |
| Deployment | GitHub + Render Static Hosting |

**No build step. No dependencies. No framework.** Open `index.html` and it runs.

---

## 📁 Project Structure

```
walk_free_app/
├── index.html      # App shell — all 4 screens + 5 modals
├── styles.css      # Premium dark-mode design system (WCAG 2.1 AA)
├── app.js          # Clinical algorithms + state + CV tracking
├── render.yaml     # Render static site config
└── README.md       # This file
```

---

## 🖥️ Local Development

```bash
# Option 1: Just open the file
open index.html

# Option 2: Serve with Python (recommended to avoid CORS on camera)
python3 -m http.server 8080
# Then visit http://localhost:8080

# Option 3: Serve with Node
npx serve .
```

---


## 📱 Mobile Packaging (Optional — Phase 2)

Wrap as a native mobile app without rewriting:

```bash
npm install -g @capacitor/cli
npx cap init WalkFree com.walkfree.app --web-dir .
npx cap add ios android
npx cap open ios
```

---

## ♿ Accessibility

- WCAG 2.1 AA compliant
- ARIA labels on all interactive elements
- `aria-live` regions for step count and HR
- `role="alertdialog"` for Vascular Alert
- Minimum 4.5:1 contrast ratio
- Touch targets ≥ 44×44px
- Focus-visible ring for keyboard navigation

---

## 📄 Disclaimer

WalkFree is a **wellness companion**, not a certified medical device. Always consult your physician before changing your exercise routine, especially with cardiovascular conditions.

---

*© 2025 WalkFree · Inspired by Tony Onoja, University of Surrey, UK*
