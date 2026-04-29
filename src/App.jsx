import { useRef, useState } from 'react'
import './App.css'

const isTauri = '__TAURI_INTERNALS__' in window

async function openVideoDialog() {
  if (!isTauri) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const { convertFileSrc } = await import('@tauri-apps/api/core')
  const selected = await open({
    multiple: false,
    filters: [
      { name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] },
      { name: 'All', extensions: ['*'] }
    ]
  })
  if (!selected) return null
  return convertFileSrc(selected)
}

function App() {
  const videoRef = useRef(null)
  const fileRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [videoSrc, setVideoSrc] = useState('')

  const handlePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause()
      } else {
        videoRef.current.play()
      }
      setIsPlaying(!isPlaying)
    }
  }

  const handleImport = async () => {
    if (isTauri) {
      const url = await openVideoDialog()
      if (url) { setVideoSrc(url); setIsPlaying(false) }
    } else {
      fileRef.current?.click()
    }
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (file) {
      setVideoSrc(URL.createObjectURL(file))
      setIsPlaying(false)
    }
  }

  return (
    <div className="app">
      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <button className="import-btn" onClick={handleImport}>
        Import Video
      </button>
      <div className="video-container">
        <video
          ref={videoRef}
          className="video"
          controls={false}
          onClick={handlePlay}
          src={videoSrc}
        />
        {!videoSrc && (
          <div className="empty-overlay">
            <p>Click "Import Video" to load a video</p>
          </div>
        )}
        {videoSrc && !isPlaying && (
          <div className="play-overlay" onClick={handlePlay}>
            <div className="play-button">▶</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
