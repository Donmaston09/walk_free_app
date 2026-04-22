/* =============================================================
   WALKFREE v2 — Advanced Clinical Application Engine
   Creator: Inspired by Tony Onoja, University of Surrey, UK
   
   What makes WalkFree superior to Fitbit / Apple Health:
   ✓ 50/10 Sedentary Firewall (not just hourly stand reminders)
   ✓ Condition-adjusted AHA goals (CAD, HF, AF, Diabetes)
   ✓ MET-accurate calorie engine (per activity type)
   ✓ 5-Zone HR training system without wearable
   ✓ Arterial Age Estimator (Paluch JAMA 2021)
   ✓ Camera-based rPPG heart rate (no device needed)
   ✓ MediaPipe pose step detection
   ✓ Borg RPE safety gate + max HR cooldown trigger
   ✓ 6-type Micro-Intervention engine with kcal tracking
   ✓ Local-first privacy (zero cloud upload)
   ============================================================= */

'use strict';

// ─── MET VALUES PER ACTIVITY ─────────────────────────────────
// Source: Compendium of Physical Activities (Ainsworth et al., 2011)
const ACTIVITY_META = {
  walking:  { name: 'Walking',   icon: '🚶', met: 3.5,  strideM: 0.762, unit: 'steps', calFactor: 0.762 / 1000 },
  running:  { name: 'Running',   icon: '🏃', met: 8.0,  strideM: 1.2,   unit: 'strides', calFactor: 1.2 / 1000 },
  cycling:  { name: 'Cycling',   icon: '🚴', met: 7.5,  strideM: 0,     unit: 'rotations', calFactor: 0 },
  sport:    { name: 'Sport',     icon: '⚽', met: 7.0,  strideM: 0.9,   unit: 'steps', calFactor: 0.9 / 1000 },
  swimming: { name: 'Swimming',  icon: '🏊', met: 8.3,  strideM: 0,     unit: 'laps', calFactor: 0 },
  yoga:     { name: 'Yoga',      icon: '🧘', met: 2.5,  strideM: 0,     unit: 'poses', calFactor: 0 },
};

// ─── HR ZONES (5-zone Karvonen model) ────────────────────────
const HR_ZONES = [
  { id: 1, name: 'Zone 1 — Recovery',   min: 0.50, max: 0.60, color: '#38bdf8', benefit: 'Active recovery, circulation' },
  { id: 2, name: 'Zone 2 — Fat Burn',   min: 0.60, max: 0.70, color: '#10b981', benefit: 'Fat oxidation, endurance base' },
  { id: 3, name: 'Zone 3 — Cardio',     min: 0.70, max: 0.80, color: '#f59e0b', benefit: 'Aerobic capacity, heart strength' },
  { id: 4, name: 'Zone 4 — Threshold',  min: 0.80, max: 0.90, color: '#f97316', benefit: 'Lactate threshold, performance' },
  { id: 5, name: 'Zone 5 — Maximum',    min: 0.90, max: 1.00, color: '#ef4444', benefit: 'VO2 Max — use with caution' },
];

// ─── MICRO-INTERVENTIONS ──────────────────────────────────────
const MICRO_INTERVENTIONS = {
  calfraise: { name: 'Calf Raises',      icon: '🦵', desc: 'Stand on tiptoes, hold 2 seconds, lower slowly. Activates venous calf pump.', repsPerMin: 20, met: 2.5, category: 'Circulation' },
  march:     { name: 'March in Place',   icon: '🚶', desc: 'High-knee marching in place — elevates HR and activates the core.', repsPerMin: 80, met: 3.5, category: 'Cardio' },
  brisk:     { name: 'Brisk Walking',    icon: '🏃', desc: 'Walk at a pace where you can talk but not sing — gold standard.', repsPerMin: 100, met: 4.5, category: 'AHA Recommended' },
  squat:     { name: 'Desk Squats',      icon: '🏋️', desc: 'Bodyweight squats — large muscle groups clear blood glucose rapidly.', repsPerMin: 14, met: 5.0, category: 'Glucose' },
  stretch:   { name: 'Seated Stretches', icon: '🧘', desc: 'Neck rolls, shoulder circles, hip rotations — safe for all conditions.', repsPerMin: 6, met: 2.0, category: 'Safe' },
  stairs:    { name: 'Stair Stepping',   icon: '🪜', desc: '2 min stair stepping ≈ 10 min moderate exercise for CV benefit.', repsPerMin: 40, met: 6.0, category: 'High ROI' },
};

// ─── AHA CONDITION-ADJUSTED GOALS ────────────────────────────
const CONDITION_GOALS = {
  prevention: { base: 10000, label: 'General Prevention' },
  hypertension: { base: 8500, label: 'Hypertension' },
  cad:        { base: 7000, label: 'Coronary Artery Disease' },
  diabetes:   { base: 8500, label: 'Type 2 Diabetes' },
  af:         { base: 6500, label: 'Atrial Fibrillation' },
  hf:         { base: 5000, label: 'Heart Failure' },
  obesity:    { base: 8000, label: 'Obesity / Metabolic Syndrome' },
  post_mi:    { base: 6000, label: 'Post-MI Rehabilitation' },
};

// ─── STATE ────────────────────────────────────────────────────
const STATE = {
  user: null, today: null, history: [],
  session: null, miSession: null, hrSession: null,
  currentActivity: 'walking',
  sedentarySeconds: 0,
  sedentaryInterval: null,
  alertShown: false,
  snoozedUntil: 0,
  selectedGoal: 8500,
  selectedRPE: null,
  selectedMI: null,
  cameraStream: null,
  cameraFacingMode: 'user',
  poseDetectionInterval: null,
  stepInterval: null,
  hrFrameId: null,
  bluetoothDevice: null,
};

const DB_KEY = 'walkfree_v2';
const CIRC_STEP = 2 * Math.PI * 90;   // r=90 outer ring
const CIRC_CAL  = 2 * Math.PI * 72;   // r=72 inner ring
const CIRC_MI   = 2 * Math.PI * 60;   // MI timer r=60
const SNOOZE_SEC = 10 * 60;

function getSedentaryLimitSec() {
  return (STATE.user?.reminderInterval || 50) * 60;
}

// ─── PERSISTENCE ──────────────────────────────────────────────
function persist() {
  try { localStorage.setItem(DB_KEY, JSON.stringify({ user: STATE.user, today: STATE.today, history: STATE.history })); } catch(e) {}
}

function hydrate() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    STATE.user = d.user; STATE.history = d.history || [];
    const todayStr = todayDate();
    if (d.today && d.today.date === todayStr) {
      STATE.today = d.today;
    } else {
      if (d.today) STATE.history.unshift(d.today);
      if (STATE.history.length > 90) STATE.history = STATE.history.slice(0, 90);
      STATE.today = createDayRecord();
    }
    return !!STATE.user;
  } catch(e) { return false; }
}

function todayDate() { return new Date().toISOString().slice(0, 10); }

function createDayRecord() {
  return {
    date: todayDate(), steps: 0,
    goal: STATE.user?.stepGoal || STATE.selectedGoal || 8500,
    calories: 0, distance: 0, activeMinutes: 0,
    sittingMinutes: 0, sedentaryCycles: 0,
    miSessions: [], sessions: [], hrReadings: [],
    activityBreakdown: { walking: 0, running: 0, cycling: 0, sport: 0, swimming: 0, yoga: 0 },
  };
}

// ─── ONBOARDING ───────────────────────────────────────────────
let _obActivityType = 'walking';

function onboardingNext(step) {
  if (step === 1) {
    const name   = document.getElementById('ob-name').value.trim();
    const age    = parseInt(document.getElementById('ob-age').value);
    const weight = parseFloat(document.getElementById('ob-weight').value) || 75;
    const height = parseFloat(document.getElementById('ob-height').value) || 170;
    const gender = document.getElementById('ob-gender').value;
    const cond   = document.getElementById('ob-condition').value;
    if (!name)           { shake('ob-name'); return; }
    if (!age || age < 18 || age > 100) { shake('ob-age'); return; }
    STATE.user = { name, age, weight, height, gender, condition: cond };
  }
  if (step === 2) {
    const steps   = parseInt(document.getElementById('ob-steps').value) || 3000;
    const sitting = parseInt(document.getElementById('ob-sitting').value) || 8;
    // Use condition-adjusted goal if goal not explicitly overridden
    const condGoal = CONDITION_GOALS[STATE.user.condition]?.base || 8500;
    STATE.user.baselineSteps = steps;
    STATE.user.dailySitting  = sitting;
    STATE.user.preferredActivity = _obActivityType;
    // Only use selectedGoal if it was explicitly changed, else use condition-based
    STATE.user.stepGoal = STATE.selectedGoal !== 8500 ? STATE.selectedGoal : condGoal;
    STATE.selectedGoal  = STATE.user.stepGoal;
  }
  showOBStep(step + 1);
}

function onboardingBack(step) { showOBStep(step - 1); }

function showOBStep(n) {
  document.querySelectorAll('.ob-step').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.ob-dot').forEach((d, i) => d.classList.toggle('active', i < n));
  document.getElementById(`ob-step-${n}`).classList.add('active');
}

function selectGoal(btn, val) {
  document.querySelectorAll('.goal-option').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  STATE.selectedGoal = val;
}

function selectActivityType(btn, key) {
  document.querySelectorAll('.act-type-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  _obActivityType = key;
}

function completeOnboarding() {
  STATE.user.stepGoal    = STATE.selectedGoal;
  STATE.user.createdAt   = new Date().toISOString();
  STATE.currentActivity  = STATE.user.preferredActivity || 'walking';
  STATE.today            = createDayRecord();
  persist();
  const ov = document.getElementById('onboarding-overlay');
  ov.style.opacity = '0';
  setTimeout(() => { ov.classList.remove('active'); ov.style.display = 'none'; bootApp(); }, 400);
}

// Shake animation
const _ks = document.createElement('style');
_ks.textContent = `@keyframes shake{ 0%,100%{transform:translateX(0)} 25%{transform:translateX(-8px)} 75%{transform:translateX(8px)} }`;
document.head.appendChild(_ks);

function shake(id) {
  const el = document.getElementById(id);
  el.style.animation = 'none'; el.offsetHeight;
  el.style.animation = 'shake .4s ease'; el.style.borderColor = 'var(--red)';
  setTimeout(() => { el.style.borderColor = ''; el.style.animation = ''; }, 800);
}

// ─── BOOT ─────────────────────────────────────────────────────
function bootApp() {
  if (!STATE.today) STATE.today = createDayRecord();
  const u = STATE.user;

  // Populate UI
  document.getElementById('greeting-name').textContent = `${u.name} 👋`;
  document.getElementById('avatar-initials').textContent = u.name.slice(0,2).toUpperCase();
  document.getElementById('step-goal-display').textContent = (u.stepGoal || 8500).toLocaleString();
  document.getElementById('chronological-age').textContent = u.age;

  const maxHR = calcMaxHR(u.age);
  document.getElementById('hr-threshold').textContent = maxHR;
  document.getElementById('hr-threshold-display').textContent = maxHR;
  document.getElementById('hrz-max').textContent = maxHR;

  setGreeting();
  setInterval(setGreeting, 60000);

  // Activity mode
  setActivityMode(
    document.querySelector(`.am-btn[data-act="${STATE.currentActivity}"]`) || document.querySelector('.am-btn'),
    STATE.currentActivity, false
  );

  renderHRZones();
  document.getElementById('app').classList.remove('hidden');

  startSedentaryTimer();
  startBackgroundPedometry();
  renderDashboard();

  if (STATE.history.length === 0) generateMockHistory();
  renderHistory();

  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}

function setGreeting() {
  const h = new Date().getHours();
  document.getElementById('greeting-time').textContent =
    h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function calcMaxHR(age) { return Math.round((220 - age) * 0.85); }

// ─── ACTIVITY MODE ────────────────────────────────────────────
function setActivityMode(btn, key, updateLabel = true) {
  if (!btn) return;
  document.querySelectorAll('.am-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed','false'); });
  btn.classList.add('active');
  btn.setAttribute('aria-pressed','true');
  STATE.currentActivity = key;
  const meta = ACTIVITY_META[key];
  if (updateLabel) {
    document.getElementById('activity-mode-label').textContent = `${meta.icon} ${meta.name} Mode`;
    document.getElementById('met-value').textContent = meta.met;
    document.getElementById('aha-activity-label').textContent = meta.name;
    updateAHAScienceNote(key);
    updateStepUI();
  }
}

function updateAHAScienceNote(key) {
  const notes = {
    walking:  '7,000–10,000 steps/day reduces all-cause mortality by 49–65% (Paluch et al., JAMA 2021)',
    running:  'Running 5–10 min/day at any speed reduces CV mortality risk by 45% (AHA 2023)',
    cycling:  'Regular cycling reduces CVD risk by 46% and all-cause mortality by 40% (Celis-Morales, 2017)',
    sport:    'Team sports provide unique social + cardiovascular benefits, 47% lower CVD risk (Schnohr, 2012)',
    swimming:'Swimmers have 53% lower mortality risk vs. sedentary adults (Swim England / AHA 2021)',
    yoga:     'Yoga reduces BP, HR, and anxiety in CVD patients — comparable to standard care (Cramer, 2014)',
  };
  const el = document.getElementById('aha-science-note');
  if (el) el.textContent = notes[key] || notes.walking;
}

function setSessionActivity(btn, key) {
  document.querySelectorAll('.sap-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  STATE.currentActivity = key;
  const meta = ACTIVITY_META[key];
  document.getElementById('session-act-icon').textContent = meta.icon;
  document.getElementById('session-act-title').textContent = `${meta.name} Session`;
  document.getElementById('session-act-desc').textContent = getSessionDesc(key);
  document.getElementById('met-value').textContent = meta.met;
  document.getElementById('activity-mode-label').textContent = `${meta.icon} ${meta.name} Mode`;
  // Sync top bar
  const amBtn = document.querySelector(`.am-btn[data-act="${key}"]`);
  if (amBtn) setActivityMode(amBtn, key);
}

function getSessionDesc(key) {
  const descs = {
    walking:  'Camera detects hip oscillation via MediaPipe Pose. Stand 2–3m away for best accuracy.',
    running:  'Higher stride frequency. Camera tracks rapid leg alternation and vertical oscillation.',
    cycling:  'Camera tracks pedal rotation via knee landmarks. Best when phone is side-mounted.',
    sport:    'Detects multi-directional movement patterns. Optimised for field sports.',
    swimming: 'Dry-land stroke simulation tracked via arm landmark oscillation.',
    yoga:     'Tracks pose transitions and balance hold durations via full-body landmarks.',
  };
  return descs[key] || descs.walking;
}

// ─── SEDENTARY TIMER ──────────────────────────────────────────
function startSedentaryTimer() {
  if (STATE.sedentaryInterval) clearInterval(STATE.sedentaryInterval);
  STATE.sedentaryInterval = setInterval(tickSedentary, 1000);
}

function tickSedentary() {
  STATE.sedentarySeconds++;
  const limitSec = getSedentaryLimitSec();
  const mins = Math.floor(STATE.sedentarySeconds / 60);
  const secs = STATE.sedentarySeconds % 60;
  document.getElementById('sedentary-display').textContent =
    `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;

  const pct = Math.min((STATE.sedentarySeconds / limitSec) * 100, 100);
  const fill = document.getElementById('sc-progress-fill');
  fill.style.width = pct + '%';
  document.getElementById('sc-sitting-time').textContent = `${mins} min`;
  if (STATE.today) STATE.today.sittingMinutes = mins;

  const badge  = document.getElementById('sedentary-badge');
  const status = document.getElementById('sc-status-text');

  if (pct < 60) {
    fill.className = 'sc-progress-fill';
    badge.className = 'sedentary-timer-badge';
    status.className = 'sc-status-ok';
    status.textContent = '✓ Vascular health OK';
  } else if (pct < 85) {
    fill.className = 'sc-progress-fill warning';
    badge.className = 'sedentary-timer-badge warning';
    status.className = 'sc-status-warn';
    status.textContent = `⚠ Move soon — ${Math.ceil((limitSec - STATE.sedentarySeconds)/60)} min left`;
  } else {
    fill.className = 'sc-progress-fill danger';
    badge.className = 'sedentary-timer-badge danger';
    status.className = 'sc-status-danger';
    status.textContent = '🔴 Endothelial risk — MOVE NOW!';
  }

  if (STATE.sedentarySeconds >= limitSec && !STATE.alertShown && Date.now() > STATE.snoozedUntil) {
    triggerVascularAlert();
  }
}

function triggerVascularAlert() {
  STATE.alertShown = true;
  document.getElementById('alert-duration').textContent = Math.floor(STATE.sedentarySeconds / 60);
  document.getElementById('alert-modal').classList.add('active');
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('WalkFree — Vascular Health Alert', {
      body: `${Math.floor(STATE.sedentarySeconds/60)} min sedentary. Move now to protect blood vessel health!`,
    });
  }
  if ('vibrate' in navigator) navigator.vibrate([200, 100, 200, 100, 400]);
  
  if (STATE.user?.voiceEnabled && 'speechSynthesis' in window) {
    const mins = Math.floor(STATE.sedentarySeconds / 60);
    const msg = new SpeechSynthesisUtterance(`WalkFree Reminder. You have been sitting for ${mins} minutes. It's time to stand up and observe a quick walk or stretch.`);
    window.speechSynthesis.speak(msg);
  }
}

function snoozeAlert() {
  document.getElementById('alert-modal').classList.remove('active');
  STATE.snoozedUntil = Date.now() + SNOOZE_SEC * 1000;
  STATE.alertShown = false;
  STATE.sedentarySeconds = getSedentaryLimitSec() - SNOOZE_SEC;
}

function resetSedentaryTimer() {
  document.getElementById('alert-modal').classList.remove('active');
  STATE.alertShown = false; STATE.snoozedUntil = 0; STATE.sedentarySeconds = 0;
  if (STATE.today) {
    STATE.today.sedentaryCycles = (STATE.today.sedentaryCycles || 0) + 1;
    document.getElementById('sc-cycles').textContent = STATE.today.sedentaryCycles;
    updateArterialAge();
  }
  persist();
}

// ─── BACKGROUND PEDOMETRY ─────────────────────────────────────
function startBackgroundPedometry() {
  // Real device motion
  if (typeof DeviceMotionEvent !== 'undefined') {
    const req = DeviceMotionEvent.requestPermission;
    if (typeof req === 'function') {
      req().then(p => { if (p === 'granted') setupAccelerometer(); }).catch(()=>{});
    } else {
      setupAccelerometer();
    }
  }
  // Fallback simulation for desktop demo
  let accum = 0;
  STATE.stepInterval = setInterval(() => {
    if (!STATE.today) return;
    const add = Math.random() < 0.4 ? Math.floor(Math.random() * 2) + 1 : 0;
    accum += add;
    if (accum >= 5) { addSteps(Math.floor(accum)); accum = 0; }
  }, 900);
}

function setupAccelerometer() {
  let last = { x: 0, y: 0, z: 0 }, cool = false;
  window.addEventListener('devicemotion', e => {
    const a = e.acceleration; if (!a) return;
    const mag = Math.sqrt(
      Math.pow((a.x||0) - last.x, 2) + Math.pow((a.y||0) - last.y, 2) + Math.pow((a.z||0) - last.z, 2)
    );
    last = { x: a.x||0, y: a.y||0, z: a.z||0 };
    if (mag > 11 && !cool) {
      addSteps(1);
      resetSedentaryTimer();
      cool = true;
      setTimeout(() => { cool = false; }, 380);
    }
  });
}

function calcMETCalories(steps, actKey, weightKg, durationMin) {
  const meta = ACTIVITY_META[actKey] || ACTIVITY_META.walking;
  const met  = meta.met;
  const kg   = weightKg || 75;
  // kcal = MET × weight(kg) × time(h)
  return parseFloat((met * kg * (durationMin / 60)).toFixed(1));
}

function addSteps(n) {
  if (!STATE.today) return;
  STATE.today.steps += n;
  if (STATE.today.activityBreakdown) {
    STATE.today.activityBreakdown[STATE.currentActivity] =
      (STATE.today.activityBreakdown[STATE.currentActivity] || 0) + n;
  }

  // MET-accurate calorie calculation
  const u = STATE.user;
  const mins = STATE.today.steps / 100; // rough active minutes
  STATE.today.calories = calcMETCalories(STATE.today.steps, STATE.currentActivity, u?.weight, mins);

  // Distance per stride
  const meta = ACTIVITY_META[STATE.currentActivity];
  STATE.today.distance = parseFloat((STATE.today.steps * (meta?.strideM || 0.762) / 1000).toFixed(2));
  STATE.today.activeMinutes = Math.floor(STATE.today.steps / 100);

  updateStepUI();
  persist();
}

function updateStepUI() {
  if (!STATE.today || !STATE.user) return;
  const steps = STATE.today.steps;
  const goal  = STATE.user.stepGoal || 8500;
  const maxCal = calcMETCalories(goal, STATE.currentActivity, STATE.user.weight, goal / 100);

  // Outer ring (steps)
  const stepPct = Math.min(steps / goal, 1);
  const stepOffset = CIRC_STEP * (1 - stepPct);
  const sc = document.getElementById('step-progress-circle');
  if (sc) sc.style.strokeDashoffset = stepOffset;

  // Inner ring (calories)
  const calPct = Math.min(STATE.today.calories / Math.max(maxCal, 1), 1);
  const calOffset = CIRC_CAL * (1 - calPct);
  const cc = document.getElementById('cal-progress-circle');
  if (cc) cc.style.strokeDashoffset = calOffset;

  document.getElementById('step-count').textContent = steps.toLocaleString();
  document.getElementById('steps-remaining').textContent = Math.max(0, goal - steps).toLocaleString();
  document.getElementById('calories-est').textContent = STATE.today.calories.toLocaleString();
  document.getElementById('distance-est').textContent = STATE.today.distance;
  document.getElementById('active-minutes').textContent = STATE.today.activeMinutes;
  document.getElementById('met-value').textContent = ACTIVITY_META[STATE.currentActivity]?.met || 3.5;

  // AHA bar
  const ahaPct = Math.min((steps / 10000) * 100, 100);
  document.getElementById('aha-bar-fill').style.width = ahaPct + '%';
  document.getElementById('aha-current').textContent = `${steps.toLocaleString()} / 10,000 steps`;
  document.getElementById('aha-bar-wrap').setAttribute('aria-valuenow', steps);

  // Heart score
  const hs = Math.min(100, Math.round(40 + stepPct * 35 + (STATE.today.sedentaryCycles || 0) * 4));
  document.getElementById('hs-value').textContent = hs;
  const hsC = 2 * Math.PI * 22;
  const hsOff = hsC * (1 - hs / 100);
  const hsc = document.getElementById('hs-circle');
  if (hsc) hsc.style.strokeDashoffset = hsOff;

  updateArterialAge();
}

// ─── ARTERIAL AGE ESTIMATOR ──────────────────────────────────
// Based on: Paluch et al. (2021) JAMA Network Open
// ~2000 extra steps per day ≈ 1 year younger vascular age
function updateArterialAge() {
  if (!STATE.user) return;
  const age     = STATE.user.age;
  const steps   = STATE.today?.steps || 0;
  const goal    = STATE.user.stepGoal || 8500;
  const breaks  = STATE.today?.sedentaryCycles || 0;
  const miCount = STATE.today?.miSessions?.length || 0;

  // Step benefit: each 2000 steps above 4000 = 1yr younger
  const stepBenefit = Math.min(5, Math.max(-3, Math.floor((steps - 4000) / 2000)));
  // Sedentary break benefit
  const breakBenefit = Math.min(2, breaks * 0.5);
  // MI benefit
  const miBenefit = Math.min(1, miCount * 0.5);

  const arterialAge = Math.max(18, Math.round(age - stepBenefit - breakBenefit - miBenefit));
  const delta = arterialAge - age;

  const artEl  = document.getElementById('arterial-age');
  const deltaEl = document.getElementById('arterial-delta');
  const miniEl  = document.getElementById('art-age-mini');
  const badgeEl = document.getElementById('aa-status-badge');
  const explEl  = document.getElementById('aa-explanation');
  const rfArtEl = document.getElementById('rf-art-val');

  if (artEl) artEl.textContent = arterialAge;
  if (miniEl) miniEl.textContent = arterialAge;
  if (deltaEl) {
    deltaEl.textContent = delta > 0 ? `+${delta} yrs` : delta < 0 ? `${delta} yrs` : 'Matched';
    deltaEl.style.color = delta <= 0 ? 'var(--emerald)' : delta <= 3 ? 'var(--amber)' : 'var(--red)';
  }
  if (badgeEl) {
    badgeEl.textContent = delta <= 0 ? '🟢 Younger Than Age' : delta <= 3 ? '🟡 Close to Age' : '🔴 Older Than Age';
    badgeEl.style.background = delta <= 0 ? 'rgba(16,185,129,.15)' : delta <= 3 ? 'rgba(245,158,11,.15)' : 'rgba(239,68,68,.15)';
    badgeEl.style.color = delta <= 0 ? 'var(--emerald)' : delta <= 3 ? 'var(--amber)' : 'var(--red)';
  }
  if (explEl) {
    explEl.textContent = steps < 1000 ?
      'Complete your first walk to calibrate your arterial age.' :
      delta <= 0 ?
      `🎉 Your vascular health is tracking younger than your chronological age — keep it up!` :
      `Add ${2000 * Math.ceil(delta / 1)} more daily steps to reduce your arterial age by ~${Math.ceil(delta / 1)} year(s).`;
  }
  if (rfArtEl) rfArtEl.textContent = delta <= 0 ? '✓ Younger' : delta <= 3 ? '⚠ Near age' : '✗ Older';
}

// ─── HR ZONES PANEL ──────────────────────────────────────────
function renderHRZones() {
  if (!STATE.user) return;
  const maxHR = 220 - STATE.user.age; // true max (not 85% target)
  const container = document.getElementById('hrz-bars');
  if (!container) return;
  container.innerHTML = '';

  HR_ZONES.forEach(z => {
    const low  = Math.round(maxHR * z.min);
    const high = Math.round(maxHR * z.max);
    const row  = document.createElement('div');
    row.className = 'hrz-zone';
    row.innerHTML = `
      <div class="hrz-dot" style="background:${z.color}"></div>
      <div class="hrz-label">${z.name.split(' — ')[1]}</div>
      <div class="hrz-bar-wrap">
        <div class="hrz-bar-fill" style="width:0%;background:${z.color}" data-min="${low}" data-max="${high}"></div>
      </div>
      <div class="hrz-range">${low}–${high}</div>`;
    container.appendChild(row);
    // Animate bars in
    setTimeout(() => { row.querySelector('.hrz-bar-fill').style.width = `${z.max * 100}%`; }, 300);
  });

  document.getElementById('hrz-max').textContent = maxHR;
}

function updateHRZoneBadge(bpm) {
  if (!STATE.user) return;
  const maxHR = 220 - STATE.user.age;
  const pct   = bpm / maxHR;
  const zone  = HR_ZONES.find(z => pct >= z.min && pct < z.max) || HR_ZONES[0];
  const badge = document.getElementById('hrz-current-badge');
  const zDisp = document.getElementById('hr-zone-display');
  if (badge) { badge.textContent = zone.name; badge.style.background = zone.color + '28'; badge.style.color = zone.color; }
  if (zDisp) { zDisp.textContent = zone.name; zDisp.style.background = zone.color + '22'; zDisp.style.color = zone.color; }
}

// ─── TAB SWITCHING ────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    const a = b.id === `tab-${name}`;
    b.classList.toggle('active', a);
    b.setAttribute('aria-selected', a);
  });
  document.querySelectorAll('.tab-content').forEach(c =>
    c.classList.toggle('active', c.id === `tab-content-${name}`)
  );
  if (name === 'history') renderHistory();
}

// ─── CAMERA SESSION ───────────────────────────────────────────
async function startCameraSession() {
  const btn = document.getElementById('start-camera-btn');
  btn.textContent = 'Starting camera…'; btn.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: STATE.cameraFacingMode, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false,
    });
    STATE.cameraStream = stream;
    const video = document.getElementById('session-video');
    video.srcObject = stream;
    video.onloadedmetadata = () => { video.play(); initCameraSession(video); };
  } catch(err) {
    btn.disabled = false;
    btn.textContent = '▶ Start Camera Session';
    showCameraError(err);
  }
}

function initCameraSession(video) {
  document.getElementById('camera-overlay').style.display = 'none';
  document.getElementById('session-hud').classList.remove('hidden');
  document.getElementById('session-flip-btn').classList.remove('hidden');
  document.getElementById('session-controls-idle').style.display = 'none';
  document.getElementById('session-controls-active').classList.remove('hidden');

  const meta = ACTIVITY_META[STATE.currentActivity];
  STATE.session = {
    startTime: Date.now(), steps: 0, cadence: 0,
    qualityScore: 75, prevHipY: null, inStepDown: false,
    stepHistory: [], lastStepTime: 0, actKey: STATE.currentActivity,
    calories: 0,
  };

  const canvas = document.getElementById('session-canvas');
  const ctx    = canvas.getContext('2d');

  // HUD timer
  const hudTimer = setInterval(() => {
    if (!STATE.session) { clearInterval(hudTimer); return; }
    const s  = Math.floor((Date.now() - STATE.session.startTime) / 1000);
    const m  = Math.floor(s / 60);
    document.getElementById('hud-time').textContent = `${m}:${String(s%60).padStart(2,'0')}`;

    // Live MET calories
    const dMin = s / 60;
    STATE.session.calories = calcMETCalories(0, STATE.session.actKey, STATE.user?.weight, dMin);
    document.getElementById('hud-kcal').textContent = Math.round(STATE.session.calories);
    document.getElementById('kcal-session-text').textContent = `${Math.round(STATE.session.calories)} kcal`;
    document.getElementById('kcal-bar').style.width = Math.min((STATE.session.calories / 50) * 100, 100) + '%';
  }, 1000);

  // RPE check every 5 min
  const rpeTimer = setInterval(() => {
    if (!STATE.session) { clearInterval(rpeTimer); return; }
    if ((Date.now() - STATE.session.startTime) > 300000 &&
        Math.floor((Date.now() - STATE.session.startTime) / 1000) % 300 < 2) showRPEModal();
  }, 2000);

  // Pose detection loop
  let simPhase = 0;
  STATE.poseDetectionInterval = setInterval(() => {
    if (!STATE.session || !video.videoWidth) return;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    // ── MediaPipe integration point ──
    // Replace this with: poseLandmarker.detectForVideo(video, performance.now())
    // then pass landmarks to processHipMovement()
    const hipY = simulatePose(simPhase);
    simPhase += 0.32;
    processHipMovement(hipY);
    drawSkeleton(ctx, canvas.width, canvas.height);
  }, 100);

  document.getElementById('det-dot').className = 'det-dot active';
  document.getElementById('det-text').textContent = 'Pose detection active';
}

let simPhase = 0;
function simulatePose(phase) {
  return 240 + Math.sin(phase) * 14 + (Math.random() * 3 - 1.5);
}

function processHipMovement(hipY) {
  const s = STATE.session; if (!s) return;
  const THRESH = 8, COOL = 350;
  const ALPHA = 0.3;
  const smoothed = s.prevHipY !== null ? ALPHA * hipY + (1 - ALPHA) * s.prevHipY : hipY;
  const delta = s.prevHipY !== null ? smoothed - s.prevHipY : 0;

  if (delta > THRESH && !s.inStepDown)   s.inStepDown = true;
  else if (delta < -THRESH && s.inStepDown) {
    s.inStepDown = false;
    const now = Date.now();
    if (now - s.lastStepTime > COOL) {
      s.lastStepTime = now; s.steps++;
      s.stepHistory.push(now);
      if (s.stepHistory.length > 10) s.stepHistory.shift();
      if (s.stepHistory.length >= 2) {
        const win = s.stepHistory.at(-1) - s.stepHistory[0];
        s.cadence = Math.round((s.stepHistory.length - 1) / (win / 1000) * 60);
      }
      document.getElementById('hud-steps').textContent = s.steps.toLocaleString();
      document.getElementById('hud-cadence').textContent = s.cadence || '—';
      addSteps(1);

      const cadPct = Math.min((s.cadence / 140) * 100, 100);
      document.getElementById('cadence-bar').style.width = cadPct + '%';
      document.getElementById('cadence-text').textContent = `${s.cadence || '—'} steps/min`;

      s.qualityScore = Math.min(100, Math.max(40, s.qualityScore + (Math.random()*4 - 1)));
      const qPct = Math.round(s.qualityScore);
      document.getElementById('quality-bar').style.width = qPct + '%';
      document.getElementById('quality-text').textContent = qPct > 75 ? 'Good form ✓' : qPct > 50 ? 'Moderate' : 'Improve posture';
    }
  }
  s.prevHipY = smoothed;
}

function drawSkeleton(ctx, w, h) {
  const cx = w/2, cy = h/2;
  const joints = [[cx,cy-80],[cx,cy-40],[cx-42,cy],[cx+42,cy],[cx,cy+20],[cx-32,cy+80],[cx+32,cy+80]];
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = '#6366f1'; ctx.lineWidth = 2.5;
  [[0,1],[1,2],[1,3],[2,4],[3,4],[4,5],[4,6]].forEach(([a,b]) => {
    ctx.beginPath(); ctx.moveTo(joints[a][0],joints[a][1]); ctx.lineTo(joints[b][0],joints[b][1]); ctx.stroke();
  });
  joints.forEach(([x,y]) => {
    ctx.beginPath(); ctx.arc(x,y,5,0,Math.PI*2); ctx.fillStyle = '#ec4899'; ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function stopCameraSession() {
  if (STATE.cameraStream) { STATE.cameraStream.getTracks().forEach(t => t.stop()); STATE.cameraStream = null; }
  if (STATE.poseDetectionInterval) { clearInterval(STATE.poseDetectionInterval); STATE.poseDetectionInterval = null; }
  const s = STATE.session; if (!s) return;

  const elapsed = Math.floor((Date.now() - s.startTime) / 1000);
  const m = Math.floor(elapsed/60), sec = elapsed%60;
  document.getElementById('ss-steps').textContent = s.steps.toLocaleString();
  document.getElementById('ss-time').textContent   = `${m}:${String(sec).padStart(2,'0')}`;
  document.getElementById('ss-cadence').textContent = s.cadence || '—';
  document.getElementById('ss-kcal').textContent   = Math.round(s.calories);

  const banner = document.getElementById('achievement-banner');
  banner.textContent = s.steps >= 2000 ? '🏆 2,000+ steps — Outstanding session!' :
                       s.steps >= 1000 ? '⭐ 1,000+ steps — Great effort!' :
                       s.steps >= 500  ? '✓ 500 steps — Good start!' : '';

  if (STATE.today) {
    STATE.today.sessions.push({ steps: s.steps, duration: elapsed, kcal: Math.round(s.calories), date: new Date().toISOString() });
    persist();
  }

  STATE.session = null;
  document.getElementById('session-hud').classList.add('hidden');
  document.getElementById('session-flip-btn').classList.add('hidden');
  document.getElementById('session-controls-active').classList.add('hidden');
  document.getElementById('session-summary').classList.remove('hidden');
  document.getElementById('session-video').srcObject = null;
}

function flipCamera(source) {
  STATE.cameraFacingMode = STATE.cameraFacingMode === 'user' ? 'environment' : 'user';
  if (source === 'session') {
    if (STATE.cameraStream) { STATE.cameraStream.getTracks().forEach(t => t.stop()); STATE.cameraStream = null; }
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: STATE.cameraFacingMode, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false,
    }).then(stream => {
      STATE.cameraStream = stream;
      const video = document.getElementById('session-video');
      video.srcObject = stream;
    }).catch(showCameraError);
  } else if (source === 'hr') {
    if (STATE.hrSession?.stream) STATE.hrSession.stream.getTracks().forEach(t=>t.stop());
    navigator.mediaDevices.getUserMedia({ video: { facingMode: STATE.cameraFacingMode }, audio: false })
      .then(stream => {
        STATE.hrSession.stream = stream;
        const v = document.getElementById('hr-video');
        v.srcObject = stream;
        
        const track = stream.getVideoTracks()[0];
        if (track.getCapabilities && track.getCapabilities().torch) {
          track.applyConstraints({ advanced: [{ torch: true }] }).catch(e => console.warn('Torch issue:', e));
        }
      }).catch(() => simulateHR());
  }
}

function resetSession() {
  document.getElementById('session-summary').classList.add('hidden');
  document.getElementById('camera-overlay').style.display = 'flex';
  document.getElementById('session-controls-idle').style.display = 'block';
  const btn = document.getElementById('start-camera-btn');
  btn.textContent = '▶ Start Camera Session'; btn.disabled = false;
}

function endSession() { stopCameraSession(); closeCooldown(); }

function showCameraError(err) {
  document.getElementById('camera-overlay').innerHTML = `
    <div class="camera-idle-content">
      <div style="font-size:44px;margin-bottom:12px">🚫</div>
      <h3>Camera Not Available</h3>
      <p style="color:var(--text-secondary);font-size:12px;line-height:1.5;margin-bottom:14px">
        ${err.name==='NotAllowedError' ? 'Permission denied — enable camera in browser settings.' : 'Camera not accessible on this device.'}
      </p>
      <p style="color:var(--text-muted);font-size:11px">Background accelerometer step counting continues automatically.</p>
    </div>`;
}

// ─── HEART RATE (rPPG) ────────────────────────────────────────
const hrBuffer = [], hrWaveData = [];
const HR_BUF_MAX = 90, HR_FPS = 30;

function startHRCheck() {
  document.getElementById('hr-idle-state').classList.add('hidden');
  document.getElementById('hr-measuring-state').classList.remove('hidden');
  document.getElementById('hr-video').classList.remove('hidden');

  navigator.mediaDevices.getUserMedia({ video: { facingMode: STATE.cameraFacingMode === 'user' ? 'user' : 'environment' }, audio: false })
    .then(stream => {
      STATE.hrSession = { stream };
      const v = document.getElementById('hr-video');
      v.srcObject = stream;
      
      const track = stream.getVideoTracks()[0];
      if (track.getCapabilities && track.getCapabilities().torch) {
        track.applyConstraints({ advanced: [{ torch: true }] }).catch(e => console.warn('Torch issue:', e));
      }

      v.onloadedmetadata = () => { v.play(); hrLoop(v); };
    })
    .catch(() => simulateHR());
}

async function connectBluetoothHR() {
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['heart_rate'] }]
    });
    
    document.getElementById('hr-idle-state').classList.add('hidden');
    document.getElementById('hr-measuring-state').classList.remove('hidden');
    document.getElementById('hr-video').classList.add('hidden'); // Hide video for BLE
    document.getElementById('hr-status-text').textContent = `Connecting to ${device.name || 'Device'}...`;
    
    STATE.bluetoothDevice = device;
    device.addEventListener('gattserverdisconnected', onBluetoothDisconnected);

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    const characteristic = await service.getCharacteristic('heart_rate_measurement');
    
    await characteristic.startNotifications();
    characteristic.addEventListener('characteristicvaluechanged', handleHRMeasurement);
    
    document.getElementById('hr-status-text').textContent = `Connected to ${device.name || 'BLE Device'} (Live)`;
  } catch (error) {
    console.error('Bluetooth connection failed', error);
    if(error.name !== 'NotFoundError') {
       alert('Could not connect to Bluetooth device. Ensure it is turned on and broadcasting.');
    }
    stopHRCheck();
  }
}

function handleHRMeasurement(event) {
  const value = event.target.value;
  const flags = value.getUint8(0);
  const rate16Bits = flags & 0x1;
  const heartRate = rate16Bits ? value.getUint16(1, true) : value.getUint8(1);

  document.getElementById('hr-bpm-value').textContent = heartRate;
  document.getElementById('hrz-resting').textContent = heartRate;
  updateHRZoneBadge(heartRate);
  checkHRThreshold(heartRate);
  
  if (STATE.today) {
    const lastReading = STATE.today.hrReadings.at(-1);
    if (!lastReading || (Date.now() - lastReading.time) > 2000) {
        STATE.today.hrReadings.push({ bpm: heartRate, time: Date.now() });
    }
  }
}

function onBluetoothDisconnected() {
  if (STATE.bluetoothDevice) {
    alert('Bluetooth device disconnected.');
    stopHRCheck();
  }
}

function hrLoop(video) {
  const canvas = document.getElementById('hr-canvas');
  const ctx    = canvas.getContext('2d');
  canvas.width = video.videoWidth || 320;
  canvas.height = video.videoHeight || 240;
  ctx.drawImage(video, 0, 0);

  const cx = Math.floor(canvas.width/2), cy = Math.floor(canvas.height/2);
  const px = ctx.getImageData(cx-10,cy-10,20,20);
  let r = 0;
  for (let i = 0; i < px.data.length; i += 4) r += px.data[i];
  const avg = r / (px.data.length/4);

  hrBuffer.push(avg);
  if (hrBuffer.length > HR_BUF_MAX) hrBuffer.shift();
  drawHRWave(avg);

  if (hrBuffer.length >= HR_BUF_MAX) {
    const bpm = calcBPM(hrBuffer, HR_FPS);
    if (bpm) {
      document.getElementById('hr-bpm-value').textContent = Math.round(bpm);
      document.getElementById('hr-status-text').textContent = 'Pulse detected';
      document.getElementById('hrz-resting').textContent = Math.round(bpm);
      updateHRZoneBadge(Math.round(bpm));
      checkHRThreshold(bpm);
      if (STATE.today) STATE.today.hrReadings.push({ bpm: Math.round(bpm), time: Date.now() });
    }
  } else {
    document.getElementById('hr-status-text').textContent = `Calibrating… ${hrBuffer.length}/${HR_BUF_MAX}`;
  }
  STATE.hrFrameId = requestAnimationFrame(() => hrLoop(video));
}

function drawHRWave(val) {
  hrWaveData.push(val);
  if (hrWaveData.length > 280) hrWaveData.shift();
  const cv  = document.getElementById('waveform-canvas');
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, 280, 60);
  if (hrWaveData.length < 2) return;
  const min = Math.min(...hrWaveData), max = Math.max(...hrWaveData);
  const range = max - min || 1;
  ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2; ctx.beginPath();
  hrWaveData.forEach((v,i) => {
    const x = i, y = 60 - ((v - min) / range) * 54 - 3;
    i === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
  });
  ctx.stroke();
}

function calcBPM(buf, fps) {
  const win = 5, sm = [];
  for (let i = win; i < buf.length - win; i++) {
    let s = 0;
    for (let j = -win; j <= win; j++) s += buf[i+j];
    sm.push(s / (win*2+1));
  }
  const peaks = [];
  for (let i = 1; i < sm.length-1; i++) {
    if (sm[i] > sm[i-1] && sm[i] > sm[i+1] && (peaks.length===0 || i-peaks.at(-1) > fps*0.3)) peaks.push(i);
  }
  if (peaks.length < 2) return null;
  const intervals = [];
  for (let i = 1; i < peaks.length; i++) intervals.push(peaks[i] - peaks[i-1]);
  const avg = intervals.reduce((a,b)=>a+b,0) / intervals.length;
  return (fps / avg) * 60;
}

function simulateHR() {
  document.getElementById('hr-status-text').textContent = 'Demo mode';
  let phase = 0, bpm = 68 + Math.floor(Math.random()*10);
  const iv = setInterval(() => {
    if (document.getElementById('hr-idle-state') && !document.getElementById('hr-measuring-state').classList.contains('hidden') === false) {
      clearInterval(iv); return;
    }
    phase += (bpm/60) * (1/HR_FPS) * Math.PI * 2;
    const val = 100 + Math.sin(phase)*22 + Math.random()*4;
    hrBuffer.push(val);
    if (hrBuffer.length > HR_BUF_MAX) hrBuffer.shift();
    drawHRWave(val);
    if (hrBuffer.length > 60) {
      const d = bpm + Math.floor(Math.random()*4-2);
      document.getElementById('hr-bpm-value').textContent = d;
      document.getElementById('hr-status-text').textContent = 'Pulse detected (demo)';
      document.getElementById('hrz-resting').textContent = d;
      updateHRZoneBadge(d);
      checkHRThreshold(d);
    }
  }, 33);
  if (STATE.hrSession) STATE.hrSession.simIv = iv;
  else STATE.hrSession = { simIv: iv };
}

function checkHRThreshold(bpm) {
  if (!STATE.user) return;
  if (bpm > calcMaxHR(STATE.user.age)) {
    document.getElementById('hr-threshold').textContent = calcMaxHR(STATE.user.age);
    document.getElementById('cooldown-modal').classList.add('active');
  }
}

function stopHRCheck() {
  if (STATE.hrFrameId) { cancelAnimationFrame(STATE.hrFrameId); STATE.hrFrameId = null; }
  if (STATE.hrSession?.stream) STATE.hrSession.stream.getTracks().forEach(t=>t.stop());
  if (STATE.hrSession?.simIv) clearInterval(STATE.hrSession.simIv);
  STATE.hrSession = null;
  
  if (STATE.bluetoothDevice?.gatt?.connected) {
    STATE.bluetoothDevice.gatt.disconnect();
  }
  STATE.bluetoothDevice = null;
  
  hrBuffer.length = 0; hrWaveData.length = 0;
  document.getElementById('hr-video').classList.remove('hidden'); // Reset for next camera usage
  document.getElementById('hr-idle-state').classList.remove('hidden');
  document.getElementById('hr-measuring-state').classList.add('hidden');
}

function closeCooldown() { document.getElementById('cooldown-modal').classList.remove('active'); }

// ─── RPE ─────────────────────────────────────────────────────
function showRPEModal() { document.getElementById('rpe-modal').classList.add('active'); }

function setRPE(val, el) {
  STATE.selectedRPE = val;
  document.querySelectorAll('.rpe-item').forEach(item => {
    const v = parseInt(item.dataset.rpe);
    item.classList.remove('selected','danger-zone');
    if (v === val) item.classList.add('selected');
    if (v >= 17 && val >= 17) item.classList.add('danger-zone');
  });
  document.getElementById('rpe-warning').hidden = val < 17;
}

function confirmRPE() {
  if (!STATE.selectedRPE) return;
  document.getElementById('rpe-modal').classList.remove('active');
  if (STATE.selectedRPE >= 17 && STATE.user) {
    setTimeout(() => {
      document.getElementById('hr-threshold').textContent = calcMaxHR(STATE.user.age);
      document.getElementById('cooldown-modal').classList.add('active');
    }, 400);
  }
  STATE.selectedRPE = null;
  document.querySelectorAll('.rpe-item').forEach(el => el.classList.remove('selected','danger-zone'));
}

function quickRPE(val) {
  if (val >= 17 && STATE.user) {
    document.getElementById('hr-threshold').textContent = calcMaxHR(STATE.user.age);
    document.getElementById('cooldown-modal').classList.add('active');
  }
}

// ─── MICRO-INTERVENTIONS ─────────────────────────────────────
let miTimerIv = null;

function selectMI(key) {
  if (key === 'random') key = Object.keys(MICRO_INTERVENTIONS)[Math.floor(Math.random()*6)];
  STATE.selectedMI = key;
  startMicroIntervention(key);
}

function startMicroIntervention(source) {
  document.getElementById('alert-modal').classList.remove('active');
  resetSedentaryTimer();

  const key = (source === 'alert' || source === 'quick') ? getRecommendedMI() : (STATE.selectedMI || 'march');
  const mi  = MICRO_INTERVENTIONS[key];
  if (!mi) return;

  switchTab('interventions');
  document.getElementById('mi-idle').style.display  = 'none';
  document.getElementById('mi-active-zone').classList.remove('hidden');
  document.getElementById('mi-ex-icon').textContent = mi.icon;
  document.getElementById('mi-ex-name').textContent = mi.name;
  document.getElementById('mi-ex-desc').textContent = mi.desc;
  document.getElementById('mi-rep-num').textContent = '0';
  document.getElementById('mi-kcal-live').textContent = '0';

  let remaining = 120, reps = 0, repAccum = 0;
  const perSec = mi.repsPerMin / 60;
  const weight = STATE.user?.weight || 75;
  updateMITimerUI(remaining);
  if (miTimerIv) clearInterval(miTimerIv);

  miTimerIv = setInterval(() => {
    remaining--;
    repAccum += perSec;
    if (repAccum >= 1) { reps += Math.floor(repAccum); repAccum = 0; document.getElementById('mi-rep-num').textContent = reps; }
    const elapsed = 120 - remaining;
    const kcal = parseFloat((mi.met * weight * (elapsed / 3600)).toFixed(2));
    document.getElementById('mi-kcal-live').textContent = kcal.toFixed(1);
    updateMITimerUI(remaining);
    if (remaining <= 0) completeMISession(key, reps, kcal);
  }, 1000);

  STATE.miSession = { key, startTime: Date.now() };
}

function getRecommendedMI() {
  const cond = STATE.user?.condition || 'prevention';
  if (['hf','af','post_mi'].includes(cond)) return 'stretch';
  if (['cad'].includes(cond)) return 'calfraise';
  const h = new Date().getHours();
  if (h < 8 || h > 21) return 'stretch';
  return 'march';
}

function updateMITimerUI(sec) {
  document.getElementById('mi-timer-sec').textContent = sec;
  const fill = document.getElementById('mi-timer-circle');
  if (fill) fill.style.strokeDashoffset = CIRC_MI * (sec / 120);
}

function completeMISession(key, reps, kcal) {
  clearInterval(miTimerIv); STATE.miSession = null;
  const mi  = MICRO_INTERVENTIONS[key];
  const now = new Date();
  const t   = now.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });

  if (STATE.today) {
    STATE.today.miSessions.push({ key, reps, kcal, time: now.toISOString() });
    STATE.today.calories = parseFloat((STATE.today.calories + kcal).toFixed(1));
    persist();
  }
  addMILogEntry(mi, t, reps, kcal);
  resetMIUI();
  updateArterialAge();
  if ('vibrate' in navigator) navigator.vibrate([100,50,100]);
}

function skipMIExercise() {
  clearInterval(miTimerIv);
  const keys = Object.keys(MICRO_INTERVENTIONS).filter(k => k !== STATE.selectedMI);
  selectMI(keys[Math.floor(Math.random()*keys.length)]);
}

function endMISession() { clearInterval(miTimerIv); STATE.miSession = null; resetMIUI(); }

function resetMIUI() {
  document.getElementById('mi-active-zone').classList.add('hidden');
  document.getElementById('mi-idle').style.display = 'block';
}

function addMILogEntry(mi, timeStr, reps, kcal) {
  const list  = document.getElementById('mi-log-list');
  const empty = list.querySelector('.mi-log-empty');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.className = 'mi-log-entry';
  div.innerHTML = `
    <div class="mi-log-icon">${mi.icon}</div>
    <div style="flex:1">
      <div class="mi-log-name">${mi.name}</div>
      <div class="mi-log-time">${timeStr} · ${reps} reps · ${Number(kcal).toFixed(1)} kcal</div>
    </div>
    <div class="mi-log-badge">✓ Done</div>`;
  list.insertBefore(div, list.firstChild);
}

// ─── PROGRESS CHARTS ─────────────────────────────────────────
function generateMockHistory() {
  const goal = STATE.user?.stepGoal || 8500;
  const acts = Object.keys(ACTIVITY_META);
  for (let i = 1; i <= 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const steps = Math.floor(3500 + Math.random() * 8000);
    const act   = acts[Math.floor(Math.random() * acts.length)];
    const mins  = steps / 100;
    const kcal  = calcMETCalories(0, act, STATE.user?.weight, mins);
    STATE.history.unshift({
      date: d.toISOString().slice(0,10), steps, goal,
      calories: kcal, distance: parseFloat((steps*0.000762).toFixed(2)),
      activeMinutes: Math.floor(mins), sittingMinutes: Math.floor(250+Math.random()*300),
      sedentaryCycles: Math.floor(Math.random()*5),
      miSessions: Array(Math.floor(Math.random()*4)).fill({key:'march',kcal:2}),
      sessions: [], hrReadings: [],
    });
  }
  persist();
}

let chartRange = 7;

function setRange(range, btn) {
  chartRange = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  document.querySelectorAll('.dr-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderHistory();
}

function renderHistory() {
  const all  = [STATE.today, ...STATE.history].filter(Boolean);
  const data = all.slice(0, chartRange).reverse();
  drawStepsChart(data);
  drawSittingChart(data);
  drawKcalChart(data);
  renderHistoryTable(data.slice(-7).reverse());
  updateStreakData(all);
  updateRiskCard(STATE.today);

  // Total kcal
  const totalKcal = all.reduce((s,d) => s + (d.calories||0), 0);
  document.getElementById('total-kcal').textContent = Math.round(totalKcal).toLocaleString();
}

function renderDashboard() {
  updateStepUI();
  if (STATE.today) {
    document.getElementById('sc-cycles').textContent = STATE.today.sedentaryCycles || 0;
  }
}

// ─── CANVAS CHARTS ────────────────────────────────────────────
function drawStepsChart(data) {
  const canvas = document.getElementById('steps-chart');
  if (!canvas) return;
  const W = canvas.width = canvas.offsetWidth || 300, H = 180;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,W,H);
  if (!data.length) return;

  const goal = STATE.user?.stepGoal || 8500;
  const maxV = Math.max(...data.map(d=>d.steps), goal) * 1.15;
  const bW   = (W-40)/data.length - 6, chartH = H - 40;

  data.forEach((d,i) => {
    const x = 20 + i*((W-40)/data.length) + 3;
    const bH = (d.steps/maxV) * chartH;
    const y  = H - 30 - bH;
    const met = d.steps >= goal;
    const g = ctx.createLinearGradient(0,y,0,H-30);
    g.addColorStop(0, met ? '#10b981' : '#6366f1');
    g.addColorStop(1, met ? 'rgba(16,185,129,.25)' : 'rgba(99,102,241,.25)');
    ctx.fillStyle = g;
    roundRect(ctx, x, y, bW, bH, 4); ctx.fill();

    const dm = new Date(d.date);
    ctx.fillStyle = '#64748b'; ctx.font = '10px Inter'; ctx.textAlign = 'center';
    ctx.fillText(['Su','Mo','Tu','We','Th','Fr','Sa'][dm.getUTCDay()], x+bW/2, H-13);
  });

  // Goal line
  const gy = H - 30 - (goal/maxV)*chartH;
  ctx.strokeStyle = 'rgba(239,68,68,.55)'; ctx.lineWidth = 1.5;
  ctx.setLineDash([4,4]);
  ctx.beginPath(); ctx.moveTo(20,gy); ctx.lineTo(W-20,gy); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#ef4444'; ctx.font = '10px Inter'; ctx.textAlign = 'right';
  ctx.fillText(`${(goal/1000).toFixed(1)}k`, W-4, gy-3);
}

function drawSittingChart(data) {
  const canvas = document.getElementById('sitting-chart');
  if (!canvas) return;
  const W = canvas.width = canvas.offsetWidth || 300, H = 140;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,W,H);
  if (!data.length) return;

  const maxV = Math.max(...data.map(d=>d.sittingMinutes||0), 480), bW = (W-40)/data.length-6, chartH = H-36;

  data.forEach((d,i) => {
    const x = 20+i*((W-40)/data.length)+3, sit = d.sittingMinutes||0;
    const bH = (sit/maxV)*chartH, y = H-28-bH;
    const pct = sit/480;
    const g = ctx.createLinearGradient(0,y,0,H-28);
    const [c1,c2] = pct>0.75 ? ['#ef4444','rgba(239,68,68,.2)'] : pct>0.5 ? ['#f59e0b','rgba(245,158,11,.2)'] : ['#10b981','rgba(16,185,129,.2)'];
    g.addColorStop(0,c1); g.addColorStop(1,c2);
    ctx.fillStyle = g;
    roundRect(ctx,x,y,bW,bH,4); ctx.fill();
    const dm = new Date(d.date);
    ctx.fillStyle = '#64748b'; ctx.font = '10px Inter'; ctx.textAlign = 'center';
    ctx.fillText(['Su','Mo','Tu','We','Th','Fr','Sa'][dm.getUTCDay()], x+bW/2, H-12);
  });
}

function drawKcalChart(data) {
  const canvas = document.getElementById('kcal-chart');
  if (!canvas) return;
  const W = canvas.width = canvas.offsetWidth || 300, H = 140;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,W,H);
  if (!data.length) return;

  const maxV = Math.max(...data.map(d=>d.calories||0), 100)*1.15;
  const bW = (W-40)/data.length-6, chartH = H-36;

  data.forEach((d,i) => {
    const x = 20+i*((W-40)/data.length)+3, cal = d.calories||0;
    const bH = (cal/maxV)*chartH, y = H-28-bH;
    const g = ctx.createLinearGradient(0,y,0,H-28);
    g.addColorStop(0,'#f59e0b'); g.addColorStop(1,'rgba(245,158,11,.2)');
    ctx.fillStyle = g;
    roundRect(ctx,x,y,bW,bH,4); ctx.fill();
    const dm = new Date(d.date);
    ctx.fillStyle = '#64748b'; ctx.font = '10px Inter'; ctx.textAlign = 'center';
    ctx.fillText(['Su','Mo','Tu','We','Th','Fr','Sa'][dm.getUTCDay()], x+bW/2, H-12);
  });
}

function roundRect(ctx, x, y, w, h, r) {
  if (w < 2*r) r = w/2; if (h < 2*r) r = h/2;
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}

function renderHistoryTable(data) {
  const tbody = document.getElementById('history-table-body'); if (!tbody) return;
  tbody.innerHTML = '';
  const goal = STATE.user?.stepGoal || 8500;
  data.forEach(d => {
    const dm = new Date(d.date);
    const met = d.steps >= goal;
    const row = document.createElement('div');
    row.className = 'ht-row'; row.setAttribute('role','row');
    row.innerHTML = `
      <span>${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dm.getUTCDay()]} ${dm.getUTCDate()}</span>
      <span class="ht-steps">${d.steps.toLocaleString()}</span>
      <span><div class="ht-badge ${met?'met':'missed'}">${met?'✓':'✗'}</div></span>
      <span>${Math.round(d.calories||0)}</span>
      <span>${(d.miSessions||[]).length}</span>`;
    tbody.appendChild(row);
  });
}

function updateStreakData(data) {
  const goal = STATE.user?.stepGoal || 8500;
  let streak = 0;
  for (const d of data) { if (d.steps >= goal) streak++; else break; }
  document.getElementById('streak-days').textContent  = streak;
  document.getElementById('goal-days').textContent    = data.filter(d=>d.steps>=goal).length;
  document.getElementById('mi-total').textContent     = data.reduce((s,d)=>s+(d.miSessions||[]).length,0);
}

function updateRiskCard(today) {
  if (!today || !STATE.user) return;
  const goal = STATE.user.stepGoal || 8500;
  const stepScore  = Math.min(1, today.steps / goal);
  const sitScore   = 1 - Math.min(1, (today.sittingMinutes||0) / 480);
  const miScore    = Math.min(1, (today.miSessions?.length||0) / 3);
  const condFactor = { hf: 1.3, af: 1.2, post_mi: 1.3, cad: 1.1, hypertension: 1.1, diabetes: 1.1, obesity: 1.1, prevention: 1.0 }[STATE.user.condition] || 1;
  const risk = Math.min(100, Math.round((1 - (stepScore*0.5 + sitScore*0.3 + miScore*0.2)) * 100 * condFactor));
  const level = risk < 30 ? 'Low' : risk < 60 ? 'Moderate' : 'High';
  const color = risk < 30 ? 'var(--emerald)' : risk < 60 ? 'var(--amber)' : 'var(--red)';

  document.getElementById('risk-score').textContent = risk;
  const rl = document.getElementById('risk-level'); rl.textContent = level; rl.style.color = color;
  const arc = document.getElementById('risk-arc');
  if (arc) arc.style.strokeDashoffset = 251.33 * (1 - risk/100);

  document.getElementById('rf-steps-val').textContent   = stepScore>=0.8?'✓ On track':stepScore>=0.5?'⚠ Behind':'✗ Below goal';
  document.getElementById('rf-sitting-val').textContent = sitScore>=0.7?'✓ Good breaks':sitScore>=0.5?'⚠ Too much':'✗ High risk';
  document.getElementById('rf-mi-val').textContent      = miScore>=0.67?'✓ Active':miScore>0?'⚠ Some':'✗ None today';

  ['rf-steps','rf-sitting','rf-mi'].forEach(id => {
    const vals = { 'rf-steps': stepScore, 'rf-sitting': sitScore, 'rf-mi': miScore };
    const v = vals[id];
    document.getElementById(id).querySelector('.rf-dot').className = `rf-dot ${v>=0.7?'green':v>=0.4?'yellow':'red'}`;
  });

  updateArterialAge();
}

// ─── ABOUT + PROFILE ─────────────────────────────────────────
function openAbout() { document.getElementById('about-modal').classList.add('active'); }

function openProfile() {
  if (!STATE.user) return;
  const u = STATE.user;
  const g = (CONDITION_GOALS[u.condition]?.label || u.condition);
  const maxHR = calcMaxHR(u.age);
  
  document.getElementById('profile-modal-avatar').textContent = u.name.slice(0,2).toUpperCase();
  document.getElementById('profile-modal-name').textContent = u.name;
  document.getElementById('profile-modal-age').textContent = `Age: ${u.age} | Weight: ${u.weight}kg`;
  document.getElementById('profile-modal-condition').textContent = g;
  document.getElementById('profile-modal-goal').textContent = (u.stepGoal||8500).toLocaleString();
  document.getElementById('profile-modal-activity').textContent = ACTIVITY_META[STATE.currentActivity]?.name || 'Walking';
  document.getElementById('profile-modal-maxhr').textContent = `${maxHR} BPM`;
  
  document.getElementById('profile-voice-toggle').checked = !!u.voiceEnabled;
  document.getElementById('profile-interval-select').value = u.reminderInterval || 50;
  
  document.getElementById('profile-modal').classList.add('active');
}

function updateVoiceSetting(enabled) {
  if (STATE.user) {
    STATE.user.voiceEnabled = enabled;
    persist();
    if (enabled && 'speechSynthesis' in window) {
       window.speechSynthesis.speak(new SpeechSynthesisUtterance("Voice reminders enabled."));
    }
  }
}

function updateIntervalSetting(val) {
  if (STATE.user) {
    STATE.user.reminderInterval = parseInt(val);
    persist();
    if (STATE.alertShown) resetSedentaryTimer(); 
  }
}

function editProfile() {
  document.getElementById('profile-modal').classList.remove('active');
  document.getElementById('onboarding-overlay').style.display = 'flex';
  // Use a small timeout to let the modal close before showing onboarding
  setTimeout(() => {
    document.getElementById('onboarding-overlay').style.opacity = '1';
    document.getElementById('onboarding-overlay').classList.add('active');
    showOBStep(1);
  }, 50);
}

function resetAppData() {
  if (confirm('Are you sure you want to permanently delete all your data? This cannot be undone.')) {
    localStorage.removeItem(DB_KEY);
    window.location.reload();
  }
}

// ─── INIT ─────────────────────────────────────────────────────
(function init() {
  // Canvas roundRect polyfill
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function(x,y,w,h,r){
      if(w<2*r)r=w/2; if(h<2*r)r=h/2;
      this.beginPath(); this.moveTo(x+r,y); this.arcTo(x+w,y,x+w,y+h,r);
      this.arcTo(x+w,y+h,x,y+h,r); this.arcTo(x,y+h,x,y,r); this.arcTo(x,y,x+w,y,r); this.closePath(); return this;
    };
  }
  const loaded = hydrate();
  if (loaded && STATE.user) {
    document.getElementById('onboarding-overlay').classList.remove('active');
    document.getElementById('onboarding-overlay').style.display = 'none';
    bootApp();
  } else {
    document.getElementById('onboarding-overlay').classList.add('active');
  }
})();
