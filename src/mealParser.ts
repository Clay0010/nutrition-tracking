export type MacroTotals = {
  calories: number
  protein: number
  carbs: number
  fat: number
}

export type MealItem = {
  label: string
  name: string
  serving: string
  quantity: number
  calories: number
  protein: number
  carbs: number
  fat: number
}

export type MealEstimate = {
  items: MealItem[]
  totals: MacroTotals
}

const groqApiKey = import.meta.env.VITE_GROQ_API_KEY?.trim()

export const isGroqConfigured = Boolean(groqApiKey)

const round = (v: number) => Math.round(v * 10) / 10

const SYSTEM_PROMPT = `You are a precise nutrition database expert.
Analyze meal descriptions and return accurate nutrition data based on standard USDA values.
All macro values must be for the TOTAL quantity mentioned — not per 100g or per single serving.
Always return valid JSON only, no markdown, no explanations.`

const USER_PROMPT = (text: string) => `Analyze this meal and return a JSON object.

Rules:
- Split the meal into individual food items
- If no quantity is mentioned, assume 1 standard serving
- Calories must be realistic and non-zero for any real food
- All macros are for the full quantity the user described

Return this exact JSON structure:
{
  "items": [
    {
      "label": "exact phrase from input for this item",
      "name": "standard food name",
      "serving": "e.g. 1 large egg (50g)",
      "quantity": 1,
      "calories": 78,
      "protein": 6.3,
      "carbs": 0.6,
      "fat": 5.3
    }
  ],
  "totals": {
    "calories": 78,
    "protein": 6.3,
    "carbs": 0.6,
    "fat": 5.3
  }
}

Meal: "${text}"`

export async function estimateMealFromText(text: string): Promise<MealEstimate> {
  if (!groqApiKey) throw new Error('Groq API key is missing')

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${groqApiKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: USER_PROMPT(text) },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    const err = await response.text().catch(() => '')
    throw new Error(`Groq API failed (${response.status})${err ? `: ${err}` : ''}`)
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }

  const raw = data.choices?.[0]?.message?.content ?? ''
  if (!raw) throw new Error('Empty response from Groq')

  const parsed = JSON.parse(raw) as MealEstimate

  const items = parsed.items.map((item) => ({
    label: String(item.label ?? ''),
    name: String(item.name ?? ''),
    serving: String(item.serving ?? ''),
    quantity: Number(item.quantity) || 1,
    calories: round(Number(item.calories) || 0),
    protein: round(Number(item.protein) || 0),
    carbs: round(Number(item.carbs) || 0),
    fat: round(Number(item.fat) || 0),
  }))

  const totals = items.reduce<MacroTotals>(
    (acc, item) => ({
      calories: acc.calories + item.calories,
      protein: acc.protein + item.protein,
      carbs: acc.carbs + item.carbs,
      fat: acc.fat + item.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  )

  return {
    items,
    totals: {
      calories: round(totals.calories),
      protein: round(totals.protein),
      carbs: round(totals.carbs),
      fat: round(totals.fat),
    },
  }
}
