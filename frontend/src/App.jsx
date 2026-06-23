import { useEffect, useRef, useState } from "react"
import { useWebcam } from "./hooks/useWebcam"

const BACKEND_URL = "http://127.0.0.1:8000"

function App() {
  const { videoRef, isActive, stop, start } = useWebcam()
  const canvasRef = useRef(null)
  const facesRef = useRef([])
  const objectsRef = useRef([])
  const zoneCountsRef = useRef({})
  const dismissedAlertsRef = useRef(new Set())
  const [attendance, setAttendance] = useState({})
  const [isDrawing, setIsDrawing] = useState(false)
  const [drawStart, setDrawStart] = useState({ x: 0, y: 0 })
  const [drawCurrent, setDrawCurrent] = useState({ x: 0, y: 0 })
  const [zones, setZones] = useState({})
  const [alertsList, setAlertsList] = useState([])
  const [narration, setNarration] = useState("")

  useEffect(() => {
    if (!isActive) return
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/results`)
        const data = await res.json()
        facesRef.current = data.faces || []
        objectsRef.current = data.objects || []
        zoneCountsRef.current = data.zone_counts || {}
        setAlertsList(
          (data.alerts || []).filter(
            alert => !dismissedAlertsRef.current.has(alert.timestamp)
          )
        )
        if (data.narration) setNarration(data.narration)
      } catch (err) {}
    }, 500)
    return () => clearInterval(pollInterval)
  }, [isActive])

  useEffect(() => {
    if (!isActive) return
    const pollAttendance = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/attendance`)
        const data = await res.json()
        setAttendance(data)
      } catch (err) {}
    }, 1000)
    return () => clearInterval(pollAttendance)
  }, [isActive])

  useEffect(() => {
    if (!isActive) return
    const pollZones = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/zones`)
        const data = await res.json()
        setZones(data)
      } catch (err) {}
    }, 2000)
    return () => clearInterval(pollZones)
  }, [isActive])

  useEffect(() => {
    if (!isActive) return
    let animFrameId = null

    const draw = () => {
      const canvas = canvasRef.current
      const video = videoRef.current

      if (canvas && video) {
        const ctx = canvas.getContext("2d")
        canvas.width = video.videoWidth || 640
        canvas.height = video.videoHeight || 480
        ctx.clearRect(0, 0, canvas.width, canvas.height)

        facesRef.current.forEach(face => {
          const isKnown = face.confirmed === true
          const color = isKnown ? "#00FF00" : "#FF0000"
          const label = isKnown ? face.name : "Unknown"
          ctx.strokeStyle = color
          ctx.lineWidth = 2
          ctx.strokeRect(face.x, face.y, face.width, face.height)
          ctx.fillStyle = color
          ctx.font = "14px Arial"
          ctx.fillText(label, face.x, face.y - 5)
        })

        objectsRef.current.forEach(obj => {
          ctx.strokeStyle = "#0099FF"
          ctx.lineWidth = 2
          ctx.strokeRect(obj.x, obj.y, obj.width, obj.height)
          ctx.fillStyle = "#0099FF"
          ctx.font = "14px Arial"
          const labelY = obj.y > 15 ? obj.y - 5 : obj.y + 15
          ctx.fillText(`${obj.label} ${Math.round(obj.confidence * 100)}%`, obj.x, labelY)
        })

        Object.entries(zones).forEach(([name, zone]) => {
          ctx.strokeStyle = "#FFD700"
          ctx.lineWidth = 2
          ctx.setLineDash([6, 4])
          ctx.strokeRect(zone.x1, zone.y1, zone.x2 - zone.x1, zone.y2 - zone.y1)
          ctx.setLineDash([])
          const count = zoneCountsRef.current[name] ?? 0
          ctx.fillStyle = "#FFD700"
          ctx.font = "14px Arial"
          const labelY = zone.y1 > 15 ? zone.y1 - 5 : zone.y1 + 15
          ctx.fillText(`${name}: ${count}`, zone.x1, labelY)
        })

        if (isDrawing) {
          const x1 = Math.min(drawStart.x, drawCurrent.x)
          const y1 = Math.min(drawStart.y, drawCurrent.y)
          const w = Math.abs(drawCurrent.x - drawStart.x)
          const h = Math.abs(drawCurrent.y - drawStart.y)
          ctx.strokeStyle = "#FFFFFF"
          ctx.lineWidth = 2
          ctx.setLineDash([4, 4])
          ctx.strokeRect(x1, y1, w, h)
          ctx.setLineDash([])
        }
      }
      animFrameId = requestAnimationFrame(draw)
    }

    animFrameId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animFrameId)
  }, [isActive, zones, isDrawing, drawStart, drawCurrent])

  const getCanvasCoords = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    }
  }

  const handleMouseDown = (e) => {
    const coords = getCanvasCoords(e)
    setDrawStart(coords)
    setDrawCurrent(coords)
    setIsDrawing(true)
  }

  const handleMouseMove = (e) => {
    if (!isDrawing) return
    setDrawCurrent(getCanvasCoords(e))
  }

  const handleMouseUp = async () => {
    if (!isDrawing) return
    setIsDrawing(false)

    const x1 = Math.min(drawStart.x, drawCurrent.x)
    const y1 = Math.min(drawStart.y, drawCurrent.y)
    const x2 = Math.max(drawStart.x, drawCurrent.x)
    const y2 = Math.max(drawStart.y, drawCurrent.y)

    if (x2 - x1 < 20 || y2 - y1 < 20) return

    const zoneName = prompt("Name this zone:")
    if (!zoneName) return

    try {
      const res = await fetch(`${BACKEND_URL}/zones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: zoneName,
          x1: Math.round(x1), y1: Math.round(y1),
          x2: Math.round(x2), y2: Math.round(y2)
        })
      })
      const data = await res.json()
      if (data.status === "ok") {
        setZones(prev => ({
          ...prev,
          [zoneName]: { x1: Math.round(x1), y1: Math.round(y1), x2: Math.round(x2), y2: Math.round(y2) }
        }))
      }
    } catch (err) {
      console.error("Failed to save zone:", err)
    }
  }

  return (
    <div style={{ display: "flex", gap: "24px" }}>
      <div>
        <h1>OccuVision</h1>
        <div style={{ position: "relative", display: "inline-block" }}>
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
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              pointerEvents: "auto",
              cursor: "crosshair"
            }}
          />
        </div>

        <br />
        {isActive
          ? <button onClick={() => {
              facesRef.current = []
              const canvas = canvasRef.current
              if (canvas) {
                const ctx = canvas.getContext("2d")
                ctx.clearRect(0, 0, canvas.width, canvas.height)
              }
              stop()
            }}>Stop Camera</button>
          : <button onClick={start}>Start Camera</button>
        }
        <p style={{ color: "#666", fontSize: "13px" }}>
          Click and drag on the video to draw a zone.
        </p>

        {/* Scene Narration */}
        {narration && (
          <div style={{
            marginTop: "12px",
            padding: "10px",
            background: "#f0f4ff",
            borderRadius: "6px",
            border: "1px solid #c0d0ff",
            maxWidth: "640px",
            fontSize: "14px"
          }}>
            <strong>Scene:</strong> {narration}
          </div>
        )}
      </div>

      <div style={{ minWidth: "250px" }}>
        <h2>Today's Attendance</h2>
        {Object.keys(attendance).length === 0 ? (
          <p>No one recognized yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {Object.entries(attendance).map(([name, times]) => (
              <li key={name} style={{
                marginBottom: "12px",
                padding: "10px",
                border: "1px solid #ccc",
                borderRadius: "6px"
              }}>
                <strong>{name}</strong>
                <br />
                First seen: {times.first_seen}
                <br />
                Last seen: {times.last_seen}
              </li>
            ))}
          </ul>
        )}

        <h2>Alerts</h2>
        {alertsList.length === 0 ? (
          <p>No alerts.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {alertsList.map((alert, index) => (
              <li key={index} style={{
                marginBottom: "8px",
                padding: "10px 32px 10px 10px",
                border: "1px solid #ff4444",
                borderRadius: "6px",
                backgroundColor: "#fff5f5",
                position: "relative"
              }}>
                <button
                  onClick={() => {
                    dismissedAlertsRef.current.add(alert.timestamp)
                    setAlertsList(prev => prev.filter((_, i) => i !== index))
                  }}
                  style={{
                    position: "absolute",
                    top: "8px",
                    right: "10px",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "12px",
                    color: "#ff4444",
                    fontWeight: "bold",
                    lineHeight: 1
                  }}
                >✕</button>
                ⚠️ {alert.message}
                <br />
                <small style={{ color: "#888" }}>{alert.timestamp}</small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default App