# 📸 Moment.AI

**Moment.AI** is a frictionless web application that analyzes a photo of a live moment (e.g., a concert, late-night drive, or rainy coffee shop window) and instantly converts its visual mood and aesthetic profile into a custom-tailored Spotify playlist.

Optimized for **Nikita Bier's 3-second time-to-value rule**, it uses an inverted onboarding flow to give users immediate playlist results before prompting them to connect their Spotify accounts.

---

## ✨ Features

*   **Visual Mood Analysis**: Ingests images and uses **Gemini 2.5 Flash** to extract environmental context, emotional vibes, dominant color palettes, and seed genres.
*   **Dynamic Spotify Search Engine**: Custom-tailored recommendations that combine parsed seed genres, custom user prompt directives, and visual emotional vibes with randomized offsets to generate fresh, unique tracklists.
*   **Instagram Story Share Card**: A client-side HTML5 Canvas generator that creates a premium `9:16` (1080x1920) shareable graphic containing the source image, parsed color palettes, custom vibe badges, and a referral link.
*   **Inverted Onboarding Flow**: Zero upfront login walls. Users upload a picture and see their aesthetic profile immediately. Spotify Authentication is requested only when they click "Save to Spotify".
*   **Native Previews with Volume Control**: Direct audio preview of tracks using native HTML5 audio controls with interactive volume sliders.
*   **Premium Visual Value Gate**: Blurs recommendations and displays a glassmorphic lockout overlay if the user is unauthenticated or has reached their free daily token generation limit.
*   **Security-First Architecture**: 100% parameter-parameter database queries (Prisma), signed cryptographic cookies, and safe CORS isolation policies.

---

## 🚀 Tech Stack

*   **Frontend**: Vanilla HTML5, CSS3 (curated dark mode, glassmorphism, responsive mobile-first layouts), and ES6 JavaScript.
*   **Backend**: Node.js, Express.js.
*   **Database**: Prisma ORM with SQLite (`database.db`).
*   **AI Integration**: Google Gen AI SDK (Gemini 2.5 Flash).
*   **Music Integration**: Spotify Web API.
*   **E2E Testing**: Playwright.

---

## 🛠️ Installation & Local Setup

### 1. Prerequisites
Ensure you have [Node.js](https://nodejs.org/) installed (v18+ recommended).

### 2. Clone and Install Dependencies
```bash
# Clone the repository
git clone https://github.com/tahaarif3/MomentAi.git
cd MomentAi

# Install packages
npm install
```

### 3. Setup Database
Initialize the SQLite database using Prisma:
```bash
npx prisma db push
```

### 4. Configuration (`.env`)
Create a `.env` file in the root directory and populate it with your API keys:
```env
PORT=3000
SESSION_SECRET=your_cookie_session_secret

# Gemini API Key (from Google AI Studio)
GEMINI_API_KEY=your_gemini_api_key

# Spotify Developer API (from Spotify Developer Dashboard)
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/auth/callback
```

### 5. Running the Application
```bash
# Start the production server
node src/server.js
```
The application will be accessible locally at **`http://127.0.0.1:3000`**.

---

## 🧪 Testing

The codebase includes E2E integration tests running on Playwright to verify the analysis pipeline, prompt steering, and authentication flows.

```bash
# Install Playwright browsers (first-time only)
npx playwright install

# Run the test suite
npx playwright test
```

---

## 🔒 Security Practices

*   **Secrets Isolation**: Local keys and database sessions are omitted from repository history via `.gitignore`.
*   **Token Rotation**: Reminders to regularly rotate Client Secrets and API Keys in your cloud providers.
*   **SQL Injection Prevention**: Parameterized queries enforced via Prisma Client.
