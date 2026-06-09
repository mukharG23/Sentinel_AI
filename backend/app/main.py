import threading
import queue
from fastapi import FastAPI

# ── The App ──────────────────────────────────────────────────────────────
app = FastAPI()

# ── Shared Resources (the conveyor belts and whiteboard) ─────────────────
frame_queue_face = queue.Queue(maxsize=5)   # Thread A → Thread B
frame_queue_yolo = queue.Queue(maxsize=5)   # Thread A → Thread C
results = {}                                # Thread B and C write here
results_lock = threading.Lock()             # Protects results from race conditions

# ── Thread A: Frame Capture ───────────────────────────────────────────────
def thread_a_capture():
    """
    Receives frames from frontend and distributes to Thread B and C queues.
    Always running. Never blocked by AI inference.
    """
    pass  # We fill this in Week 1 Task 3 (Frame Receiver API)

# ── Thread B: Face Recognition ────────────────────────────────────────────
def thread_b_face():
    """
    Picks frames from frame_queue_face.
    Runs face detection + recognition.
    Writes results to results{} safely using results_lock.
    """
    pass  # We fill this in Week 3

# ── Thread C: YOLO Object Detection ──────────────────────────────────────
def thread_c_yolo():
    """
    Picks frames from frame_queue_yolo.
    Runs YOLOv8n inference every 5th frame.
    Writes results to results{} safely using results_lock.
    """
    pass  # We fill this in Week 5

# ── Start All Threads on Startup ─────────────────────────────────────────
@app.on_event("startup")
def start_threads():
    threading.Thread(target=thread_b_face, daemon=True).start()
    threading.Thread(target=thread_c_yolo, daemon=True).start()

# ── Test Endpoint ─────────────────────────────────────────────────────────
@app.get("/health")
def health_check():
    return {"status": "SentinelAI backend is running"}