import asyncio
import io
import math
import os
import urllib.request
from dotenv import load_dotenv
import httpx

load_dotenv()
import numpy as np
import cv2
import mediapipe as mp
import replicate
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://ogzwekwzpadussvthssw.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "sb_publishable_pJRqMr57af1eufD34V9KPw_HeLiU2XB")
OUTPUT_SIZE = 512
MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "face_landmarker.task")
MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"

if not os.path.exists(MODEL_PATH):
    print("Downloading face landmarker model...")
    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    print("Model downloaded.")

_detector = mp_vision.FaceLandmarker.create_from_options(
    mp_vision.FaceLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=MODEL_PATH),
        num_faces=1,
        min_face_detection_confidence=0.5,
    )
)

supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class NormalizeRequest(BaseModel):
    scan_id: str
    image_url: str


class AnalyzeRequest(BaseModel):
    scan_id: str
    image_url: str


class ProjectionRequest(BaseModel):
    scan_id: str
    scenario: str
    user_id: str


_BASE_PROMPT = (
    "realistic close-up photo of forehead and hairline, professional neutral lighting, "
    "natural background, photorealistic, high quality, same person"
)
_NEG_PROMPT = (
    "cartoon, illustration, drawing, anime, different person, jewelry, hat, glasses, "
    "makeup, distorted face, blurry, low quality"
)

_SCENARIOS: dict[str, dict[int, tuple[str, float]]] = {
    "no_action": {
        3:  ("receding hairline, temples thinning slightly, natural hair loss progression", 0.25),
        6:  ("receding hairline, temples thinning noticeably, natural hair loss progression", 0.38),
        12: ("significantly receded hairline, visible temple recession, natural hair loss", 0.52),
    },
    "moderate_care": {
        3:  ("maintained hairline, slight temple improvement, early minoxidil results", 0.18),
        6:  ("maintained hairline, improved temple density, minoxidil treatment progress", 0.25),
        12: ("improved hairline, fuller temples, successful minoxidil results", 0.32),
    },
    "aggressive_care": {
        3:  ("slightly improved hairline, early hair regrowth at temples", 0.15),
        6:  ("improved hairline, noticeable hair regrowth at temples, successful treatment", 0.22),
        12: ("fuller hairline, significant hair regrowth, successful treatment results", 0.30),
    },
}


async def _generate_one(image_bytes: bytes, prompt: str, strength: float) -> bytes:
    output = await replicate.async_run(
        "lucataco/sdxl-img2img",
        input={
            "image": io.BytesIO(image_bytes),
            "prompt": prompt,
            "negative_prompt": _NEG_PROMPT,
            "prompt_strength": strength,
            "num_inference_steps": 30,
            "guidance_scale": 7.5,
        },
    )
    url = str(output[0]) if isinstance(output, (list, tuple)) else str(output)
    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.get(url)
    if r.status_code != 200:
        raise RuntimeError(f"Failed to download generated image: {r.status_code}")
    return r.content


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/normalize-image")
async def normalize_image(req: NormalizeRequest):
    # Download image from Supabase public URL
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(req.image_url)
    if r.status_code != 200:
        raise HTTPException(400, f"Failed to download image: HTTP {r.status_code}")

    nparr = np.frombuffer(r.content, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Could not decode image")

    h, w = img.shape[:2]
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

    # Detect face landmarks
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(img_rgb))
    results = _detector.detect(mp_image)

    if not results.face_landmarks:
        raise HTTPException(422, "No face detected in image")

    lm = results.face_landmarks[0]

    # Compute eye centers using standard iris/eye contour landmarks
    LEFT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
    RIGHT_EYE = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]

    def eye_center(indices):
        xs = [lm[i].x * w for i in indices]
        ys = [lm[i].y * h for i in indices]
        return sum(xs) / len(xs), sum(ys) / len(ys)

    lx, ly = eye_center(LEFT_EYE)
    rx, ry = eye_center(RIGHT_EYE)

    # Roll angle from eye baseline
    angle = math.degrees(math.atan2(ry - ly, rx - lx))

    # Scale so eye distance = 28% of output width
    eye_dist = math.hypot(rx - lx, ry - ly)
    scale = (OUTPUT_SIZE * 0.28) / eye_dist

    eye_mid = ((lx + rx) / 2, (ly + ry) / 2)

    # Affine: rotate + scale around eye midpoint, then translate to output center
    M = cv2.getRotationMatrix2D(eye_mid, angle, scale)
    # Eyes should land at 52% down (leaves forehead + hairline above)
    M[0, 2] += OUTPUT_SIZE / 2 - eye_mid[0]
    M[1, 2] += OUTPUT_SIZE * 0.52 - eye_mid[1]

    aligned = cv2.warpAffine(img, M, (OUTPUT_SIZE, OUTPUT_SIZE))

    # Crop to hairline region: top 62% (forehead + just past eyes)
    crop_h = int(OUTPUT_SIZE * 0.62)
    cropped = aligned[:crop_h, :]

    # Encode as JPEG
    ok, buf = cv2.imencode(".jpg", cropped, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        raise HTTPException(500, "Image encode failed")

    # Remove any existing normalized file, then upload fresh
    file_path = f"normalized/{req.scan_id}.jpg"
    try:
        supabase_client.storage.from_("scans").remove([file_path])
    except Exception:
        pass

    try:
        supabase_client.storage.from_("scans").upload(
            path=file_path,
            file=buf.tobytes(),
            file_options={"content-type": "image/jpeg"},
        )
    except Exception as e:
        raise HTTPException(500, f"Storage upload failed: {e}")

    normalized_url = supabase_client.storage.from_("scans").get_public_url(file_path)

    # Store key landmarks (eyes, top of head, chin, sides)
    key_indices = [33, 133, 362, 263, 10, 152, 234, 454]
    landmarks_json = {
        str(i): {
            "x": round(lm[i].x, 4),
            "y": round(lm[i].y, 4),
            "z": round(lm[i].z, 4),
        }
        for i in key_indices
    }

    return {"normalized_image_url": normalized_url, "landmarks_json": landmarks_json}


def _detect_hairline(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (7, 7), 0)
    edges = cv2.Canny(blurred, 20, 60)

    search_h = int(h * 0.70)
    hairline_y = np.zeros(w, dtype=float)

    for x in range(w):
        pts = np.where(edges[:search_h, x] > 0)[0]
        if len(pts) > 0:
            hairline_y[x] = pts[-1] / h
        else:
            # fall back to first column pixel brighter than skin threshold
            light = np.where(blurred[:search_h, x] > 80)[0]
            hairline_y[x] = light[0] / h if len(light) > 0 else 0.20

    k = max(1, w // 12)
    return np.convolve(hairline_y, np.ones(k) / k, mode="same")


@app.post("/analyze-hairline")
async def analyze_hairline(req: AnalyzeRequest):
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(req.image_url)
    if r.status_code != 200:
        raise HTTPException(400, f"Failed to download image: HTTP {r.status_code}")

    nparr = np.frombuffer(r.content, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Could not decode image")

    w = img.shape[1]
    hairline = _detect_hairline(img)

    # center hairline y (middle 20% of width)
    cx1, cx2 = int(w * 0.40), int(w * 0.60)
    center_y = float(np.mean(hairline[cx1:cx2]))

    # temple hairline y (10-25% from each side)
    left_y = float(np.mean(hairline[int(w * 0.10):int(w * 0.25)]))
    right_y = float(np.mean(hairline[int(w * 0.75):int(w * 0.90)]))

    # Receded temples sit HIGHER in the image (smaller y) than the center hairline,
    # so recession = center_y - temple_y (positive when temples are above center).
    left_rec = max(0.0, center_y - left_y)
    right_rec = max(0.0, center_y - right_y)
    temple_depth = round((left_rec + right_rec) / 2.0, 3)

    # Use max(left, right) as denominator so equal recessions score 1.0 and
    # one-sided recession scores 0.0 (maximally asymmetric).
    denom = max(max(left_rec, right_rec), 1e-4)
    symmetry = round(max(0.0, 1.0 - abs(left_rec - right_rec) / denom), 2)
    # mean hairline y-position across width (higher = hairline sits lower = more forehead)
    forehead_ratio = round(float(np.mean(hairline)), 3)

    if temple_depth < 0.04:
        status, confidence = "stable", 0.85
    elif temple_depth < 0.12:
        status, confidence = "slight_recession", 0.80
    else:
        status, confidence = "moderate", 0.75

    metrics = {
        "temple_depth": temple_depth,
        "symmetry": symmetry,
        "forehead_ratio": forehead_ratio,
    }

    result = supabase_client.table("scans").update(
        {"hairline_status": status, "metrics_json": metrics}
    ).eq("id", req.scan_id).execute()
    if not result.data:
        raise HTTPException(500, "Failed to persist analysis result")

    return {"status": status, "confidence": round(confidence, 2), "metrics": metrics}


class PlanRequest(BaseModel):
    age: int
    family_history: bool
    risk_tolerance: str  # "low" | "medium" | "high"
    hairline_status: str | None = None  # "stable" | "slight_recession" | "moderate"


@app.post("/generate-plan")
async def generate_plan(req: PlanRequest):
    if req.risk_tolerance not in ("low", "medium", "high"):
        raise HTTPException(400, "risk_tolerance must be low, medium, or high")

    # Base level from hairline status
    base = {"stable": 1, "slight_recession": 2, "moderate": 3}.get(req.hairline_status or "stable", 1)

    # Risk tolerance shifts the recommendation
    if req.risk_tolerance == "high":
        base = min(3, base + 1)
    elif req.risk_tolerance == "low":
        base = max(1, base - 1)

    # Young age + family history is a meaningful risk factor
    if req.family_history and req.age < 40:
        base = min(3, base + 1)

    recommended_level = base
    urgency = {1: "low", 2: "moderate", 3: "high"}[recommended_level]

    # Build insight
    parts: list[str] = []
    if req.hairline_status == "stable":
        parts.append("your hairline is currently stable")
    elif req.hairline_status == "slight_recession":
        parts.append("early recession detected at your temples")
    elif req.hairline_status == "moderate":
        parts.append("your hairline shows moderate recession")
    else:
        parts.append("analyze a scan to sharpen this recommendation")

    if req.family_history and req.age < 40:
        parts.append("given your family history and age, starting now gives you the best window to act")
    elif req.family_history:
        parts.append("your family history makes consistent monitoring important")
    elif req.age < 30:
        parts.append("building a routine in your 20s sets you up for long-term results")

    insight = ". ".join(s[0].upper() + s[1:] for s in parts) + "."

    levels = [
        {
            "level": 1,
            "title": "Foundation",
            "subtitle": "Low commitment, daily habits",
            "active": True,
            "steps": [
                "Weekly scans to track changes over time",
                "Scalp massage 5 min/day to boost circulation",
                "Prioritize sleep and reduce chronic stress",
                "Protein-rich diet and consistent hydration",
            ],
        },
        {
            "level": 2,
            "title": "OTC Treatment",
            "subtitle": "Clinically proven, no prescription needed",
            "active": recommended_level >= 2,
            "steps": [
                "Minoxidil 5% topical — apply twice daily",
                "Ketoconazole shampoo 2–3× per week",
                "Biotin + Zinc supplements daily",
                "0.5mm derma-roller once per week alongside minoxidil",
            ],
        },
        {
            "level": 3,
            "title": "Advanced Protocol",
            "subtitle": "Medical options — consult a doctor first",
            "active": recommended_level >= 3,
            "steps": [
                "Schedule a consultation with a dermatologist or trichologist",
                "Discuss finasteride (oral or topical) with your doctor",
                "Explore PRP (platelet-rich plasma) therapy",
                "Hair transplant evaluation if recession continues after 12 months",
            ],
        },
    ]

    return {
        "recommended_level": recommended_level,
        "urgency": urgency,
        "levels": levels,
        "insight": insight,
    }


@app.post("/generate-projection")
async def generate_projection(req: ProjectionRequest):
    if req.scenario not in _SCENARIOS:
        raise HTTPException(400, f"Invalid scenario: {req.scenario}")

    if not os.environ.get("REPLICATE_API_TOKEN"):
        raise HTTPException(503, "REPLICATE_API_TOKEN not set on the server")

    # Return cached projections if all 3 timeframes already exist
    existing = (
        supabase_client.table("projections")
        .select("timeframe, image_url")
        .eq("base_scan_id", req.scan_id)
        .eq("scenario", req.scenario)
        .execute()
    )
    if existing.data and len(existing.data) == 3:
        return {"projections": [{"timeframe": r["timeframe"], "image_url": r["image_url"]} for r in existing.data]}

    # Fetch scan image
    scan = supabase_client.table("scans").select("normalized_image_url, image_url").eq("id", req.scan_id).single().execute()
    if not scan.data:
        raise HTTPException(404, "Scan not found")

    image_url = scan.data.get("normalized_image_url") or scan.data.get("image_url")
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(image_url)
    if r.status_code != 200:
        raise HTTPException(400, "Failed to download scan image")

    image_bytes = r.content

    # Generate all 3 timeframes in parallel
    timeframes = [3, 6, 12]
    tasks = []
    for tf in timeframes:
        modifier, strength = _SCENARIOS[req.scenario][tf]
        tasks.append(_generate_one(image_bytes, f"{_BASE_PROMPT}, {modifier}", strength))

    try:
        results = await asyncio.gather(*tasks)
    except Exception as e:
        raise HTTPException(500, f"Image generation failed: {e}")

    # Upload results and persist to DB
    projections = []
    for tf, img_bytes in zip(timeframes, results):
        file_path = f"projections/{req.scan_id}/{req.scenario}_{tf}.jpg"
        try:
            supabase_client.storage.from_("scans").remove([file_path])
        except Exception:
            pass
        try:
            supabase_client.storage.from_("scans").upload(
                path=file_path,
                file=img_bytes,
                file_options={"content-type": "image/jpeg"},
            )
        except Exception as e:
            raise HTTPException(500, f"Storage upload failed for {tf}m projection: {e}")
        pub_url = supabase_client.storage.from_("scans").get_public_url(file_path)
        insert_result = supabase_client.table("projections").insert({
            "user_id": req.user_id,
            "base_scan_id": req.scan_id,
            "scenario": req.scenario,
            "timeframe": tf,
            "image_url": pub_url,
        }).execute()
        if not insert_result.data:
            raise HTTPException(500, f"Failed to persist {tf}m projection to database")
        projections.append({"timeframe": tf, "image_url": pub_url})

    return {"projections": projections}
