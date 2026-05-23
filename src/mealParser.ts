export type MacroTotals = {
  calories: number
  protein: number
  carbs: number
  fat: number
}

export type FoodResult = {
  id: string
  name: string
  brand: string
  category: string
  serving: string
  dataType: string
  calories: number
  protein: number
  carbs: number
  fat: number
}

export type ParsedMealItem = {
  label: string
  searchQuery: string
  quantity: number
  multiplier: number
  servingHint: string
  match: FoodResult
  macros: MacroTotals
}

const usdaApiKey = import.meta.env.VITE_USDA_API_KEY?.trim()

const nutrientIds = {
  calories: [1008],
  protein: [1003],
  carbs: [1005],
  fat: [1004],
}

const quantityWords = new Map<string, number>([
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

const round = (value: number) => Math.round(value * 10) / 10

const pickNutrientValue = (nutrients: Array<Record<string, unknown>>, ids: number[]) => {
  const match = nutrients.find((item) => {
    const nutrientId =
      Number(item.nutrientId) ||
      Number((item.nutrient as { id?: number } | undefined)?.id) ||
      Number((item.nutrient as { number?: number } | undefined)?.number)

    return ids.includes(nutrientId)
  })

  return Number(match?.value ?? match?.amount ?? 0) || 0
}

const normalizeUsdaFood = (food: Record<string, unknown>): FoodResult => {
  const nutrients = (food.foodNutrients as Array<Record<string, unknown>> | undefined) ?? []
  const servingSize = food.servingSize as number | undefined
  const servingUnit = (food.servingSizeUnit as string | undefined) || 'g'
  const serving = servingSize
    ? `${servingSize} ${servingUnit}`
    : ((food.householdServingFullText as string | undefined) ?? '100 g')

  return {
    id: String(food.fdcId),
    name: String(food.description ?? 'Unknown food'),
    brand: String(food.brandOwner ?? ''),
    category: String(food.foodCategory ?? food.dataType ?? 'Food'),
    serving,
    dataType: String(food.dataType ?? 'Unknown'),
    calories: round(pickNutrientValue(nutrients, nutrientIds.calories)),
    protein: round(pickNutrientValue(nutrients, nutrientIds.protein)),
    carbs: round(pickNutrientValue(nutrients, nutrientIds.carbs)),
    fat: round(pickNutrientValue(nutrients, nutrientIds.fat)),
  }
}

const rankFoods = (query: string, foods: FoodResult[]) => {
  const queryTokens = query.toLowerCase().split(/\s+/).filter(Boolean)

  return [...foods].sort((left, right) => {
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

const scaleMacros = (food: FoodResult, quantity: number): MacroTotals => ({
  calories: round(food.calories * quantity),
  protein: round(food.protein * quantity),
  carbs: round(food.carbs * quantity),
  fat: round(food.fat * quantity),
})

const parseLeadingQuantity = (text: string) => {
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

const parseMealText = (text: string) => {
  const chunks = text
    .replace(/\s+/g, ' ')
    .split(/,|&|\band\b|\bplus\b/gi)
    .map((item) => item.trim())
    .filter(Boolean)

  return chunks
    .map((chunk) => {
      const { quantity, remainder } = parseLeadingQuantity(chunk)
      const tokens = remainder
        .split(/\s+/)
        .filter(Boolean)
        .filter((token) => !noiseWords.has(token))

      const cleanedTokens = tokens.filter((token, index) => !(index === 0 && unitWords.has(token)))

      let searchQuery = cleanedTokens
        .filter((token) => !unitWords.has(token))
        .join(' ')
        .trim()

      if (/^eggs?$/.test(searchQuery)) searchQuery = 'whole egg'
      if (/^banana(s)?$/.test(searchQuery)) searchQuery = 'banana raw'

      return {
        label: chunk,
        searchQuery: searchQuery || chunk,
        quantity: quantity > 0 ? quantity : 1,
        servingHint: tokens.slice(0, 3).join(' ') || '1 serving',
      }
    })
    .filter((item) => item.searchQuery.length > 0)
}

const estimateMultiplier = (
  item: { label: string; searchQuery: string; servingHint: string; quantity: number },
  food: FoodResult,
) => {
  const servingText = food.serving.toLowerCase()
  const combinedText = `${item.label} ${item.searchQuery} ${item.servingHint}`.toLowerCase()

  for (const hint of servingWeightHints) {
    if (!hint.test.test(combinedText)) continue
    if (hint.unit && !combinedText.includes(hint.unit)) continue

    if (servingText.includes('100 g')) {
      return round((item.quantity * hint.grams) / 100)
    }
  }

  return item.quantity
}

export const isUsdaConfigured = Boolean(usdaApiKey)

export async function searchUsdaFoods(
  query: string,
  dataTypes = ['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded'],
) {
  if (!usdaApiKey) {
    throw new Error('USDA API key is missing')
  }

  const params = new URLSearchParams({
    api_key: usdaApiKey,
    query,
    pageSize: '12',
  })

  dataTypes.forEach((type) => params.append('dataType', type))

  const response = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`USDA search failed with status ${response.status}`)
  }

  const data = (await response.json()) as { foods?: Array<Record<string, unknown>> }
  return rankFoods(query, (data.foods ?? []).map(normalizeUsdaFood))
}

export async function estimateMealFromText(text: string) {
  const parsedItems = parseMealText(text)
  const results: ParsedMealItem[] = []

  for (const item of parsedItems) {
    const matches = await searchUsdaFoods(item.searchQuery, [
      'Foundation',
      'SR Legacy',
      'Survey (FNDDS)',
    ])
    const bestMatch = matches[0]
    if (!bestMatch) continue

    const multiplier = estimateMultiplier(item, bestMatch)
    results.push({
      ...item,
      multiplier,
      match: bestMatch,
      macros: scaleMacros(bestMatch, multiplier),
    })
  }

  const totals = results.reduce<MacroTotals>(
    (acc, item) => ({
      calories: acc.calories + item.macros.calories,
      protein: acc.protein + item.macros.protein,
      carbs: acc.carbs + item.macros.carbs,
      fat: acc.fat + item.macros.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  )

  return {
    items: results,
    totals: {
      calories: round(totals.calories),
      protein: round(totals.protein),
      carbs: round(totals.carbs),
      fat: round(totals.fat),
    },
  }
}
