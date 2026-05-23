import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import Database from 'better-sqlite3'
import { z } from 'zod'

const app = express()
const port = Number(process.env.PORT || 8787)

const rootDir = process.cwd()
const dataDir = path.join(rootDir, 'server', 'data')
fs.mkdirSync(dataDir, { recursive: true })

const db = new Database(path.join(dataDir, 'atlas-nutrition.db'))
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    calories_target REAL NOT NULL DEFAULT 2200,
    protein_target REAL NOT NULL DEFAULT 160,
    carbs_target REAL NOT NULL DEFAULT 220,
    fat_target REAL NOT NULL DEFAULT 70,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS food_entries (
    id TEXT PRIMARY KEY,
    entry_date TEXT NOT NULL,
    name TEXT NOT NULL,
    serving TEXT NOT NULL,
    quantity REAL NOT NULL,
    calories REAL NOT NULL,
    protein REAL NOT NULL,
    carbs REAL NOT NULL,
    fat REAL NOT NULL,
    note TEXT DEFAULT '',
    source TEXT NOT NULL,
    source_ref TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS custom_foods (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    serving TEXT NOT NULL,
    category TEXT NOT NULL,
    calories REAL NOT NULL,
    protein REAL NOT NULL,
    carbs REAL NOT NULL,
    fat REAL NOT NULL,
    created_at TEXT NOT NULL
  );
`)

db.prepare(
  `INSERT OR IGNORE INTO profile (id, calories_target, protein_target, carbs_target, fat_target)
   VALUES (1, 2200, 160, 220, 70)`,
).run()

app.use(express.json({ limit: '1mb' }))

const hasUsdaKey = () => Boolean(process.env.USDA_API_KEY)
const macroNumberMap = {
  calories: [1008],
  protein: [1003],
  carbs: [1005],
  fat: [1004],
}

const mealTextSchema = z.object({
  text: z.string().min(3),
})

const entrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().min(1),
  serving: z.string().min(1),
  quantity: z.number().positive(),
  calories: z.number().nonnegative(),
  protein: z.number().nonnegative(),
  carbs: z.number().nonnegative(),
  fat: z.number().nonnegative(),
  note: z.string().optional().default(''),
  source: z.string().min(1),
  sourceRef: z.string().optional().default(''),
})

const customFoodSchema = z.object({
  name: z.string().min(1),
  serving: z.string().min(1),
  category: z.string().min(1),
  calories: z.number().nonnegative(),
  protein: z.number().nonnegative(),
  carbs: z.number().nonnegative(),
  fat: z.number().nonnegative(),
})

const profileSchema = z.object({
  caloriesTarget: z.number().nonnegative(),
  proteinTarget: z.number().nonnegative(),
  carbsTarget: z.number().nonnegative(),
  fatTarget: z.number().nonnegative(),
})

const makeId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

const pickNutrientValue = (nutrients, ids) => {
  const match = nutrients.find((item) => {
    const nutrientId =
      item.nutrientId ??
      item.nutrient?.id ??
      item.nutrient?.number

    return ids.includes(Number(nutrientId))
  })

  const value = match?.value ?? match?.amount ?? 0
  return Number(value) || 0
}

const scaleMacros = (food, quantity = 1) => ({
  calories: round(food.calories * quantity),
  protein: round(food.protein * quantity),
  carbs: round(food.carbs * quantity),
  fat: round(food.fat * quantity),
})

const round = (value) => Math.round(value * 10) / 10

const servingWeightHints = [
  { test: /egg/, grams: 50 },
  { test: /banana/, grams: 118 },
  { test: /apple/, grams: 182 },
  { test: /bread|toast/, grams: 32 },
  { test: /yogurt/, grams: 170 },
  { test: /chicken/, grams: 120 },
  { test: /rice/, grams: 158, unit: 'cup' },
  { test: /oat/, grams: 80, unit: 'cup' },
  { test: /milk/, grams: 244, unit: 'cup' },
]

const estimateMultiplier = (item, food) => {
  const servingText = food.serving.toLowerCase()
  const combinedText = `${item.label} ${item.search_query} ${item.serving_hint}`.toLowerCase()

  for (const hint of servingWeightHints) {
    if (!hint.test.test(combinedText)) continue
    if (hint.unit && !combinedText.includes(hint.unit)) continue

    if (servingText.includes('100 g')) {
      return round((item.quantity * hint.grams) / 100)
    }
  }

  return item.quantity
}

const normalizeUsdaFood = (food) => {
  const nutrients = food.foodNutrients ?? []
  const servingSize = food.servingSize
  const servingUnit = food.servingSizeUnit || 'g'
  const servingLabel = servingSize
    ? `${servingSize} ${servingUnit}`
    : food.householdServingFullText || '100 g'

  return {
    id: String(food.fdcId),
    name: food.description,
    brand: food.brandOwner || '',
    category: food.foodCategory || (food.dataType ?? 'Food'),
    serving: servingLabel,
    dataType: food.dataType || 'Unknown',
    calories: round(pickNutrientValue(nutrients, macroNumberMap.calories)),
    protein: round(pickNutrientValue(nutrients, macroNumberMap.protein)),
    carbs: round(pickNutrientValue(nutrients, macroNumberMap.carbs)),
    fat: round(pickNutrientValue(nutrients, macroNumberMap.fat)),
  }
}

const fetchUsdaFoods = async (
  query,
  dataTypes = ['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded'],
) => {
  const apiKey = process.env.USDA_API_KEY
  if (!apiKey) {
    throw new Error('USDA_API_KEY is missing')
  }

  const response = await fetch(
    `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        pageSize: 12,
        dataType: dataTypes,
      }),
    },
  )

  if (!response.ok) {
    throw new Error(`USDA search failed with status ${response.status}`)
  }

  const data = await response.json()
  const normalized = (data.foods ?? []).map(normalizeUsdaFood)
  const queryTokens = query.toLowerCase().split(/\s+/).filter(Boolean)

  return normalized.sort((left, right) => {
    const leftText = `${left.name} ${left.category} ${left.dataType}`.toLowerCase()
    const rightText = `${right.name} ${right.category} ${right.dataType}`.toLowerCase()
    const leftScore = queryTokens.reduce(
      (score, token) => score + (leftText.includes(token) ? 1 : 0),
      0,
    )
    const rightScore = queryTokens.reduce(
      (score, token) => score + (rightText.includes(token) ? 1 : 0),
      0,
    )
    const leftPenalty = /(dried|powder|mix|formula|substitute)/.test(leftText) ? 2 : 0
    const rightPenalty = /(dried|powder|mix|formula|substitute)/.test(rightText) ? 2 : 0

    if (leftScore - leftPenalty !== rightScore - rightPenalty) {
      return rightScore - rightPenalty - (leftScore - leftPenalty)
    }
    if (left.dataType !== right.dataType) {
      const preferred = ['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded']
      return preferred.indexOf(left.dataType) - preferred.indexOf(right.dataType)
    }
    return left.name.localeCompare(right.name)
  })
}

const quantityWords = new Map([
  ['a', 1],
  ['an', 1],
  ['one', 1],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
  ['seven', 7],
  ['eight', 8],
  ['nine', 9],
  ['ten', 10],
  ['half', 0.5],
  ['quarter', 0.25],
])

const unitWords = new Set([
  'cup',
  'cups',
  'tbsp',
  'tablespoon',
  'tablespoons',
  'tsp',
  'teaspoon',
  'teaspoons',
  'gram',
  'grams',
  'g',
  'kg',
  'oz',
  'ounce',
  'ounces',
  'lb',
  'pound',
  'pounds',
  'slice',
  'slices',
  'piece',
  'pieces',
  'bowl',
  'bowls',
  'plate',
  'plates',
  'serving',
  'servings',
  'large',
  'medium',
  'small',
])

const noiseWords = new Set([
  'of',
  'with',
  'and',
  'plus',
  'some',
  'my',
  'the',
  'had',
  'ate',
  'for',
  'breakfast',
  'lunch',
  'dinner',
])

const parseLeadingQuantity = (text) => {
  const normalized = text.trim().toLowerCase()
  const numericMatch = normalized.match(/^(\d+(?:\.\d+)?)/)
  if (numericMatch) {
    return {
      quantity: Number(numericMatch[1]),
      remainder: normalized.slice(numericMatch[0].length).trim(),
    }
  }

  const fractionMatch = normalized.match(/^(\d+)\s*\/\s*(\d+)/)
  if (fractionMatch) {
    return {
      quantity: Number(fractionMatch[1]) / Number(fractionMatch[2]),
      remainder: normalized.slice(fractionMatch[0].length).trim(),
    }
  }

  const wordMatch = normalized.match(/^([a-z]+)/)
  if (wordMatch) {
    const mapped = quantityWords.get(wordMatch[1])
    if (mapped) {
      return {
        quantity: mapped,
        remainder: normalized.slice(wordMatch[0].length).trim(),
      }
    }
  }

  return { quantity: 1, remainder: normalized }
}

const parseMealTextFree = (text) => {
  const chunks = text
    .replace(/\s+/g, ' ')
    .split(/,|&|\band\b|\bplus\b/gi)
    .map((item) => item.trim())
    .filter(Boolean)

  const items = chunks.map((chunk) => {
    const { quantity, remainder } = parseLeadingQuantity(chunk)
    const tokens = remainder
      .split(/\s+/)
      .filter(Boolean)
      .filter((token) => !noiseWords.has(token))

    const cleanedTokens = tokens.filter((token, index) => {
      if (index === 0 && unitWords.has(token)) return false
      return true
    })

    let searchQuery = cleanedTokens
      .filter((token) => !unitWords.has(token))
      .join(' ')
      .trim()

    if (/^eggs?$/.test(searchQuery)) searchQuery = 'whole egg'
    if (/^banana(s)?$/.test(searchQuery)) searchQuery = 'banana raw'

    return {
      label: chunk.trim(),
      search_query: searchQuery || chunk.trim(),
      quantity: quantity > 0 ? quantity : 1,
      serving_hint: tokens.slice(0, 3).join(' ') || '1 serving',
    }
  })

  return {
    items: items.filter((item) => item.search_query.length > 0),
  }
}

const dailyTotalsSql = `
  SELECT
    entry_date AS date,
    ROUND(SUM(calories), 1) AS calories,
    ROUND(SUM(protein), 1) AS protein,
    ROUND(SUM(carbs), 1) AS carbs,
    ROUND(SUM(fat), 1) AS fat,
    COUNT(*) AS entryCount
  FROM food_entries
  WHERE entry_date BETWEEN ? AND ?
  GROUP BY entry_date
  ORDER BY entry_date DESC
`

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    usdaConfigured: hasUsdaKey(),
    mealParserMode: 'free',
  })
})

app.get('/api/profile', (_req, res) => {
  const profile = db.prepare('SELECT * FROM profile WHERE id = 1').get()
  res.json({
    caloriesTarget: profile.calories_target,
    proteinTarget: profile.protein_target,
    carbsTarget: profile.carbs_target,
    fatTarget: profile.fat_target,
  })
})

app.put('/api/profile', (req, res) => {
  const parsed = profileSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid profile payload' })
  }

  const values = parsed.data
  db.prepare(
    `UPDATE profile
     SET calories_target = ?, protein_target = ?, carbs_target = ?, fat_target = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
  ).run(
    values.caloriesTarget,
    values.proteinTarget,
    values.carbsTarget,
    values.fatTarget,
  )

  return res.json({ ok: true })
})

app.get('/api/entries', (req, res) => {
  const date = String(req.query.date || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'A valid date is required' })
  }

  const entries = db
    .prepare(
      `SELECT id, entry_date AS date, name, serving, quantity, calories, protein, carbs, fat, note, source, source_ref AS sourceRef, created_at AS createdAt
       FROM food_entries
       WHERE entry_date = ?
       ORDER BY created_at DESC`,
    )
    .all(date)

  return res.json(entries)
})

app.post('/api/entries', (req, res) => {
  const parsed = entrySchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid entry payload' })
  }

  const entry = parsed.data
  const id = makeId()
  db.prepare(
    `INSERT INTO food_entries (
      id, entry_date, name, serving, quantity, calories, protein, carbs, fat, note, source, source_ref, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    entry.date,
    entry.name,
    entry.serving,
    entry.quantity,
    round(entry.calories),
    round(entry.protein),
    round(entry.carbs),
    round(entry.fat),
    entry.note,
    entry.source,
    entry.sourceRef,
    new Date().toISOString(),
  )

  return res.status(201).json({ id })
})

app.post('/api/entries/bulk', (req, res) => {
  const parsed = z
    .object({
      entries: z.array(entrySchema).min(1),
    })
    .safeParse(req.body)

  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid entries payload' })
  }

  const insert = db.prepare(
    `INSERT INTO food_entries (
      id, entry_date, name, serving, quantity, calories, protein, carbs, fat, note, source, source_ref, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  const transaction = db.transaction((entries) => {
    for (const entry of entries) {
      insert.run(
        makeId(),
        entry.date,
        entry.name,
        entry.serving,
        entry.quantity,
        round(entry.calories),
        round(entry.protein),
        round(entry.carbs),
        round(entry.fat),
        entry.note,
        entry.source,
        entry.sourceRef,
        new Date().toISOString(),
      )
    }
  })

  transaction(parsed.data.entries)

  return res.status(201).json({ ok: true })
})

app.delete('/api/entries/:id', (req, res) => {
  db.prepare('DELETE FROM food_entries WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

app.get('/api/history', (req, res) => {
  const days = Math.max(7, Math.min(Number(req.query.days || 30), 120))
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(endDate.getDate() - (days - 1))

  const rows = db
    .prepare(dailyTotalsSql)
    .all(startDate.toISOString().slice(0, 10), endDate.toISOString().slice(0, 10))

  res.json(rows)
})

app.get('/api/custom-foods', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, name, serving, category, calories, protein, carbs, fat, created_at AS createdAt
       FROM custom_foods
       ORDER BY created_at DESC`,
    )
    .all()
  res.json(rows)
})

app.post('/api/custom-foods', (req, res) => {
  const parsed = customFoodSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid custom food payload' })
  }

  const food = parsed.data
  const id = makeId()
  db.prepare(
    `INSERT INTO custom_foods (id, name, serving, category, calories, protein, carbs, fat, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    food.name,
    food.serving,
    food.category,
    round(food.calories),
    round(food.protein),
    round(food.carbs),
    round(food.fat),
    new Date().toISOString(),
  )

  res.status(201).json({ id })
})

app.get('/api/foods/search', async (req, res) => {
  const query = String(req.query.q || '').trim()
  if (!query) {
    return res.json([])
  }

  if (!hasUsdaKey()) {
    return res.status(503).json({
      error:
        'USDA_API_KEY is not configured. Create a data.gov key and put it in the .env file.',
    })
  }

  try {
    const foods = await fetchUsdaFoods(query)
    return res.json(foods)
  } catch (error) {
    return res.status(502).json({ error: error.message })
  }
})

app.post('/api/ai/estimate', async (req, res) => {
  const parsed = mealTextSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Meal text is required' })
  }

  if (!hasUsdaKey()) {
    return res.status(503).json({
      error:
        'USDA_API_KEY is not configured. Add it to the .env file so meal items can be matched to real food data.',
    })
  }

  try {
    const meal = parseMealTextFree(parsed.data.text)
    const items = []

    for (const item of meal.items) {
      const matches = await fetchUsdaFoods(item.search_query, [
        'Foundation',
        'SR Legacy',
        'Survey (FNDDS)',
      ])
      const bestMatch = matches[0]

      if (!bestMatch) continue

      const multiplier = estimateMultiplier(item, bestMatch)
      const macros = scaleMacros(bestMatch, multiplier)
      items.push({
        label: item.label,
        searchQuery: item.search_query,
        quantity: round(item.quantity),
        multiplier,
        servingHint: item.serving_hint,
        match: bestMatch,
        macros,
      })
    }

    const totals = items.reduce(
      (acc, item) => {
        acc.calories += item.macros.calories
        acc.protein += item.macros.protein
        acc.carbs += item.macros.carbs
        acc.fat += item.macros.fat
        return acc
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    )

    return res.json({
      items,
      totals: {
        calories: round(totals.calories),
        protein: round(totals.protein),
        carbs: round(totals.carbs),
        fat: round(totals.fat),
      },
    })
  } catch (error) {
    return res.status(502).json({ error: error.message })
  }
})

app.listen(port, () => {
  console.log(`Atlas Nutrition API listening on http://localhost:${port}`)
})
