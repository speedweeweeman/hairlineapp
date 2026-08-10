# Hairline OS

**Track. Understand. Act.**

Hairline OS is a cross-platform mobile application for capturing standardized hairline scans, measuring visible changes over time, and turning those measurements into personalized progress insights. It combines a React Native client with a Python computer-vision service, cloud persistence, AI-generated future projections, habit tracking, and subscription-based premium features.

> Hairline OS is an educational tracking tool, not a medical device. Its analysis, projections, and treatment information are not diagnoses or substitutes for advice from a qualified healthcare professional.

## What it does

- Captures guided, front-facing hairline scans with a positioning overlay.
- Corrects phone image orientation and aligns scans using facial landmarks.
- Measures temple recession, left/right symmetry, and forehead-to-hairline position.
- Classifies each scan as stable, slight recession, or moderate recession.
- Provides a face-aligned before/after comparison with a draggable image divider.
- Generates personalized care plans from scan status, age, family history, and risk tolerance.
- Tracks treatment habits, daily completions, streaks, and weekly scan reminders.
- Combines scan history and 30-day habit consistency into progress trends and confidence scores.
- Creates photorealistic 3-, 6-, and 12-month projections for no-action, moderate-care, and aggressive-care scenarios.
- Supports watermarked sharing of generated projections.
- Gates premium functionality through RevenueCat subscriptions and purchase restoration.

## How it works

```text
Expo mobile app
    |
    |-- authentication, database, and image storage --> Supabase
    |
    `-- image-processing requests --> FastAPI service
                                      |-- MediaPipe facial landmarks
                                      |-- OpenCV normalization and metrics
                                      |-- Pillow image processing
                                      `-- Replicate image generation
```

1. The mobile app captures a scan and uploads the original image to Supabase Storage.
2. The FastAPI service applies EXIF correction, detects a face with MediaPipe, aligns the eyes, and crops the image into a consistent hairline view.
3. OpenCV extracts a smoothed hairline contour and calculates normalized recession, symmetry, and forehead metrics.
4. Results are written back to Supabase and used by the plan, comparison, habits, and progress experiences.
5. For Pro users, the normalized scan can be passed to an image-to-image model to generate independent future scenarios from the same baseline image.

## Tech stack

### Mobile

- React Native 0.81 and React 19
- Expo SDK 54 and Expo Router
- TypeScript
- Expo Camera, Notifications, File System, Sharing, and Haptics
- AsyncStorage for device-local preferences and generated plan state
- RevenueCat for subscriptions and entitlements

### Backend and computer vision

- Python 3.10–3.12
- FastAPI and Uvicorn
- MediaPipe Face Landmarker
- OpenCV, NumPy, and Pillow
- Replicate for image-to-image projections

### Data and infrastructure

- Supabase Authentication
- Supabase Postgres
- Supabase Storage

## Repository structure

```text
hairy/
├── app/                         # Expo Router screens and navigation
│   ├── (auth)/                  # Login and sign-up flows
│   ├── (tabs)/                  # Home, scan, gallery, plan, habits, progress
│   ├── scan/[id].tsx            # Normalization and hairline analysis
│   ├── compare.tsx              # Interactive before/after comparison
│   ├── projection.tsx           # AI projection timeline and sharing
│   └── paywall.tsx              # RevenueCat subscription UI
├── components/                  # Shared React Native components
├── constants/                   # Theme and service configuration
├── context/                     # Authentication and subscription providers
├── lib/supabase.ts              # Supabase mobile client
└── services/python/
    ├── main.py                  # FastAPI and computer-vision service
    ├── requirements.txt         # Python dependencies
    ├── start.sh                 # Local environment bootstrap
    └── face_landmarker.task     # MediaPipe face model
```

## Prerequisites

- Node.js 20 or newer
- npm
- Python 3.10, 3.11, or 3.12; MediaPipe is not expected to work with Python 3.13+
- A Supabase project
- An iOS simulator, Android emulator, or physical device
- A Replicate API token to use future projections
- A RevenueCat project and native Expo development build to test purchases

## Local setup

### 1. Install the mobile dependencies

```bash
git clone <repository-url>
cd hairy
npm install
```

### 2. Configure Supabase

The mobile Supabase URL and publishable key are currently declared in [`lib/supabase.ts`](./lib/supabase.ts). Replace them with the values from your Supabase project before running your own instance.

Create a **public** Storage bucket named `scans`. The current implementation uses public URLs so the mobile client, computer-vision service, and image-generation provider can retrieve scan images.

The application expects these database tables:

| Table | Required fields |
| --- | --- |
| `scans` | `id` UUID, `user_id` UUID, `image_url` text, `normalized_image_url` text nullable, `landmarks_json` JSONB nullable, `created_at` timestamptz, `type` text, `hairline_status` text nullable, `metrics_json` JSONB nullable |
| `habits` | `id` UUID, `user_id` UUID, `type` text, `completed_at` timestamptz |
| `projections` | `id` UUID, `user_id` UUID, `base_scan_id` UUID, `scenario` text, `timeframe` integer, `image_url` text, `created_at` timestamptz |

Enable email/password authentication and add Row Level Security policies that allow authenticated users to read and write only their own rows and storage objects. The Python service also needs permission to update scans and create projection records.

### 3. Configure the Python service

Create `services/python/.env`:

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-key
REPLICATE_API_TOKEN=your-replicate-token
```

`REPLICATE_API_TOKEN` is only required for the projection endpoint. Normalization, hairline analysis, plan generation, and progress analysis do not use it.

Start the service:

```bash
cd services/python
./start.sh
```

The script creates a virtual environment when needed, installs the Python dependencies, and starts Uvicorn at `http://0.0.0.0:8000`. You can verify it with:

```bash
curl http://localhost:8000/health
```

### 4. Configure the mobile environment

Create `.env` in the repository root:

```dotenv
EXPO_PUBLIC_PYTHON_SERVICE_URL=http://localhost:8000
EXPO_PUBLIC_REVENUECAT_IOS_KEY=your-revenuecat-ios-public-sdk-key
```

Choose a service URL that the app can reach:

- iOS Simulator: `http://localhost:8000`
- Android Emulator: `http://10.0.2.2:8000`
- Physical device: `http://<your-computer-lan-ip>:8000`

Your physical device and development machine must be on the same network. Restart Expo after changing an `EXPO_PUBLIC_` variable.

The RevenueCat key is optional for the free experience. In-app purchases use native modules and should be tested in an Expo development build or production build, not Expo Go.

### 5. Run the application

From the repository root:

```bash
npm start
```

Or launch a target directly:

```bash
npm run ios
npm run android
npm run web
```

Camera capture, notifications, sharing, and purchases have platform-specific behavior; iOS or Android is the primary development target.

## API endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Service health check |
| `POST` | `/normalize-image` | Correct orientation, align the face, crop the scan, and store landmarks |
| `POST` | `/analyze-hairline` | Calculate hairline metrics and update the scan record |
| `POST` | `/generate-plan` | Build a tiered care plan from the user's profile and latest scan |
| `POST` | `/generate-projection` | Generate and persist 3-, 6-, and 12-month scenario images |
| `POST` | `/watermark-image` | Prepare a branded projection image for sharing |
| `POST` | `/progress-analysis` | Calculate scan trends, habit consistency, and confidence |

Interactive API documentation is available at `http://localhost:8000/docs` while the service is running.

## Available scripts

| Command | Description |
| --- | --- |
| `npm start` | Start the Expo development server |
| `npm run ios` | Start Expo and open the iOS target |
| `npm run android` | Start Expo and open the Android target |
| `npm run web` | Start the web target |
| `npm run lint` | Run the Expo ESLint configuration |

## Projection pipeline

Each projection timeframe is generated independently from the same normalized scan. This prevents cumulative changes in crop, framing, facial structure, or lighting. Scenario-specific prompts and low image-to-image strengths aim to limit changes to the hairline and temple regions. The service retries rate-limited Replicate requests with increasing backoff, persists completed images in Supabase, and replaces stale results when a scenario is regenerated.

AI projections are illustrative simulations, not predictions of clinical outcomes.

## Development notes

- The first non-Pro account scan is free; additional scans and premium analysis flows are subscription-gated.
- Personalized plan input and the most recently generated plan are stored locally with AsyncStorage.
- Weekly reminders are scheduled locally through Expo Notifications.
- The MediaPipe model is downloaded automatically by the Python service if `face_landmarker.task` is absent.
- CORS is open during local development. Restrict allowed origins before exposing the API publicly.
- Replace development HTTP endpoints with HTTPS before a production release.

## License

No license has been specified for this repository. Unless a license is added, all rights are reserved by the project owner.
