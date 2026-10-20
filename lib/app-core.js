// Pure helpers shared by the app, the Worker tests, and the regression suite.
// No DOM, no Firebase. Safe to load from a plain <script> or from Node.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AppCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ANDROID_PRODUCT_IDS = ['pro_monthly', 'pro_annual'];
  const WEB_STRIPE_CHECKOUT_ENABLED = false;
  const FREE_MONTHLY_MESSAGE_ALLOWANCE = 8;
  const SHELL_STORAGE_KEY = 'aicoach-native-shell';
  const REVIEW_MIN_WORKOUTS = 4;
  const REVIEW_COOLDOWN_DAYS = 120;
  const COMMON_PASSWORDS = new Set([
    'password', 'password1', '12345678', '123456789', '1234567890', 'qwertyui',
    'qwerty123', 'letmein1', 'football', 'iloveyou', 'admin123', 'aicoach1',
    'abcd1234', 'welcome1', 'passw0rd', '11111111', '00000000'
  ]);

  const ANALYTICS_EVENTS = [
    'sign_up', 'onboarding_complete', 'first_workout_logged',
    'paywall_view', 'purchase_start', 'purchase_success', 'restore'
  ];

  function detectShell(input) {
    const src = input || {};
    const stored = src.storedShell || '';
    if (stored === 'ios' || stored === 'android') return stored;
    const platform = src.capacitorPlatform || '';
    if (platform === 'ios') return 'ios';
    if (platform === 'android') return 'android';
    const referrer = src.referrer || '';
    if (referrer.indexOf('android-app://') === 0) return 'android';
    if (src.hasDigitalGoods) return 'android';
    return 'web';
  }

  // Store billing only inside the native shells. The public web checkout
  // stays off unless WEB_STRIPE_CHECKOUT_ENABLED is flipped on purpose.
  function shouldShowExternalCheckout(shell, webEnabled) {
    if (shell === 'ios' || shell === 'android') return false;
    return webEnabled === undefined ? WEB_STRIPE_CHECKOUT_ENABLED : !!webEnabled;
  }

  function androidProductAllowed(productId) {
    return ANDROID_PRODUCT_IDS.indexOf(productId) !== -1;
  }

  function normalizeAndroidPurchases(body) {
    const out = [];
    const seen = {};
    const list = body && Array.isArray(body.purchases) ? body.purchases : [];
    list.forEach(function (item) {
      if (!item || typeof item.token !== 'string') return;
      const token = item.token;
      if (!token || token.length > 2000 || !androidProductAllowed(item.productId)) return;
      const key = item.productId + ':' + token;
      if (seen[key]) return;
      seen[key] = true;
      out.push({ token: token, productId: item.productId });
    });
    const legacy = body && Array.isArray(body.purchaseTokens) ? body.purchaseTokens : [];
    legacy.forEach(function (token) {
      if (typeof token !== 'string' || !token || token.length > 2000) return;
      const key = 'pro_monthly:' + token;
      if (seen[key]) return;
      seen[key] = true;
      out.push({ token: token, productId: 'pro_monthly' });
    });
    return out.slice(0, 5);
  }

  function passwordAssessment(password) {
    const value = String(password || '');
    let score = 0;
    if (value.length >= 8) score += 1;
    if (value.length >= 12) score += 1;
    if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
    if (/[0-9]/.test(value)) score += 1;
    if (/[^A-Za-z0-9]/.test(value)) score += 1;
    const level = score >= 4 ? 'strong' : (score >= 2 ? 'ok' : 'weak');
    return { level: level, score: score };
  }

  function passwordStrengthError(password) {
    const value = String(password || '');
    if (value.length < 8) return 'too_short';
    if (value.length > 200) return 'too_long';
    if (COMMON_PASSWORDS.has(value.toLowerCase())) return 'too_common';
    return null;
  }

  function parseIsoDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return null;
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }

  function formatIsoDate(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function addIsoDays(iso, days) {
    const date = parseIsoDate(iso);
    if (!date) return iso;
    date.setUTCDate(date.getUTCDate() + days);
    return formatIsoDate(date);
  }

  function daysBetween(earlierIso, laterIso) {
    const a = parseIsoDate(earlierIso);
    const b = parseIsoDate(laterIso);
    if (!a || !b) return 0;
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }

  function workoutStreak(dateKeys, todayIso) {
    const set = {};
    (dateKeys || []).forEach(function (key) { if (key) set[key] = true; });
    let cursor = todayIso;
    if (!set[cursor]) {
      cursor = addIsoDays(todayIso, -1);
      if (!set[cursor]) return 0;
    }
    let count = 0;
    while (set[cursor] && count < 4000) {
      count += 1;
      cursor = addIsoDays(cursor, -1);
    }
    return count;
  }

  function weekStartIso(todayIso) {
    const date = parseIsoDate(todayIso);
    if (!date) return todayIso;
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - mondayOffset);
    return formatIsoDate(date);
  }

  function weeklyWorkoutCount(dateKeys, todayIso) {
    const start = weekStartIso(todayIso);
    const end = addIsoDays(start, 6);
    const seen = {};
    let count = 0;
    (dateKeys || []).forEach(function (key) {
      if (!key || seen[key]) return;
      if (key >= start && key <= end) { seen[key] = true; count += 1; }
    });
    return count;
  }

  function shouldPromptForReview(completedCount, lastPromptIso, todayIso) {
    if ((completedCount || 0) < REVIEW_MIN_WORKOUTS) return false;
    if (!lastPromptIso) return true;
    return daysBetween(lastPromptIso, todayIso) >= REVIEW_COOLDOWN_DAYS;
  }

  function dayKind(dayKey) {
    const key = String(dayKey || '').toLowerCase();
    if (key.indexOf('full') === 0) return 'full';
    if (key.indexOf('upper') === 0) return 'upper';
    if (key.indexOf('lower') === 0) return 'lower';
    if (key.indexOf('push') === 0) return 'push';
    if (key.indexOf('pull') === 0) return 'pull';
    if (key.indexOf('leg') === 0) return 'legs';
    return 'unknown';
  }

  const ALLOWED_CATS = {
    full: ['chest', 'back', 'shoulders', 'arms', 'legs', 'core'],
    upper: ['chest', 'back', 'shoulders', 'arms', 'core'],
    lower: ['legs', 'core'],
    push: ['chest', 'shoulders', 'arms', 'core'],
    pull: ['back', 'arms', 'core'],
    legs: ['legs', 'core'],
    unknown: ['chest', 'back', 'shoulders', 'arms', 'legs', 'core']
  };

  function sessionMax(profile) {
    const src = profile && profile.profile ? profile.profile : profile;
    const beginner = src && src.experience === 'beginner';
    const home = src && src.trainingLocation === 'home';
    if (beginner || home) return 4;
    return 5;
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function normalizeDose(ex) {
    const cat = ex.cat || 'core';
    const compound = cat === 'chest' || cat === 'back' || cat === 'legs';
    const sets = clamp(Number(ex.sets) || 3, 2, 5);
    let rest = Number(ex.rest) || (compound ? 120 : 60);
    rest = compound ? clamp(rest, 90, 180) : clamp(rest, 45, 90);
    return Object.assign({}, ex, { sets: sets, rest: rest });
  }

  function hasCat(list, cat) {
    return list.some(function (ex) { return ex.cat === cat; });
  }

  function repairSession(exercises, options) {
    const opts = options || {};
    const kind = opts.kind || dayKind(opts.dayKey);
    const max = opts.max || sessionMax(opts);
    const allowed = ALLOWED_CATS[kind] || ALLOWED_CATS.unknown;
    const issues = [];
    const original = (exercises || []).map(function (ex) { return Object.assign({}, ex); });
    if (original.length > max) issues.push('too_many_exercises');
    let list = original.filter(function (ex) { return allowed.indexOf(ex.cat) !== -1; });
    if (list.length !== original.length) issues.push('forbidden_pairing');
    if (kind !== 'full' && hasCat(list, 'chest') && hasCat(list, 'legs')) {
      list = list.filter(function (ex) { return ex.cat !== 'legs'; });
      issues.push('chest_and_legs');
    }
    list = list.map(normalizeDose);
    if (kind === 'full') list = orderFullBody(list);
    if (list.length > max) list = list.slice(0, max);
    if (kind === 'full') {
      if (!hasCat(list, 'legs')) issues.push('missing_legs');
      if (!hasCat(list, 'chest') && !hasCat(list, 'back')) issues.push('missing_upper');
    } else if (kind === 'upper' || kind === 'push' || kind === 'pull') {
      if (!hasCat(list, 'chest') && !hasCat(list, 'back') && !hasCat(list, 'shoulders')) issues.push('missing_upper');
    } else if (kind === 'lower' || kind === 'legs') {
      if (!hasCat(list, 'legs')) issues.push('missing_legs');
    }
    if (list.length > 5) issues.push('still_over_cap');
    return {
      exercises: list,
      issues: issues,
      changed: list.map(function (ex) { return ex.id; }).join('|') !== original.map(function (ex) { return ex.id; }).join('|')
        || list.some(function (ex, i) { return !original[i] || original[i].sets !== ex.sets || original[i].rest !== ex.rest; })
    };
  }

  function orderFullBody(list) {
    const legs = list.filter(function (ex) { return ex.cat === 'legs'; })[0];
    const upper = list.filter(function (ex) { return ex.cat === 'chest' || ex.cat === 'back'; })[0];
    const picked = {};
    const ordered = [];
    [legs, upper].forEach(function (ex) {
      if (ex && !picked[ex.id]) { picked[ex.id] = true; ordered.push(ex); }
    });
    list.forEach(function (ex) {
      if (!picked[ex.id]) { picked[ex.id] = true; ordered.push(ex); }
    });
    return ordered;
  }

  function weeklyVolume(days) {
    const vol = { chest: 0, back: 0, shoulders: 0, arms: 0, legs: 0, core: 0 };
    const map = days || {};
    Object.keys(map).forEach(function (key) {
      const day = map[key] || {};
      (day.exercises || []).forEach(function (ex) {
        if (!Object.prototype.hasOwnProperty.call(vol, ex.cat)) return;
        vol[ex.cat] += Number(ex.sets) || 0;
      });
    });
    return vol;
  }

  function volumeIssues(vol) {
    const issues = [];
    Object.keys(vol || {}).forEach(function (muscle) {
      if (vol[muscle] > 22) issues.push({ muscle: muscle, sets: vol[muscle], problem: 'too_high' });
    });
    return issues;
  }

  const PROTEIN_PER_KG = { fat_loss: 2.0, recomp: 1.8, muscle_gain: 1.8, maintenance: 1.6 };

  function computeNutritionTargets(p) {
    const sex = p && p.sex === 'female' ? 'female' : 'male';
    const weight = Number(p && p.weightKg) || 0;
    const height = Number(p && p.heightCm) || 0;
    const age = Number(p && p.age) || 0;
    const bmr = sex === 'female'
      ? (10 * weight + 6.25 * height - 5 * age - 161)
      : (10 * weight + 6.25 * height - 5 * age + 5);
    const activityMul = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 }[p && p.activityLevel] || 1.375;
    const tdee = bmr * activityMul;
    const goal = (p && p.goal) || 'maintenance';
    let kcal = tdee;
    if (goal === 'fat_loss') kcal -= Math.min(500, tdee * 0.2);
    else if (goal === 'recomp') kcal -= Math.min(250, tdee * 0.1);
    else if (goal === 'muscle_gain') kcal += Math.min(300, tdee * 0.1);
    const floor = sex === 'female' ? 1400 : 1600;
    kcal = Math.max(floor, Math.round(kcal / 10) * 10);
    const perKg = PROTEIN_PER_KG[goal] || 1.8;
    let protein = Math.round(perKg * weight);
    const proteinLo = Math.round(1.6 * weight);
    const proteinHi = Math.round(2.2 * weight);
    protein = clamp(protein, proteinLo, proteinHi);
    let fat = Math.round((kcal * 0.25) / 9);
    const fatLo = Math.round((kcal * 0.2) / 9);
    const fatHi = Math.round((kcal * 0.35) / 9);
    fat = clamp(fat, fatLo, fatHi);
    let carbs = Math.round((kcal - protein * 4 - fat * 9) / 4);
    if (carbs < 0) {
      fat = Math.max(fatLo, fat + Math.floor(carbs * 4 / 9));
      carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
    }
    return {
      kcal: kcal,
      protein: protein,
      fat: fat,
      carbs: carbs,
      floor: floor,
      tdee: Math.round(tdee),
      proteinPerKg: weight ? Math.round((protein / weight) * 100) / 100 : perKg
    };
  }

  function clampNutritionTargets(targets, profile) {
    const next = Object.assign({}, targets || {});
    const weight = Number(profile && profile.weightKg) || 0;
    if (weight >= 30 && next.protein !== undefined) {
      const lo = Math.round(1.6 * weight);
      const hi = Math.round(2.2 * weight);
      const protein = Number(next.protein);
      if (!isNaN(protein)) next.protein = clamp(Math.round(protein), lo, hi);
    }
    const sex = profile && profile.sex === 'female' ? 'female' : 'male';
    const floor = sex === 'female' ? 1400 : 1600;
    if (next.kcal !== undefined) {
      const kcal = Number(next.kcal);
      if (!isNaN(kcal)) next.kcal = clamp(Math.round(kcal), floor, 6000);
    }
    return next;
  }

  function progressShareText(lang, name, streak, done, target) {
    const who = name ? name : (lang === 'el' ? 'Εγώ' : 'I');
    if (lang === 'el') {
      return who + ' στο AI Coach: σειρά ' + streak + ' ημερών, ' + done + '/' + target + ' προπονήσεις αυτή την εβδομάδα.';
    }
    return who + ' on AI Coach: ' + streak + '-day streak, ' + done + '/' + target + ' workouts this week.';
  }

  const PROGRAMMING_RULES = [
    'PROGRAMMING STANDARD (certified-coach defaults, not a medical prescription):',
    'Choose the split from days per week and level: 1-3 days full body; 4-5 days upper/lower; 6-7 days push/pull/legs. A body-part bro split is only appropriate for an advanced lifter training 5+ days. Never put chest and legs on the same day except a full-body day. Do not pair a heavy push with legs.',
    'Each session has at most 5 exercises. Beginners and home/outdoor sessions have at most 4, and may have 3. Compounds first, then accessories. Major-muscle weekly sets should stay near 10-20; do not exceed about 22 hard sets for one muscle. Rest about 90-180s on compounds and 45-90s on accessories. Leave 1-3 reps in reserve. Progress load or reps when the top of the rep range is clean.',
    'Home programs use bodyweight, bands, a backpack, a park bar, or a chair only. If a beginner asks for 6-7 days, recommend 3-4 full-body days first and use six only if they insist. Start each plan with one short warm-up sentence. Say this is general coaching, not medical advice, and not a diagnosis for pain or injury.'
  ].join(' ');

  return {
    ANDROID_PRODUCT_IDS: ANDROID_PRODUCT_IDS,
    WEB_STRIPE_CHECKOUT_ENABLED: WEB_STRIPE_CHECKOUT_ENABLED,
    FREE_MONTHLY_MESSAGE_ALLOWANCE: FREE_MONTHLY_MESSAGE_ALLOWANCE,
    SHELL_STORAGE_KEY: SHELL_STORAGE_KEY,
    REVIEW_MIN_WORKOUTS: REVIEW_MIN_WORKOUTS,
    REVIEW_COOLDOWN_DAYS: REVIEW_COOLDOWN_DAYS,
    ANALYTICS_EVENTS: ANALYTICS_EVENTS,
    PROGRAMMING_RULES: PROGRAMMING_RULES,
    PROTEIN_PER_KG: PROTEIN_PER_KG,
    detectShell: detectShell,
    shouldShowExternalCheckout: shouldShowExternalCheckout,
    androidProductAllowed: androidProductAllowed,
    normalizeAndroidPurchases: normalizeAndroidPurchases,
    passwordAssessment: passwordAssessment,
    passwordStrengthError: passwordStrengthError,
    addIsoDays: addIsoDays,
    workoutStreak: workoutStreak,
    weekStartIso: weekStartIso,
    weeklyWorkoutCount: weeklyWorkoutCount,
    shouldPromptForReview: shouldPromptForReview,
    dayKind: dayKind,
    sessionMax: sessionMax,
    repairSession: repairSession,
    weeklyVolume: weeklyVolume,
    volumeIssues: volumeIssues,
    computeNutritionTargets: computeNutritionTargets,
    clampNutritionTargets: clampNutritionTargets,
    progressShareText: progressShareText
  };
});
