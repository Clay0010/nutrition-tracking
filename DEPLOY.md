**Free Production Deployment**

This app is set up for:
- `Vercel` for hosting the web app
- `Supabase` for database + authentication
- `USDA FoodData Central` for nutrition lookup

**1. Create Supabase Project**

1. Go to `https://supabase.com/dashboard/projects`
2. Create a new free project
3. Wait for the database to finish provisioning

**2. Create the Database Schema**

1. In Supabase, open `SQL Editor`
2. Copy the contents of [schema.sql](./supabase/schema.sql)
3. Run it

**3. Create Your User**

1. In Supabase, open `Authentication -> Users`
2. Create a user with your personal email and password
3. Use that same email/password to sign into the app

**4. Get Supabase Keys**

1. Open `Project Settings -> API`
2. Copy:
   - `Project URL`
   - `anon public` key

**5. USDA Key**

1. Go to `https://fdc.nal.usda.gov/api-guide`
2. Create a free `data.gov` API key

**6. Vercel Deployment**

1. Go to `https://vercel.com/new`
2. Import this project from GitHub or upload it through Vercel CLI
3. Set these environment variables in Vercel:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here
VITE_USDA_API_KEY=your_data_gov_key_here
```

4. Build command:
```bash
npm run build
```

5. Output directory:
```bash
dist
```

**7. Notes**

- Supabase Free pauses after inactivity, so the first request after a long idle period can be slower.
- Vercel Hobby is free.
- The USDA API key is free.
