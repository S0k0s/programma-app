# Coach examples (prompt contract, not a live model call)

These are before/after illustrations of the rules the app now enforces.
They are not transcripts from Anthropic. No API key was used and the Worker
was not deployed. The client repairs a plan after the model replies, and the
Worker adds the same programming standard to coach and onboarding prompts.
Food-photo replies stay JSON-only and do not get that addendum.

## 1. Beginner who asks for six days

Before: a six-day bro split with a chest day and a legs day that also includes bench, 7 exercises on Monday.

After: the coach recommends 3 full-body days first. A day the model still returns with 6 exercises is repaired to at most 4 for a beginner or home session. Compounds stay, isolation past the cap is dropped.

## 2. Chest and legs on a push day

Before:

- Bench press
- Squat
- Lateral raise
- Triceps pushdown
- Leg press
- Incline press
- Barbell row

After, day kind `push`: legs and back are removed, the list is capped at 5, bench stays first, sets are clamped to 2–5, compound rest is at least 90 seconds.

## 3. Weekly plan shape

Before: 4 training days, each a random mix (chest+legs, back+shoulders+legs, arms only, another chest+squat), 6–7 exercises.

After: 4 days map to upper / lower / upper / lower. Upper days do not include legs. Lower days do not include chest. Each day is at most 5 exercises (4 for a beginner or home). The prompt tells the model that a bro split is only for an advanced lifter on 5+ days.

## 4. Nutrition target

Before: a flat −500 kcal and protein at 2.2 g/kg for every goal, floor 1400 for everyone.

After, for a 60 kg woman, fat loss, sedentary: the deficit is the smaller of 500 kcal and 20% of estimated needs, calories do not go under 1400, protein is clamped to about 1.6–2.2 g/kg (the fat-loss default is 2.0 g/kg). A 80 kg man does not go under 1600 kcal. Meal suggestions stay Greek / Mediterranean with portions. The reply still says this is not medical advice and still cites the catalog.

## 5. Greek coach voice

Before: "Είσαι προσωπικός γυμναστής και διαιτολόγος" and stiff translated wording.

After: the coach is a general fitness coach, not a doctor or a dietitian. Greek replies use ordinary words (πρόγραμμα, προπόνηση, θερμίδες, πρωτεΐνη). Citations stay in the visible prose, not inside the JSON update block. Photo scans still return JSON only.
