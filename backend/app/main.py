import threading
import queue
import base64
import numpy as np
import cv2
from fastapi import FastAPI
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

# ── Shared Resources ──────────────────────────────────────────────────────
frame_queue_face = queue.Queue(maxsize=5)
frame_queue_yolo = queue.Queue(maxsize=5)
results = {}
results_lock = threading.Lock()

# ── Request Model ─────────────────────────────────────────────────────────
class FrameData(BaseModel):
    frame: str

# ── Thread Functions ──────────────────────────────────────────────────────
def thread_a_capture():
    pass

def thread_b_face():
    pass

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
    np_arr = np.frombuffer(img_bytes, np.uint8)
    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

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