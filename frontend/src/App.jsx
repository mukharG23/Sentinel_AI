import { useEffect, useRef } from "react"
import { useWebcam } from "./hooks/useWebcam"

const BACKEND_URL = "http://127.0.0.1:8000"

function App() {
  const { videoRef, isActive, stop, start } = useWebcam()
  const canvasRef = useRef(null)
  const facesRef = useRef([])  // stores latest face boxes — updated by polling

  // ── Polling Loop: fetch results every 500ms ───────────────────────────
  useEffect(() => {
    if (!isActive) return

    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/results`)
        const data = await res.json()
        facesRef.current = data.faces || []
      } catch (err) {
        // backend down or slow — keep last known boxes
      }
    }, 500)

    return () => clearInterval(pollInterval)
  }, [isActive])

  // ── Drawing Loop: redraw canvas at 60 FPS ─────────────────────────────
  useEffect(() => {
    if (!isActive) return

    let animFrameId = null

    const draw = () => {
      const canvas = canvasRef.current
      const video = videoRef.current

      if (canvas && video) {
        const ctx = canvas.getContext("2d")

        // Match canvas size to video size
        canvas.width = video.videoWidth || 640
        canvas.height = video.videoHeight || 480

        // Clear previous frame's boxes
        ctx.clearRect(0, 0, canvas.width, canvas.height)

        // Draw each face box
        facesRef.current.forEach(face => {
          ctx.strokeStyle = "#00FF00"   // bright green
          ctx.lineWidth = 2
          ctx.strokeRect(face.x, face.y, face.width, face.height)

          // Label above the box
          ctx.fillStyle = "#00FF00"
          ctx.font = "14px Arial"
          ctx.fillText("Face", face.x, face.y - 5)
        })
      }

      animFrameId = requestAnimationFrame(draw)  // loop
    }

    animFrameId = requestAnimationFrame(draw)

    return () => cancelAnimationFrame(animFrameId)
  }, [isActive])

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <h1>SentinelAI</h1>

      {/* Video and Canvas stacked on top of each other */}
      <div style={{ position: "relative" }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          width={640}
          height={480}
          style={{ display: "block" }}
        />
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            pointerEvents: "none"  // clicks pass through canvas to video
          }}
        />
      </div>

      <br />
      {isActive
        ? <button onClick={()=>{
          facesRef.current=[]
          const canvas=canvasRef.current
          if (canvas){
            const ctx=canvas.getContext("2d")
            ctx.clearRect(0,0,canvas.width,canvas.height)
          }
          stop()
        }}>Stop Camera</button>
        : <button onClick={start}>Start Camera</button>
      }
    </div>
  )
}

export default App