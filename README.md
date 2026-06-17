# OccuVision
Real-time workspace intelligence — face recognition, attendance, occupancy & scene understanding.

Stack: React + FastAPI + MediaPipe + YOLOv8n + Groq

## Known Compatibility Issues

- **numpy must be < 2.0** — dlib 19.24.1 is incompatible with numpy 2.x. 
  If you see `RuntimeError: Unsupported image type`, run:
  `pip install "numpy<2.0"`

- **dlib on Windows** — requires a prebuilt wheel. Install via:
  `pip install https://github.com/sachadee/Dlib/raw/main/dlib-19.24.1-cp311-cp311-win_amd64.whl`
  before running `pip install face_recognition`