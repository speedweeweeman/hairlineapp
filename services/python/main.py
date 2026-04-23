import math
import httpx
import numpy as np
import cv2
import mediapipe as mp
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client

SUPABASE_URL = "https://ogzwekwzpadussvthssw.supabase.co"
SUPABASE_KEY = "sb_publishable_pJRqMr57af1eufD34V9KPw_HeLiU2XB"
OUTPUT_SIZE = 512

supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
mp_face_mesh = mp.solutions.face_mesh

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
    with mp_face_mesh.FaceMesh(
        static_image_mode=True,
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.5,
    ) as face_mesh:
        results = face_mesh.process(img_rgb)

    if not results.multi_face_landmarks:
        raise HTTPException(422, "No face detected in image")

    lm = results.multi_face_landmarks[0].landmark

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

    left_rec = max(0.0, left_y - center_y)
    right_rec = max(0.0, right_y - center_y)
    temple_depth = round((left_rec + right_rec) / 2.0, 3)

    denom = max(left_rec + right_rec, 1e-4)
    symmetry = round(max(0.0, 1.0 - abs(left_rec - right_rec) / denom), 2)
    forehead_ratio = round(float(np.mean(hairline)), 3)

    if temple_depth < 0.06:
        status, confidence = "stable", 0.85
    elif temple_depth < 0.15:
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
