# Switching on the community library

The code for accounts, cloud saves and shared kits is already in the app. It stays hidden until `dist/config.js` has Supabase settings. These steps need your own accounts, so they're yours to do. It takes about 30 minutes, and everything is free.

Do it twice if you want to be careful: a **staging** project to test with, then a **live** project. Or use one project and test on it before announcing.

## 1. Create the Supabase project
1. Sign up at https://supabase.com, ideally with the YK.Hobby Google account.
2. **New project**:
   - **Name:** `runner-order`.
   - **Region:** Sydney (`ap-southeast-2`), or whichever is closest to most testers.
   - **Database password:** generate a strong one and save it in your password manager.
3. When the project is ready, open **SQL Editor → New query**.
4. Paste the whole of `supabase/migrations/20261029000000_community.sql` and click **Run**. You should see "Success. No rows returned".

## 2. Allow the website to sign people in
In **Authentication → URL Configuration**:
- **Site URL:** `https://ykhobby.github.io/runner-order/`
- **Redirect URLs:** add both:
  - `https://ykhobby.github.io/runner-order/`
  - `http://localhost:8093/` (for testing on your computer)

## 3. Sign-in emails (Resend)
Supabase's built-in email only sends a few messages an hour, so connect Resend:
1. Sign up at https://resend.com.
2. Verify a sending domain, or use their test domain while trying things out. Then create an **API key**.
3. In Supabase, go to **Project Settings → Authentication → SMTP Settings** and turn on custom SMTP:
   - **Host:** `smtp.resend.com`
   - **Port:** `465`
   - **Username:** `resend`
   - **Password:** your Resend API key
   - **Sender:** e.g. `Runner Order <login@your-domain>`
4. Optional: under **Authentication → Email Templates → Magic Link**, change the subject to "Your Runner Order sign-in link".

## 4. Continue with Google
1. Go to https://console.cloud.google.com and create a project called **Runner Order**.
2. **APIs & Services → OAuth consent screen:**
   - **User type:** External.
   - **App name:** Runner Order.
   - **Support email:** your email.
   - **Authorised domain:** `supabase.co`.
3. **Credentials → Create credentials → OAuth client ID:**
   - **Type:** Web application.
   - **Authorised redirect URI:** `https://<your-project-ref>.supabase.co/auth/v1/callback`. Supabase shows this exact address under **Authentication → Providers → Google**.
4. Copy the **Client ID** and **Client secret** into **Supabase → Authentication → Providers → Google**, and enable it.
5. Back on the consent screen, click **Publish app** so anyone can sign in, not just test users.

## 5. Connect the app
1. In **Supabase → Project Settings → API**, copy:
   - the **Project URL**;
   - the **anon public** key. This key is designed to be public; access is controlled by the rules in the migration.
2. Paste them into `dist/config.js` as `supabaseUrl` and `supabaseAnonKey`.
3. Never paste the **service_role** key anywhere in the app.

## 6. Make yourself an admin
Sign in on the site once, so your account exists. Then run this in the **SQL Editor**, with your email:

```sql
update public.profiles set is_admin = true
where id = (select id from auth.users where email = 'you@example.com');
```

Reload the site. **Admin** now appears in your account menu.

## 7. Test, then publish
- Run the app locally (preview server `runner-notes-qa`, port 8093) and walk through it:
  - sign in with an email link and with Google;
  - share a kit;
  - search for it from a signed-out window;
  - report it from three accounts and check it hides;
  - restore it from **Admin**.
- When happy, commit and push. GitHub Pages redeploys in about a minute.

## Good to know
- **Pausing:** free Supabase projects pause after a week with no visits. The first visit after that takes about a minute to wake it. The workbench keeps working regardless. Upgrading (about US$25/month) stops the pausing and adds daily backups.
- **Sign-in links** must be opened in the same browser that asked for them.
- **Database tests:** `sh tests/sql/run.sh` re-runs the access-rule tests against a throwaway local Postgres. It needs `brew install postgresql@17`.
