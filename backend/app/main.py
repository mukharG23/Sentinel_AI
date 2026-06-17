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
from datetime import datetime
from ultralytics import YOLO

#Centroid Tracker
class CentroidTracker:
    def __init__(self, max_disappeared=10, max_distance=50):
        self.next_id = 1
        self.objects = {}        # id -> centroid (x, y)
        self.disappeared = {}    # id -> frames since last matched
        self.max_disappeared = max_disappeared
        self.max_distance = max_distance

    def register(self, centroid):
        self.objects[self.next_id] = centroid
        self.disappeared[self.next_id] = 0
        self.next_id += 1

    def deregister(self, object_id):
        del self.objects[object_id]
        del self.disappeared[object_id]

    def update(self, input_centroids):
        if len(input_centroids) == 0:
            for object_id in list(self.disappeared.keys()):
                self.disappeared[object_id] += 1
                if self.disappeared[object_id] > self.max_disappeared:
                    self.deregister(object_id)
            return self.objects

        # No existing tracked objects — register all as new
        if len(self.objects) == 0:
            for centroid in input_centroids:
                self.register(centroid)
            return self.objects

        # Match existing objects to new centroids by closest distance
        object_ids = list(self.objects.keys())
        object_centroids = list(self.objects.values())

        used_input_indices = set()
        used_object_ids = set()

        # For each existing object, find the closest new centroid
        for object_id, object_centroid in zip(object_ids, object_centroids):
            best_distance = None
            best_idx = None

            for idx, input_centroid in enumerate(input_centroids):
                if idx in used_input_indices:
                    continue

                dist = np.sqrt(
                    (object_centroid[0] - input_centroid[0]) ** 2 +
                    (object_centroid[1] - input_centroid[1]) ** 2
                )

                if best_distance is None or dist < best_distance:
                    best_distance = dist
                    best_idx = idx

            if best_distance is not None and best_distance <= self.max_distance:
                self.objects[object_id] = input_centroids[best_idx]
                self.disappeared[object_id] = 0
                used_input_indices.add(best_idx)
                used_object_ids.add(object_id)

        # Any existing object not matched this frame → disappeared += 1
        for object_id in object_ids:
            if object_id not in used_object_ids:
                self.disappeared[object_id] += 1
                if self.disappeared[object_id] > self.max_disappeared:
                    self.deregister(object_id)

        # Any new centroid not matched to an existing object → register as new
        for idx, centroid in enumerate(input_centroids):
            if idx not in used_input_indices:
                self.register(centroid)

        return self.objects

app = FastAPI()

#CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

#Paths
KNOWN_FACES_PATH = "known_faces.json"
KNOWN_FACES_DIR  = "known_faces"
ATTENDANCE_DIR = "attendance"
ZONES_PATH = "zones.json"

frame_queue_face = queue.Queue(maxsize=5)
frame_queue_yolo = queue.Queue(maxsize=5)
results = {}
results_lock = threading.Lock()
attendance_lock = threading.Lock()

#Load Known Faces at Startup 
def load_known_faces():
    if not os.path.exists(KNOWN_FACES_PATH):
        return {}, [],[]
    with open(KNOWN_FACES_PATH, "r") as f:
        data = json.load(f)
    names = list(data.keys())
    embeddings = [np.array(v) for v in data.values()]
    return data, names, embeddings

known_faces_data, known_names, known_embeddings = load_known_faces()

def load_zones():
    if not os.path.exists(ZONES_PATH):
        return {}
    with open(ZONES_PATH, "r") as f:
        return json.load(f)

zones_data = load_zones()

#MediaPipe Setup
mp_face = mp.solutions.face_detection
face_detector = mp_face.FaceDetection(min_detection_confidence=0.6)
yolo_model = YOLO("yolov8n.pt")
person_tracker = CentroidTracker(max_disappeared=10, max_distance=50)

#Request Model
class FrameData(BaseModel):
    frame: str
class ZoneData(BaseModel):
    name: str
    x1: int
    y1: int
    x2: int
    y2: int

#Thread B: Face Detection
def get_attendance_filepath():
    today = datetime.now().strftime("%Y-%m-%d")
    return os.path.join(ATTENDANCE_DIR, f"attendance_{today}.json")
def update_attendance(name):
    filepath = get_attendance_filepath()
    now = datetime.now().strftime("%H:%M:%S")

    with attendance_lock:
        if os.path.exists(filepath):
            with open(filepath, "r") as f:
                data = json.load(f)
        else:
            data = {}

        if name not in data:
            data[name] = {"first_seen": now, "last_seen": now}
        else:
            data[name]["last_seen"] = now

        with open(filepath, "w") as f:
            json.dump(data, f, indent=2)

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
                    try:
                        safe_frame = np.ascontiguousarray(rgb_frame)
                        crop = safe_frame[y:y+bh, x:x+bw]
                        crop = np.ascontiguousarray(crop)

                        crop_h, crop_w = crop.shape[:2]
                        full_box_location = [(0, crop_w, crop_h, 0)]

                        encodings = face_recognition.face_encodings(
                            crop, known_face_locations=full_box_location
                        )

                    except Exception as e:
                        print(f"DEBUG: face_recognition failed - {e}")
                        encodings = []


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
                                update_attendance(name)

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

#Thread C: YOLO
def thread_c_yolo():
    frame_count = 0
    while True:
        try:
            frame=frame_queue_yolo.get(timeout=1)
        except queue.Empty:
            continue
        frame_count+=1
        if frame_count%5!=0:
            continue
        yolo_results=yolo_model(frame,verbose=False)
        objects=[]
        person_centroids=[]
        for box in yolo_results[0].boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            confidence = float(box.conf[0])
            class_id = int(box.cls[0])
            class_name = yolo_model.names[class_id]

            if confidence<0.6:
                continue
            obj_data={
                "x": int(x1),
                "y": int(y1),
                "width": int(x2 - x1),
                "height": int(y2 - y1),
                "label": class_name,
                "confidence": round(confidence, 2)
            }
            objects.append(obj_data)
            if class_name=="person":
                centroid_x=(x1 + x2) / 2
                centroid_y=(y1 + y2) / 2
                person_centroids.append((centroid_x, centroid_y))
        tracked = person_tracker.update(person_centroids)
        tracked_people = [
            {"id": obj_id, "centroid_x": centroid[0], "centroid_y": centroid[1]}
            for obj_id, centroid in tracked.items()
        ]
        zone_counts = {}
        for zone_name, zone in zones_data.items():
            count = 0
            for person in tracked_people:
                px, py = person["centroid_x"], person["centroid_y"]
                if zone["x1"] <= px <= zone["x2"] and zone["y1"] <= py <= zone["y2"]:
                    count += 1
            zone_counts[zone_name] = count
        with results_lock:
            results["objects"]=objects
            results["tracked_people"] = tracked_people
            results["zone_counts"] = zone_counts

#Start Threads on Startup 
@app.on_event("startup")
def start_threads():
    threading.Thread(target=thread_b_face, daemon=True).start()
    threading.Thread(target=thread_c_yolo, daemon=True).start()

#Endpoints
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

@app.get("/attendance")
def get_attendance():
    filepath = get_attendance_filepath()
    if not os.path.exists(filepath):
        return {}
    with attendance_lock:
        with open(filepath, "r") as f:
            return json.load(f)
        
@app.post("/zones")
async def save_zone(zone: ZoneData):
    global zones_data

    zones_data[zone.name] = {
        "x1": zone.x1, "y1": zone.y1,
        "x2": zone.x2, "y2": zone.y2
    }

    with open(ZONES_PATH, "w") as f:
        json.dump(zones_data, f, indent=2)

    return {"status": "ok", "message": f"Zone '{zone.name}' saved"}

@app.get("/zones")
def get_zones():
    return zones_data