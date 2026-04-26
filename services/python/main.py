import io
import math
import os
import urllib.request
from datetime import datetime, timedelta, timezone
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
    # Each step is applied to the OUTPUT of the previous step (chained generation).
    # Strengths are intentionally smaller than a single-pass approach would use.
    "no_action": {
        3:  ("slight temple recession beginning, hairline corners thinning", 0.22),
        6:  ("temples receding further, hairline corners higher than before", 0.20),
        12: ("significant temple recession, hairline clearly higher at corners", 0.24),
    },
    "moderate_care": {
        3:  ("hairline stabilising, slight new growth at temples, treatment starting", 0.13),
        6:  ("temple density improving, hairline maintaining, minoxidil working", 0.13),
        12: ("full temple coverage maintained, hairline density restored", 0.15),
    },
    "aggressive_care": {
        3:  ("early hair regrowth at temples, hairline beginning to improve", 0.12),
        6:  ("continued regrowth at temples, hairline visibly improving", 0.13),
        12: ("strong regrowth, temples recovering, hairline restored", 0.15),
    },
}


async def _generate_one(image_bytes: bytes, prompt: str, strength: float) -> bytes:
    output = await replicate.async_run(
        "lucataco/realvisxl-v2-img2img:47e54eff7b805b79428ffcb4a972d29bf68199e53fc626455d10b1f0cc57fbbc",
        input={
            "image": io.BytesIO(image_bytes),
            "prompt": prompt,
            "negative_prompt": _NEG_PROMPT,
            "strength": strength,
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
    M = cv2.getRotationMatrix2D(eye_mid, -angle, scale)
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

    supabase_client.table("scans").update(
        {"hairline_status": status, "metrics_json": metrics}
    ).eq("id", req.scan_id).execute()

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

    # Always fetch the latest scan image — prefer normalized so hairline baseline is aligned
    scan_res = supabase_client.table("scans").select("normalized_image_url, image_url").eq("id", req.scan_id).execute()
    if not scan_res.data:
        raise HTTPException(404, "Scan not found")

    image_url = scan_res.data[0].get("normalized_image_url") or scan_res.data[0].get("image_url")
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(image_url)
    if r.status_code != 200:
        raise HTTPException(400, "Failed to download scan image")

    # SDXL img2img rotates non-square inputs — pad to 512×512 square before generation.
    # The normalized image is 512×317 (landscape crop); padding bottom with neutral grey.
    raw = np.frombuffer(r.content, np.uint8)
    img_in = cv2.imdecode(raw, cv2.IMREAD_COLOR)
    if img_in is None:
        raise HTTPException(400, "Could not decode scan image")
    h_in, w_in = img_in.shape[:2]
    if h_in != w_in:
        side = max(h_in, w_in)
        padded = np.full((side, side, 3), 30, dtype=np.uint8)  # dark neutral background
        padded[:h_in, :w_in] = img_in
        ok, buf = cv2.imencode(".jpg", padded, [cv2.IMWRITE_JPEG_QUALITY, 92])
        if not ok:
            raise HTTPException(500, "Image pad failed")
        base_bytes = buf.tobytes()
    else:
        base_bytes = r.content

    # Chain generations: 3m from baseline → 6m from 3m output → 12m from 6m output.
    # This guarantees each timeframe is monotonically more/less than the previous.
    timeframes = [3, 6, 12]
    results: list[bytes] = []
    current_bytes = base_bytes

    try:
        for tf in timeframes:
            modifier, strength = _SCENARIOS[req.scenario][tf]
            result_bytes = await _generate_one(current_bytes, f"{_BASE_PROMPT}, {modifier}", strength)
            results.append(result_bytes)
            current_bytes = result_bytes
    except Exception as e:
        raise HTTPException(500, f"Image generation failed: {e}")

    # Delete any stale projections for this scan+scenario before writing fresh ones
    try:
        supabase_client.table("projections") \
            .delete() \
            .eq("base_scan_id", req.scan_id) \
            .eq("scenario", req.scenario) \
            .execute()
    except Exception:
        pass

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


_STATUS_RANK = {"stable": 0, "slight_recession": 1, "moderate": 2}


class ProgressRequest(BaseModel):
    user_id: str


@app.post("/progress-analysis")
async def progress_analysis(req: ProgressRequest):
    # Fetch all analyzed scans for the user, oldest first
    scans_res = supabase_client.table("scans") \
        .select("hairline_status, metrics_json, created_at") \
        .eq("user_id", req.user_id) \
        .not_.is_("hairline_status", "null") \
        .order("created_at", desc=False) \
        .execute()
    scans = scans_res.data or []

    # Fetch habit completions for the last 30 days
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    habits_res = supabase_client.table("habits") \
        .select("completed_at") \
        .eq("user_id", req.user_id) \
        .gte("completed_at", cutoff) \
        .execute()
    habit_rows = habits_res.data or []

    scan_count = len(scans)

    # Habit consistency: unique days with any completion in last 30 days
    habit_days = {r["completed_at"][:10] for r in habit_rows}
    habit_consistency = round(len(habit_days) / 30.0, 3)

    # Progress summary from scan trend
    if scan_count < 2:
        summary = "baseline"
        summary_label = "Establishing Baseline"
        metric_delta = 0.0
        trend = "neutral"
    else:
        first = scans[0]
        latest = scans[-1]
        first_rank = _STATUS_RANK.get(first["hairline_status"], 0)
        latest_rank = _STATUS_RANK.get(latest["hairline_status"], 0)

        # Use temple_depth delta if metrics available (lower = better)
        first_depth = (first.get("metrics_json") or {}).get("temple_depth", None)
        latest_depth = (latest.get("metrics_json") or {}).get("temple_depth", None)
        metric_delta = round(latest_depth - first_depth, 3) if (first_depth is not None and latest_depth is not None) else 0.0

        rank_delta = latest_rank - first_rank
        if rank_delta < 0 or metric_delta < -0.02:
            summary = "improvement"
            summary_label = "Improving"
            trend = "improving"
        elif rank_delta > 0 or metric_delta > 0.02:
            summary = "worsening"
            summary_label = "Watch Closely"
            trend = "worsening"
        else:
            summary = "no_change"
            summary_label = "Holding Steady"
            trend = "neutral"

    # Confidence score (0–100):
    # Habit consistency contributes up to 40 pts
    # Scan frequency (scans in 30 days / target 4) contributes up to 30 pts
    # Stable/improving trend contributes 30 pts
    cutoff_date = (datetime.now(timezone.utc) - timedelta(days=30)).date().isoformat()
    recent_scans_count = sum(1 for s in scans if s["created_at"][:10] >= cutoff_date)
    scan_freq_score = min(1.0, recent_scans_count / 4.0)
    trend_score = 1.0 if trend in ("improving", "neutral") else 0.0
    confidence_score = int(habit_consistency * 40 + scan_freq_score * 30 + trend_score * 30)

    # Build insight
    if scan_count == 0:
        insight = "Take your first scan to start tracking progress."
    elif scan_count < 2:
        insight = "Baseline established. Take scans weekly to start seeing your trend."
    elif summary == "improvement":
        insight = f"Your hairline metrics have improved across {scan_count} scans. Keep up your protocol."
    elif summary == "worsening":
        insight = f"Your metrics show some progression across {scan_count} scans. Consider stepping up your protocol."
    else:
        insight = f"Your hairline has held steady across {scan_count} scans. Consistency is working."

    if habit_consistency < 0.3 and scan_count > 0:
        insight += " Habit consistency is low — daily routines have the biggest impact over time."
    elif habit_consistency >= 0.7:
        insight += " Strong habit streak — this is what long-term results are built on."

    # Recent scan timeline (last 10)
    recent_scans = [
        {"date": s["created_at"][:10], "status": s["hairline_status"]}
        for s in scans[-10:]
    ]

    return {
        "summary": summary,
        "summary_label": summary_label,
        "confidence_score": confidence_score,
        "habit_consistency": habit_consistency,
        "scan_count": scan_count,
        "metric_delta": metric_delta,
        "trend": trend,
        "insight": insight,
        "recent_scans": recent_scans,
    }
