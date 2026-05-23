import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import './App.css'
import {
  estimateMealFromText,
  isGroqConfigured,
  type MacroTotals,
  type MealItem,
} from './mealParser'
import { isSupabaseConfigured, supabase } from './supabase'

type Profile = {
  caloriesTarget: number
  proteinTarget: number
  carbsTarget: number
  fatTarget: number
}

type Entry = {
  id: string
  entry_date: string
  name: string
  serving: string
  quantity: number
  calories: number
  protein: number
  carbs: number
  fat: number
  note: string
  source: string
  created_at: string
}

type HistoryDay = {
  date: string
  calories: number
  protein: number
  carbs: number
  fat: number
  entryCount: number
}

type CustomFood = {
  id: string
  name: string
  serving: string
  category: string
  calories: number
  protein: number
  carbs: number
  fat: number
}

const today = new Date().toISOString().slice(0, 10)

const defaultProfile: Profile = {
  caloriesTarget: 2200,
  proteinTarget: 160,
  carbsTarget: 220,
  fatTarget: 70,
}

const zeroTotals: MacroTotals = {
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
}

const macroCards: Array<{
  key: keyof MacroTotals
  targetKey: keyof Profile
  label: string
  unit: string
  tone: string
}> = [
  { key: 'calories', targetKey: 'caloriesTarget', label: 'Calories', unit: 'kcal', tone: 'amber' },
  { key: 'protein', targetKey: 'proteinTarget', label: 'Protein', unit: 'g', tone: 'mint' },
  { key: 'carbs', targetKey: 'carbsTarget', label: 'Carbs', unit: 'g', tone: 'sky' },
  { key: 'fat', targetKey: 'fatTarget', label: 'Fat', unit: 'g', tone: 'rose' },
]

const formatDateLabel = (value: string) =>
  new Intl.DateTimeFormat('en', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${value}T12:00:00`))

const formatWhole = (value: number) => Math.round(value)

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [booting, setBooting] = useState(true)
  const [selectedDate, setSelectedDate] = useState(today)
  const [profile, setProfile] = useState<Profile>(defaultProfile)
  const [entries, setEntries] = useState<Entry[]>([])
  const [historyEntries, setHistoryEntries] = useState<Entry[]>([])
  const [customFoods, setCustomFoods] = useState<CustomFood[]>([])
  const [mealText, setMealText] = useState('')
  const [mealEstimate, setMealEstimate] = useState<{
    items: MealItem[]
    totals: MacroTotals
  } | null>(null)
  const [customFoodDraft, setCustomFoodDraft] = useState({
    name: '',
    serving: '',
    category: 'Home Snack',
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
  })
  const [currentPage, setCurrentPage] = useState<'today' | 'history' | 'foods' | 'settings'>('today')
  const [authForm, setAuthForm] = useState({ email: '', password: '' })
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin')
  const [signUpDone, setSignUpDone] = useState(false)
  const [loading, setLoading] = useState({
    auth: false,
    app: false,
    estimate: false,
    saveTargets: false,
    saveCustomFood: false,
  })
  const [error, setError] = useState<string | null>(null)

  const totals = useMemo(
    () =>
      entries.reduce<MacroTotals>(
        (acc, entry) => ({
          calories: acc.calories + entry.calories,
          protein: acc.protein + entry.protein,
          carbs: acc.carbs + entry.carbs,
          fat: acc.fat + entry.fat,
        }),
        zeroTotals,
      ),
    [entries],
  )

  const history = useMemo<HistoryDay[]>(() => {
    const map = new Map<string, HistoryDay>()

    for (const entry of historyEntries) {
      const current = map.get(entry.entry_date) ?? {
        date: entry.entry_date,
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        entryCount: 0,
      }

      current.calories += entry.calories
      current.protein += entry.protein
      current.carbs += entry.carbs
      current.fat += entry.fat
      current.entryCount += 1
      map.set(entry.entry_date, current)
    }

    return [...map.values()].sort((left, right) => right.date.localeCompare(left.date))
  }, [historyEntries])

  const recentDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(`${today}T12:00:00`)
      day.setDate(day.getDate() - index)
      const key = day.toISOString().slice(0, 10)
      const match = history.find((item) => item.date === key)

      return {
        date: key,
        calories: match?.calories ?? 0,
        entryCount: match?.entryCount ?? 0,
      }
    })
  }, [history])

  const weeklyAverage = useMemo(() => {
    const weekDates = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(`${today}T12:00:00`)
      day.setDate(day.getDate() - index)
      return day.toISOString().slice(0, 10)
    })

    const summary = weekDates.reduce(
      (acc, date) => {
        const match = history.find((item) => item.date === date)
        acc.calories += match?.calories ?? 0
        acc.protein += match?.protein ?? 0
        acc.carbs += match?.carbs ?? 0
        acc.fat += match?.fat ?? 0
        acc.activeDays += match ? 1 : 0
        return acc
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0, activeDays: 0 },
    )

    return {
      calories: summary.calories / 7,
      protein: summary.protein / 7,
      carbs: summary.carbs / 7,
      fat: summary.fat / 7,
      activeDays: summary.activeDays,
    }
  }, [history])

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setBooting(false)
      return
    }

    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setBooting(false)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })

    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user || !supabase) return
    void bootstrapApp(session.user.id)
  }, [session, selectedDate])

  const bootstrapApp = async (userId: string) => {
    setLoading((current) => ({ ...current, app: true }))
    setError(null)

    try {
      await ensureProfile(userId)
      const [profileData, dateEntries, monthlyEntries, savedCustomFoods] = await Promise.all([
        loadProfile(userId),
        loadEntries(userId, selectedDate),
        loadHistoryEntries(userId),
        loadCustomFoods(userId),
      ])

      setProfile(profileData)
      setEntries(dateEntries)
      setHistoryEntries(monthlyEntries)
      setCustomFoods(savedCustomFoods)
    } catch (bootstrapError) {
      setError(
        bootstrapError instanceof Error ? bootstrapError.message : 'Failed to load the app',
      )
    } finally {
      setLoading((current) => ({ ...current, app: false }))
    }
  }

  const ensureProfile = async (userId: string) => {
    if (!supabase) return

    const { data } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()

    if (!data) {
      const { error: insertError } = await supabase.from('profiles').insert({
        user_id: userId,
        calories_target: defaultProfile.caloriesTarget,
        protein_target: defaultProfile.proteinTarget,
        carbs_target: defaultProfile.carbsTarget,
        fat_target: defaultProfile.fatTarget,
      })

      if (insertError) throw insertError
    }
  }

  const loadProfile = async (userId: string) => {
    if (!supabase) return defaultProfile

    const { data, error: queryError } = await supabase
      .from('profiles')
      .select('calories_target, protein_target, carbs_target, fat_target')
      .eq('user_id', userId)
      .single()

    if (queryError) throw queryError

    return {
      caloriesTarget: data.calories_target,
      proteinTarget: data.protein_target,
      carbsTarget: data.carbs_target,
      fatTarget: data.fat_target,
    }
  }

  const loadEntries = async (userId: string, date: string) => {
    if (!supabase) return []

    const { data, error: queryError } = await supabase
      .from('food_entries')
      .select('*')
      .eq('user_id', userId)
      .eq('entry_date', date)
      .order('created_at', { ascending: false })

    if (queryError) throw queryError
    return data as Entry[]
  }

  const loadHistoryEntries = async (userId: string) => {
    if (!supabase) return []

    const startDate = new Date(`${today}T12:00:00`)
    startDate.setDate(startDate.getDate() - 29)

    const { data, error: queryError } = await supabase
      .from('food_entries')
      .select('*')
      .eq('user_id', userId)
      .gte('entry_date', startDate.toISOString().slice(0, 10))
      .lte('entry_date', today)
      .order('entry_date', { ascending: false })

    if (queryError) throw queryError
    return data as Entry[]
  }

  const loadCustomFoods = async (userId: string) => {
    if (!supabase) return []

    const { data, error: queryError } = await supabase
      .from('custom_foods')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (queryError) throw queryError
    return data as CustomFood[]
  }

  const refreshData = async () => {
    if (!session?.user) return
    await bootstrapApp(session.user.id)
  }

  const handleSignIn = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase) return

    setLoading((current) => ({ ...current, auth: true }))
    setError(null)

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: authForm.email,
      password: authForm.password,
    })

    if (authError) {
      setError(authError.message)
    }

    setLoading((current) => ({ ...current, auth: false }))
  }

const handleSignUp = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase) return

    setLoading((current) => ({ ...current, auth: true }))
    setError(null)

    const { error: authError } = await supabase.auth.signUp({
      email: authForm.email,
      password: authForm.password,
    })

    if (authError) {
      setError(authError.message)
    } else {
      setSignUpDone(true)
    }

    setLoading((current) => ({ ...current, auth: false }))
  }

  const handleSignOut = async () => {
    if (!supabase) return
    await supabase.auth.signOut()
  }

  const updateTarget = async (key: keyof Profile, event: ChangeEvent<HTMLInputElement>) => {
    if (!supabase || !session?.user) return

    const nextValue = Number(event.target.value) || 0
    const nextProfile = { ...profile, [key]: nextValue }
    setProfile(nextProfile)
    setLoading((current) => ({ ...current, saveTargets: true }))

    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        calories_target: nextProfile.caloriesTarget,
        protein_target: nextProfile.proteinTarget,
        carbs_target: nextProfile.carbsTarget,
        fat_target: nextProfile.fatTarget,
      })
      .eq('user_id', session.user.id)

    if (updateError) {
      setError(updateError.message)
    }

    setLoading((current) => ({ ...current, saveTargets: false }))
  }

  const estimateMeal = async () => {
    if (!mealText.trim()) return
    setLoading((current) => ({ ...current, estimate: true }))
    setError(null)

    try {
      const data = await estimateMealFromText(mealText)
      setMealEstimate(data)
    } catch (estimateError) {
      setError(
        estimateError instanceof Error ? estimateError.message : 'Failed to estimate meal',
      )
    } finally {
      setLoading((current) => ({ ...current, estimate: false }))
    }
  }

  const saveEstimate = async () => {
    if (!supabase || !session?.user || !mealEstimate?.items.length) return

    const payload = mealEstimate.items.map((item) => ({
      user_id: session.user.id,
      entry_date: selectedDate,
      name: item.name,
      serving: item.serving,
      quantity: item.quantity,
      calories: item.calories,
      protein: item.protein,
      carbs: item.carbs,
      fat: item.fat,
      note: item.label,
      source: 'Groq AI',
      source_ref: '',
    }))

    const { error: insertError } = await supabase.from('food_entries').insert(payload)
    if (insertError) {
      setError(insertError.message)
      return
    }

    setMealEstimate(null)
    setMealText('')
    await refreshData()
  }

  const removeEntry = async (entryId: string) => {
    if (!supabase || !session?.user) return

    const { error: deleteError } = await supabase
      .from('food_entries')
      .delete()
      .eq('user_id', session.user.id)
      .eq('id', entryId)

    if (deleteError) {
      setError(deleteError.message)
      return
    }

    await refreshData()
  }

  const addCustomFood = async () => {
    if (!supabase || !session?.user) return
    setLoading((current) => ({ ...current, saveCustomFood: true }))

    const payload = {
      user_id: session.user.id,
      name: customFoodDraft.name.trim(),
      serving: customFoodDraft.serving.trim(),
      category: customFoodDraft.category.trim() || 'Homemade',
      calories: Number(customFoodDraft.calories) || 0,
      protein: Number(customFoodDraft.protein) || 0,
      carbs: Number(customFoodDraft.carbs) || 0,
      fat: Number(customFoodDraft.fat) || 0,
    }

    if (!payload.name || !payload.serving) {
      setError('Custom foods need a name and serving description')
      setLoading((current) => ({ ...current, saveCustomFood: false }))
      return
    }

    const { error: insertError } = await supabase.from('custom_foods').insert(payload)
    if (insertError) {
      setError(insertError.message)
      setLoading((current) => ({ ...current, saveCustomFood: false }))
      return
    }

    setCustomFoodDraft({
      name: '',
      serving: '',
      category: 'Home Snack',
      calories: '',
      protein: '',
      carbs: '',
      fat: '',
    })

    await refreshData()
    setLoading((current) => ({ ...current, saveCustomFood: false }))
  }

  const addCustomFoodEntry = async (food: CustomFood) => {
    if (!supabase || !session?.user) return

    const { error: insertError } = await supabase.from('food_entries').insert({
      user_id: session.user.id,
      entry_date: selectedDate,
      name: food.name,
      serving: food.serving,
      quantity: 1,
      calories: food.calories,
      protein: food.protein,
      carbs: food.carbs,
      fat: food.fat,
      note: '',
      source: `Custom ${food.category}`,
      source_ref: food.id,
    })

    if (insertError) {
      setError(insertError.message)
      return
    }

    await refreshData()
  }

  if (!isSupabaseConfigured) {
    return (
      <main className="app-shell">
        <section className="hero-panel">
          <div className="hero-copy">
            <p className="eyebrow">Atlas Nutrition</p>
            <h1>Almost ready — one step remaining.</h1>
            <p className="hero-text">
              Connect your Supabase project to enable authentication and data storage.
              Add the following environment variables and redeploy.
            </p>
          </div>
        </section>

        <section className="card setup-card stack">
          <div className="section-head">
            <div>
              <p className="section-label">Setup Required</p>
              <h2>Add your environment variables</h2>
            </div>
          </div>

          <div className="code-card">
            <pre>{`VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here
VITE_GROQ_API_KEY=your_groq_api_key_here`}</pre>
          </div>
        </section>
      </main>
    )
  }

  if (booting) {
    return (
      <main className="app-shell">
        <section className="hero-panel">
          <div className="hero-copy">
            <p className="eyebrow">Atlas Nutrition</p>
            <h1>Loading your nutrition data...</h1>
          </div>
        </section>
      </main>
    )
  }

  if (!session) {
    return (
      <main className="app-shell">
        <section className="hero-panel">
          <div className="hero-copy">
            <p className="eyebrow">Atlas Nutrition</p>
            <h1>Track what you eat. Reach your goals.</h1>
            <p className="hero-text">
              Log meals with AI, monitor your macros daily, and review your progress over time.
              Your data is securely stored and synced across devices.
            </p>
          </div>
        </section>

        <section className="card auth-card stack">
          <div className="section-head">
            <div>
              <p className="section-label">{authMode === 'signin' ? 'Sign In' : 'Create Account'}</p>
              <h2>{authMode === 'signin' ? 'Welcome back' : 'Get started for free'}</h2>
            </div>
            <span className="section-chip">{isGroqConfigured ? 'AI Ready' : 'AI Offline'}</span>
          </div>

          {error ? <section className="error-banner">{error}</section> : null}

          {signUpDone ? (
            <div className="callout-panel gradient-gold">
              <p>Account created! Check your email to confirm it, then sign in below.</p>
            </div>
          ) : (
            <form className="auth-form" onSubmit={authMode === 'signin' ? handleSignIn : handleSignUp}>
              <label>
                Email
                <input
                  type="email"
                  value={authForm.email}
                  onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))}
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={authForm.password}
                  onChange={(event) =>
                    setAuthForm((current) => ({ ...current, password: event.target.value }))
                  }
                  required
                  minLength={6}
                />
              </label>
              <button type="submit" className="primary-button cool">
                {loading.auth
                  ? authMode === 'signin' ? 'Signing in...' : 'Creating account...'
                  : authMode === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            </form>
          )}

<button
            type="button"
            className="ghost-button"
            onClick={() => {
              setAuthMode((current) => (current === 'signin' ? 'signup' : 'signin'))
              setError(null)
              setSignUpDone(false)
            }}
          >
            {authMode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">

      {/* TODAY */}
      {currentPage === 'today' && (
        <>
          <section className="hero-panel">
            <div className="hero-copy">
              <p className="eyebrow">Atlas Nutrition</p>
              <h1>Here's how your day is going.</h1>
            </div>
            <div className="hero-stats">
              <div className="hero-stat sunset">
                <span>Date</span>
                <strong>{formatDateLabel(selectedDate)}</strong>
              </div>
              <div className="hero-stat aurora">
                <span>Meals logged</span>
                <strong>{entries.length}</strong>
              </div>
              <div className="hero-stat prism">
                <span>Calories</span>
                <strong>{formatWhole(totals.calories)} kcal</strong>
              </div>
            </div>
          </section>

          <section className="card spotlight-card">
            <div className="spotlight-header">
              <div>
                <p className="section-label">Journal</p>
                <h2>{formatDateLabel(selectedDate)}</h2>
              </div>
              <input
                type="date"
                className="date-input"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
              />
            </div>
            <div className="recent-days">
              {recentDays.map((day) => (
                <button
                  key={day.date}
                  type="button"
                  className={selectedDate === day.date ? 'day-pill active' : 'day-pill'}
                  onClick={() => setSelectedDate(day.date)}
                >
                  <span>{formatDateLabel(day.date)}</span>
                  <strong>{formatWhole(day.calories)} kcal</strong>
                  <small>{day.entryCount} entries</small>
                </button>
              ))}
            </div>
          </section>

          <section className="macro-grid">
            {macroCards.map((macro) => {
              const total = totals[macro.key]
              const target = profile[macro.targetKey]
              const progress = target > 0 ? Math.min((total / target) * 100, 100) : 0
              return (
                <article key={macro.key} className={`card macro-card ${macro.tone}`}>
                  <p className="section-label">{macro.label}</p>
                  <div className="macro-value">
                    <strong>{formatWhole(total)}</strong>
                    <span>{macro.unit}</span>
                  </div>
                  <div className="meter">
                    <div className="meter-fill" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="meter-copy">Goal {formatWhole(target)} {macro.unit}</p>
                </article>
              )
            })}
          </section>

          {error ? <section className="error-banner">{error}</section> : null}

          <section className="page-sections">
            <article className="card vivid-card stack">
              <div className="section-head">
                <div>
                  <p className="section-label">AI Meal Parser</p>
                  <h2>Describe what you ate</h2>
                </div>
                <span className="section-chip">{loading.estimate ? 'Analyzing...' : 'AI Ready'}</span>
              </div>
              <textarea
                className="meal-input"
                value={mealText}
                onChange={(event) => setMealText(event.target.value)}
                placeholder="e.g. two scrambled eggs with toast — or — chicken burger and fries — or — bowl of oatmeal with a banana"
              />
              <div className="button-row">
                <button type="button" className="primary-button hot" onClick={estimateMeal}>
                  Analyze meal
                </button>
                {mealEstimate ? (
                  <button type="button" className="primary-button cool" onClick={saveEstimate}>
                    Log to {formatDateLabel(selectedDate)}
                  </button>
                ) : null}
              </div>
              {mealEstimate ? (
                <div className="estimate-card">
                  <div className="estimate-total">
                    <strong>{formatWhole(mealEstimate.totals.calories)} kcal</strong>
                    <span>
                      {formatWhole(mealEstimate.totals.protein)}P |{' '}
                      {formatWhole(mealEstimate.totals.carbs)}C |{' '}
                      {formatWhole(mealEstimate.totals.fat)}F
                    </span>
                  </div>
                  <div className="estimate-list">
                    {mealEstimate.items.map((item) => (
                      <div key={`${item.label}-${item.name}`} className="estimate-item">
                        <div>
                          <strong>{item.label}</strong>
                          <span>{item.name} | {item.quantity} x {item.serving}</span>
                        </div>
                        <small>{formatWhole(item.calories)} kcal | {formatWhole(item.protein)}P</small>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="callout-panel gradient-lilac">
                  <p>Describe your meal in plain English — AI will identify each food and estimate the macros automatically.</p>
                </div>
              )}
            </article>

            <article className="card glass-card stack">
              <div className="section-head">
                <div>
                  <p className="section-label">Today's Log</p>
                  <h2>Meals logged</h2>
                </div>
                <span className="section-chip strong">{loading.app ? 'Syncing...' : 'Synced'}</span>
              </div>
              <div className="log-list">
                {entries.length === 0 ? (
                  <div className="empty-state">No meals logged for this day yet.</div>
                ) : (
                  entries.map((entry) => (
                    <div key={entry.id} className="log-item">
                      <div className="log-main">
                        <div>
                          <strong>{entry.name}</strong>
                          <span>{entry.quantity} x {entry.serving}</span>
                          <p>{entry.source}</p>
                        </div>
                        <button type="button" className="ghost-button" onClick={() => removeEntry(entry.id)}>
                          Remove
                        </button>
                      </div>
                      <div className="log-macros">
                        <span>{formatWhole(entry.calories)} kcal</span>
                        <span>{formatWhole(entry.protein)}P</span>
                        <span>{formatWhole(entry.carbs)}C</span>
                        <span>{formatWhole(entry.fat)}F</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </article>
          </section>
        </>
      )}

      {/* HISTORY */}
      {currentPage === 'history' && (
        <>
          <div className="page-header">
            <p className="eyebrow">Atlas Nutrition</p>
            <h1>Progress</h1>
          </div>
          <section className="page-sections">
            <article className="card weekly-card stack">
              <div className="section-head">
                <div>
                  <p className="section-label">This Week</p>
                  <h2>7-day average</h2>
                </div>
                <span className="section-chip">
                  {weeklyAverage.activeDays} active day{weeklyAverage.activeDays === 1 ? '' : 's'}
                </span>
              </div>
              <div className="weekly-stats">
                <div className="weekly-stat amber">
                  <span>Calories</span>
                  <strong>{formatWhole(weeklyAverage.calories)}</strong>
                  <small>kcal / day</small>
                </div>
                <div className="weekly-stat mint">
                  <span>Protein</span>
                  <strong>{formatWhole(weeklyAverage.protein)}</strong>
                  <small>g / day</small>
                </div>
                <div className="weekly-stat sky">
                  <span>Carbs</span>
                  <strong>{formatWhole(weeklyAverage.carbs)}</strong>
                  <small>g / day</small>
                </div>
                <div className="weekly-stat rose">
                  <span>Fat</span>
                  <strong>{formatWhole(weeklyAverage.fat)}</strong>
                  <small>g / day</small>
                </div>
              </div>
            </article>

            <article className="card prismatic-card stack">
              <div className="section-head">
                <div>
                  <p className="section-label">Past 30 Days</p>
                  <h2>Daily calorie intake</h2>
                </div>
              </div>
              <div className="history-list">
                {history.length === 0 ? (
                  <div className="empty-state">No entries in the last 30 days. Start logging meals to see your progress here.</div>
                ) : (
                  history.map((day) => (
                    <div key={day.date} className="history-bar">
                      <div className="history-text">
                        <strong>{formatDateLabel(day.date)}</strong>
                        <span>{day.entryCount} entries</span>
                      </div>
                      <div className="history-meter">
                        <div
                          className="history-fill"
                          style={{ width: `${Math.min((day.calories / Math.max(profile.caloriesTarget, 1)) * 100, 100)}%` }}
                        />
                      </div>
                      <small>{formatWhole(day.calories)} kcal</small>
                    </div>
                  ))
                )}
              </div>
            </article>
          </section>
        </>
      )}

      {/* FOODS */}
      {currentPage === 'foods' && (
        <>
          <div className="page-header">
            <p className="eyebrow">Atlas Nutrition</p>
            <h1>My Foods</h1>
          </div>
          <section className="page-sections">
            <article className="card candy-card stack">
              <div className="section-head">
                <div>
                  <p className="section-label">Add Custom Food</p>
                  <h2>Save foods you eat regularly</h2>
                </div>
              </div>
              <div className="custom-grid">
                <label>Food name
                  <input type="text" value={customFoodDraft.name} onChange={(event) => setCustomFoodDraft((c) => ({ ...c, name: event.target.value }))} />
                </label>
                <label>Serving
                  <input type="text" value={customFoodDraft.serving} onChange={(event) => setCustomFoodDraft((c) => ({ ...c, serving: event.target.value }))} />
                </label>
                <label>Category
                  <input type="text" value={customFoodDraft.category} onChange={(event) => setCustomFoodDraft((c) => ({ ...c, category: event.target.value }))} />
                </label>
                <label>Calories
                  <input type="number" value={customFoodDraft.calories} onChange={(event) => setCustomFoodDraft((c) => ({ ...c, calories: event.target.value }))} />
                </label>
                <label>Protein
                  <input type="number" value={customFoodDraft.protein} onChange={(event) => setCustomFoodDraft((c) => ({ ...c, protein: event.target.value }))} />
                </label>
                <label>Carbs
                  <input type="number" value={customFoodDraft.carbs} onChange={(event) => setCustomFoodDraft((c) => ({ ...c, carbs: event.target.value }))} />
                </label>
                <label>Fat
                  <input type="number" value={customFoodDraft.fat} onChange={(event) => setCustomFoodDraft((c) => ({ ...c, fat: event.target.value }))} />
                </label>
              </div>
              <button type="button" className="primary-button berry" onClick={addCustomFood}>
                {loading.saveCustomFood ? 'Saving...' : 'Save custom food'}
              </button>
              {error ? <section className="error-banner">{error}</section> : null}
              <div className="custom-list">
                {customFoods.length > 0 ? (
                  customFoods.map((food) => (
                    <div key={food.id} className="custom-item">
                      <div>
                        <strong>{food.name}</strong>
                        <span>{food.category} | {food.serving}</span>
                      </div>
                      <button type="button" className="ghost-button" onClick={() => addCustomFoodEntry(food)}>
                        Log today
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="empty-state small">No custom foods saved yet. Add foods you eat regularly to log them instantly.</div>
                )}
              </div>
            </article>
          </section>
        </>
      )}

      {/* SETTINGS */}
      {currentPage === 'settings' && (
        <>
          <div className="page-header">
            <p className="eyebrow">Atlas Nutrition</p>
            <h1>Settings</h1>
          </div>
          <section className="page-sections">
            <article className="card settings-card stack">
              <div className="section-head">
                <div>
                  <p className="section-label">Daily Targets</p>
                  <h2>Nutrition goals</h2>
                </div>
                <span className="section-chip">{loading.saveTargets ? 'Saving...' : 'Saved'}</span>
              </div>
              <div className="targets-grid">
                <label>Calories
                  <input type="number" value={profile.caloriesTarget} onChange={(event) => void updateTarget('caloriesTarget', event)} />
                </label>
                <label>Protein (g)
                  <input type="number" value={profile.proteinTarget} onChange={(event) => void updateTarget('proteinTarget', event)} />
                </label>
                <label>Carbs (g)
                  <input type="number" value={profile.carbsTarget} onChange={(event) => void updateTarget('carbsTarget', event)} />
                </label>
                <label>Fat (g)
                  <input type="number" value={profile.fatTarget} onChange={(event) => void updateTarget('fatTarget', event)} />
                </label>
              </div>
            </article>

            <article className="card stack" style={{ padding: '22px' }}>
              <div className="section-head">
                <div>
                  <p className="section-label">Account</p>
                  <h2>{session.user.email}</h2>
                </div>
              </div>
              <button type="button" className="primary-button cool" onClick={handleSignOut}>
                Sign out
              </button>
            </article>
          </section>
        </>
      )}

      {/* BOTTOM NAV */}
      <nav className="bottom-nav">
        <button type="button" className={`nav-item${currentPage === 'today' ? ' active' : ''}`} onClick={() => setCurrentPage('today')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
          <span>Today</span>
        </button>
        <button type="button" className={`nav-item${currentPage === 'history' ? ' active' : ''}`} onClick={() => setCurrentPage('history')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10"/>
            <line x1="12" y1="20" x2="12" y2="4"/>
            <line x1="6" y1="20" x2="6" y2="14"/>
          </svg>
          <span>History</span>
        </button>
        <button type="button" className={`nav-item${currentPage === 'foods' ? ' active' : ''}`} onClick={() => setCurrentPage('foods')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/>
            <path d="M7 2v20"/>
            <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>
          </svg>
          <span>Foods</span>
        </button>
        <button type="button" className={`nav-item${currentPage === 'settings' ? ' active' : ''}`} onClick={() => setCurrentPage('settings')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          <span>Settings</span>
        </button>
      </nav>
    </main>
  )
}

export default App
