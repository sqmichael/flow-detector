import { EyeTrackingTest } from './components/EyeTrackingTest'

function App() {
  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ marginBottom: '30px' }}>
        <h1 style={{ fontSize: '24px', marginBottom: '8px' }}>
          Flow Detector
        </h1>
        <p style={{ color: '#888', fontSize: '14px' }}>
          Eye tracking test - Blink rate, gaze stability, and flow indicator
        </p>
      </header>

      <EyeTrackingTest />
    </div>
  )
}

export default App
