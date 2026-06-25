import { useEffect, useRef, useState, useCallback } from "react"
import { useWebcam } from "./hooks/useWebcam"

const BACKEND_URL = "http://127.0.0.1:8000"

const DARK = {
  bg: "#0f1117",
  surface: "#1a1d27",
  card: "#22263a",
  border: "#2a2d3a",
  text: "#e2e8f0",
  muted: "#64748b",
  hint: "#475569",
  accent: "#4f6ef7",
  accentDim: "#4f6ef722",
  accentBorder: "#4f6ef744",
  green: "#22c55e",
  greenDim: "#22c55e22",
  greenBorder: "#22c55e44",
  red: "#ef4444",
  redDim: "#ef444411",
  redBorder: "#ef444433",
  yellow: "#eab308",
  yellowDim: "#eab30811",
  yellowBorder: "#eab30833",
}

const LIGHT = {
  bg: "#f8fafc",
  surface: "#ffffff",
  card: "#f1f5f9",
  border: "#e2e8f0",
  text: "#0f172a",
  muted: "#64748b",
  hint: "#94a3b8",
  accent: "#3b5ce4",
  accentDim: "#3b5ce411",
  accentBorder: "#3b5ce433",
  green: "#16a34a",
  greenDim: "#16a34a11",
  greenBorder: "#16a34a33",
  red: "#dc2626",
  redDim: "#dc262611",
  redBorder: "#dc262633",
  yellow: "#ca8a04",
  yellowDim: "#ca8a0411",
  yellowBorder: "#ca8a0433",
}

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
  const [darkMode, setDarkMode] = useState(true)

  const T = darkMode ? DARK : LIGHT

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
          const color = isKnown ? "#22c55e" : "#ef4444"
          const label = isKnown ? face.name : "Unknown"
          ctx.strokeStyle = color
          ctx.lineWidth = 2
          ctx.strokeRect(face.x, face.y, face.width, face.height)
          ctx.fillStyle = color
          ctx.font = "bold 13px Arial"
          const labelY = face.y > 18 ? face.y - 6 : face.y + 16
          ctx.fillText(label, face.x, labelY)
        })

        objectsRef.current.forEach(obj => {
          ctx.strokeStyle = "#4f6ef7"
          ctx.lineWidth = 2
          ctx.strokeRect(obj.x, obj.y, obj.width, obj.height)
          ctx.fillStyle = "#4f6ef7"
          ctx.font = "12px Arial"
          const labelY = obj.y > 15 ? obj.y - 5 : obj.y + 15
          ctx.fillText(`${obj.label} ${Math.round(obj.confidence * 100)}%`, obj.x, labelY)
        })

        Object.entries(zones).forEach(([name, zone]) => {
          ctx.strokeStyle = "#eab308"
          ctx.lineWidth = 1.5
          ctx.setLineDash([6, 4])
          ctx.strokeRect(zone.x1, zone.y1, zone.x2 - zone.x1, zone.y2 - zone.y1)
          ctx.setLineDash([])
          const count = zoneCountsRef.current[name] ?? 0
          ctx.fillStyle = "#eab308"
          ctx.font = "12px Arial"
          const labelY = zone.y1 > 15 ? zone.y1 - 5 : zone.y1 + 15
          ctx.fillText(`${name}: ${count}`, zone.x1, labelY)
        })

        if (isDrawing) {
          const x1 = Math.min(drawStart.x, drawCurrent.x)
          const y1 = Math.min(drawStart.y, drawCurrent.y)
          const w = Math.abs(drawCurrent.x - drawStart.x)
          const h = Math.abs(drawCurrent.y - drawStart.y)
          ctx.strokeStyle = "#ffffff"
          ctx.lineWidth = 1.5
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
    } catch (err) {}
  }

  const deleteZone = async (name) => {
    try {
      const res = await fetch(`${BACKEND_URL}/zones/${encodeURIComponent(name)}`, {
        method: "DELETE"
      })
      const data = await res.json()
      if (data.status === "ok") {
        setZones(prev => {
          const updated = { ...prev }
          delete updated[name]
          return updated
        })
      }
    } catch (err) {}
  }

  const s = {
    root: {
      background: T.bg,
      color: T.text,
      fontFamily: "system-ui, -apple-system, sans-serif",
      minHeight: "100vh",
      transition: "background 0.2s, color 0.2s"
    },
    nav: {
      background: T.surface,
      borderBottom: `0.5px solid ${T.border}`,
      padding: "0 24px",
      height: "52px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      position: "sticky",
      top: 0,
      zIndex: 10
    },
    logo: {
      fontSize: "16px",
      fontWeight: "500",
      color: T.accent,
      display: "flex",
      alignItems: "center",
      gap: "8px"
    },
    liveBadge: {
      background: T.greenDim,
      color: T.green,
      fontSize: "11px",
      padding: "3px 10px",
      borderRadius: "20px",
      border: `0.5px solid ${T.greenBorder}`,
      display: "flex",
      alignItems: "center",
      gap: "5px"
    },
    toggleBtn: {
      background: T.card,
      border: `0.5px solid ${T.border}`,
      borderRadius: "20px",
      padding: "5px 12px",
      fontSize: "12px",
      color: T.muted,
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      gap: "6px"
    },
    body: {
      display: "grid",
      gridTemplateColumns: "1fr 280px",
      minHeight: "calc(100vh - 52px)"
    },
    main: {
      padding: "20px",
      borderRight: `0.5px solid ${T.border}`
    },
    videoWrap: {
      background: "#000",
      borderRadius: "10px",
      overflow: "hidden",
      position: "relative",
      display: "block",
      width: "100%",
      maxWidth: "760px"
    },
    video: {
      display: "block",
      width: "100%"
    },
    canvas: {
      position: "absolute",
      top: 0,
      left: 0,
      pointerEvents: "auto",
      cursor: "crosshair",
      width: "100%",
      height: "100%"
    },
    narrationCard: {
      marginTop: "12px",
      background: T.surface,
      border: `0.5px solid ${T.border}`,
      borderLeft: `3px solid ${T.accent}`,
      borderRadius: "8px",
      padding: "10px 14px",
      fontSize: "13px",
      color: T.muted,
      lineHeight: "1.6"
    },
    narrationLabel: {
      fontSize: "10px",
      fontWeight: "500",
      color: T.accent,
      textTransform: "uppercase",
      letterSpacing: "0.6px",
      marginBottom: "4px"
    },
    controls: {
      marginTop: "12px",
      display: "flex",
      gap: "8px",
      alignItems: "center"
    },
    btnStop: {
      padding: "7px 16px",
      borderRadius: "8px",
      fontSize: "13px",
      border: `0.5px solid ${T.redBorder}`,
      background: T.redDim,
      color: T.red,
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      gap: "6px"
    },
    btnStart: {
      padding: "7px 16px",
      borderRadius: "8px",
      fontSize: "13px",
      border: `0.5px solid ${T.greenBorder}`,
      background: T.greenDim,
      color: T.green,
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      gap: "6px"
    },
    hint: {
      fontSize: "11px",
      color: T.hint,
      marginTop: "6px"
    },
    sidebar: {
      background: T.surface,
      padding: "16px",
      display: "flex",
      flexDirection: "column",
      gap: "20px",
      overflowY: "auto"
    },
    sectionTitle: {
      fontSize: "10px",
      fontWeight: "500",
      color: T.hint,
      textTransform: "uppercase",
      letterSpacing: "0.8px",
      marginBottom: "8px"
    },
    attCard: {
      background: T.card,
      border: `0.5px solid ${T.border}`,
      borderRadius: "8px",
      padding: "10px 12px",
      marginBottom: "8px"
    },
    attName: {
      fontSize: "13px",
      fontWeight: "500",
      color: T.text,
      display: "flex",
      alignItems: "center",
      gap: "6px"
    },
    attDot: {
      width: "6px",
      height: "6px",
      borderRadius: "50%",
      background: T.green,
      display: "inline-block"
    },
    attMeta: {
      fontSize: "11px",
      color: T.muted,
      marginTop: "4px",
      lineHeight: "1.7"
    },
    alertCard: {
      background: T.redDim,
      border: `0.5px solid ${T.redBorder}`,
      borderRadius: "8px",
      padding: "10px 32px 10px 12px",
      position: "relative",
      marginBottom: "8px"
    },
    alertMsg: {
      fontSize: "12px",
      color: T.red
    },
    alertTime: {
      fontSize: "10px",
      color: T.muted,
      marginTop: "2px"
    },
    alertX: {
      position: "absolute",
      top: "8px",
      right: "10px",
      fontSize: "11px",
      color: T.red,
      cursor: "pointer",
      background: "none",
      border: "none",
      fontWeight: "bold",
      lineHeight: 1
    },
    zoneCard: {
      background: T.card,
      border: `0.5px solid ${T.yellowBorder}`,
      borderRadius: "8px",
      padding: "8px 12px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: "8px"
    },
    zoneName: {
      fontSize: "12px",
      color: T.yellow,
      display: "flex",
      alignItems: "center",
      gap: "6px"
    },
    zoneCount: {
      fontSize: "11px",
      color: T.muted
    },
    delBtn: {
      fontSize: "10px",
      color: T.red,
      background: "none",
      border: `0.5px solid ${T.redBorder}`,
      borderRadius: "4px",
      padding: "2px 6px",
      cursor: "pointer"
    },
    emptyText: {
      fontSize: "12px",
      color: T.hint,
      fontStyle: "italic"
    }
  }

  return (
    <div style={s.root}>
      {/* Navbar */}
      <nav style={s.nav}>
        <div style={s.logo}>
          👁 OccuVision
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {isActive && (
            <div style={s.liveBadge}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.green, display: "inline-block" }}></span>
              Live
            </div>
          )}
          <button style={s.toggleBtn} onClick={() => setDarkMode(d => !d)}>
            {darkMode ? "☀ Light mode" : "🌙 Dark mode"}
          </button>
        </div>
      </nav>

      {/* Body */}
      <div style={s.body}>

        {/* Main — video feed */}
        <div style={s.main}>
          <div style={s.videoWrap}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              width={640}
              height={480}
              style={s.video}
            />
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              style={s.canvas}
            />
          </div>

          {/* Narration */}
          {narration && (
            <div style={s.narrationCard}>
              <div style={s.narrationLabel}> Scene</div>
              {narration}
            </div>
          )}

          {/* Controls */}
          <div style={s.controls}>
            {isActive
              ? <button style={s.btnStop} onClick={() => {
                  facesRef.current = []
                  const canvas = canvasRef.current
                  if (canvas) {
                    const ctx = canvas.getContext("2d")
                    ctx.clearRect(0, 0, canvas.width, canvas.height)
                  }
                  stop()
                }}>⏹ Stop camera</button>
              : <button style={s.btnStart} onClick={start}>▶ Start camera</button>
            }
          </div>
          <p style={s.hint}>Click and drag on the video to draw a zone.</p>
        </div>

        {/* Sidebar */}
        <div style={s.sidebar}>

          {/* Attendance */}
          <div>
            <div style={s.sectionTitle}>Attendance</div>
            {Object.keys(attendance).length === 0
              ? <p style={s.emptyText}>No one recognized yet.</p>
              : Object.entries(attendance).map(([name, times]) => (
                <div key={name} style={s.attCard}>
                  <div style={s.attName}>
                    <span style={s.attDot}></span>
                    {name}
                  </div>
                  <div style={s.attMeta}>
                    First seen: {times.first_seen}<br />
                    Last seen: {times.last_seen}
                  </div>
                </div>
              ))
            }
          </div>

          {/* Alerts */}
          <div>
            <div style={s.sectionTitle}>Alerts</div>
            {alertsList.length === 0
              ? <p style={s.emptyText}>No alerts.</p>
              : alertsList.map((alert, index) => (
                <div key={index} style={s.alertCard}>
                  <button
                    style={s.alertX}
                    onClick={() => {
                      dismissedAlertsRef.current.add(alert.timestamp)
                      setAlertsList(prev => prev.filter((_, i) => i !== index))
                    }}
                  >✕</button>
                  <div style={s.alertMsg}>⚠ {alert.message}</div>
                  <div style={s.alertTime}>{alert.timestamp}</div>
                </div>
              ))
            }
          </div>

          {/* Zones */}
          <div>
            <div style={s.sectionTitle}>Zones</div>
            {Object.keys(zones).length === 0
              ? <p style={s.emptyText}>No zones defined.</p>
              : Object.entries(zones).map(([name, zone]) => (
                <div key={name} style={s.zoneCard}>
                  <span style={s.zoneName}>▣ {name}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={s.zoneCount}>{zoneCountsRef.current[name] ?? 0} person(s)</span>
                    <button style={s.delBtn} onClick={() => deleteZone(name)}>Delete</button>
                  </div>
                </div>
              ))
            }
          </div>

        </div>
      </div>
    </div>
  )
}

export default App