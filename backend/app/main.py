import threading
import queue
import base64
import json
import os
import numpy as np
import cv2
import mediapipe as mp
import face_recognition
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

# ── CORS ──────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Paths ─────────────────────────────────────────────────────────────────
KNOWN_FACES_PATH = "known_faces.json"
KNOWN_FACES_DIR  = "known_faces"

# ── Shared Resources ──────────────────────────────────────────────────────
frame_queue_face = queue.Queue(maxsize=5)
frame_queue_yolo = queue.Queue(maxsize=5)
results = {}
results_lock = threading.Lock()

# ── Load Known Faces into RAM at Startup ──────────────────────────────────
def load_known_faces():
    if not os.path.exists(KNOWN_FACES_PATH):
        return {}, [],[]
    with open(KNOWN_FACES_PATH, "r") as f:
        data = json.load(f)
    names = list(data.keys())
    embeddings = [np.array(v) for v in data.values()]
    return data, names, embeddings

known_faces_data, known_names, known_embeddings = load_known_faces()

# ── MediaPipe Setup ───────────────────────────────────────────────────────
mp_face = mp.solutions.face_detection
face_detector = mp_face.FaceDetection(min_detection_confidence=0.6)

# ── Request Model ─────────────────────────────────────────────────────────
class FrameData(BaseModel):
    frame: str

# ── Thread B: Face Detection ──────────────────────────────────────────────
def thread_b_face():
    frame_count = 0
    consecutive_matches={}

    while True:
        try:
            frame = frame_queue_face.get(timeout=1)
        except queue.Empty:
            continue

        frame_count += 1
        if frame_count % 3 != 0:
            continue

        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        detection_results = face_detector.process(rgb_frame)

        boxes = []
        matched_names_this_frame =set()

        if detection_results.detections:
            h, w = frame.shape[:2]
            for detection in detection_results.detections:
                bbox = detection.location_data.relative_bounding_box
                x  = max(0, int(bbox.xmin * w))
                y  = max(0, int(bbox.ymin * h))
                bw = int(bbox.width * w)
                bh = int(bbox.height * h)
                bw=min(bw,w-x)
                bh=min(bh,h-y)
                name="Unknown"
                confirmed=False

                if known_embeddings and bw>0 and bh>0:
                    face_location=[(y,x+bw,y+bh,x)]
                    encodings=face_recognition.face_encodings(
                        rgb_frame, known_face_locations=face_location
                    )
                    if len(encodings) > 0:
                        face_embedding = encodings[0]

                        # Euclidean distance against every known embedding
                        distances = []
                        for known_emb in known_embeddings:
                            dist = np.linalg.norm(face_embedding - known_emb)
                            distances.append(dist)

                        best_idx = int(np.argmin(distances))
                        best_score = distances[best_idx]

                        if best_score < 0.6:
                            name = known_names[best_idx]
                            matched_names_this_frame.add(name)

                            consecutive_matches[name] = consecutive_matches.get(name, 0) + 1
                            if consecutive_matches[name] >= 3:
                                confirmed = True

                boxes.append({
                    "x": x, "y": y, "width": bw, "height": bh,
                    "name": name, "confirmed": confirmed
                })

        # Reset counters for names not matched this frame
        for name in list(consecutive_matches.keys()):
            if name not in matched_names_this_frame:
                consecutive_matches[name] = 0

        with results_lock:
            results["faces"] = boxes

# ── Thread C: YOLO (empty for now) ───────────────────────────────────────
def thread_c_yolo():
    pass

# ── Start Threads on Startup ──────────────────────────────────────────────
@app.on_event("startup")
def start_threads():
    threading.Thread(target=thread_b_face, daemon=True).start()
    threading.Thread(target=thread_c_yolo, daemon=True).start()

# ── Endpoints ─────────────────────────────────────────────────────────────
@app.get("/health")
def health_check():
    return {"status": "SentinelAI backend is running"}

@app.post("/frame")
def receive_frame(data: FrameData):
    try:
        header, encoded = data.frame.split(",", 1)
    except ValueError:
        return {"status": "error", "message": "Invalid frame format"}

    img_bytes = base64.b64decode(encoded)
    np_arr    = np.frombuffer(img_bytes, np.uint8)
    frame     = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

    if frame is None:
        return {"status": "error", "message": "Could not decode image"}

    try:
        frame_queue_face.put_nowait(frame)
    except queue.Full:
        pass

    try:
        frame_queue_yolo.put_nowait(frame)
    except queue.Full:
        pass

    return {"status": "ok"}

@app.get("/results")
def get_results():
    with results_lock:
        return dict(results)

@app.post("/register")
async def register_face(name: str = Form(...), file: UploadFile = File(...)):
    global known_faces_data, known_names, known_embeddings

    # Read uploaded image bytes
    contents = await file.read()

    # Use PIL to open image — handles PNG, JPG, RGBA all correctly
    from PIL import Image
    import io
    pil_img = Image.open(io.BytesIO(contents))

    # Convert to RGB — handles RGBA, grayscale, palette modes
    pil_img = pil_img.convert("RGB")

    # Convert PIL → numpy array (face_recognition expects this)
    rgb_img = np.array(pil_img)

    print(f"DEBUG: shape={rgb_img.shape}, dtype={rgb_img.dtype}")

    # Generate 128D embedding
    encodings = face_recognition.face_encodings(rgb_img)

    if len(encodings) == 0:
        return {"status": "error", "message": "No face detected in image"}

    if len(encodings) > 1:
        return {"status": "error", "message": "Multiple faces detected — use a photo with one face only"}

    embedding = encodings[0].tolist()

    # Save to known_faces.json
    known_faces_data[name] = embedding
    with open(KNOWN_FACES_PATH, "w") as f:
        f.write("{\n")
        items = list(known_faces_data.items())
        for i, (k, v) in enumerate(items):
            comma = "," if i < len(items) - 1 else ""
            f.write(f'  {json.dumps(k)}: {json.dumps(v)}{comma}\n')
        f.write("}\n")

    # Reload in-memory lists
    known_names      = list(known_faces_data.keys())
    known_embeddings = [np.array(v) for v in known_faces_data.values()]

    return {"status": "ok", "message": f"{name} registered successfully"}