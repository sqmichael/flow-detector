import { useState, useCallback } from 'react'
import { useCameraStream } from '@/hooks/use-camera-stream'
import { useEyeTracking } from '@/hooks/use-eye-tracking'
import type { AggregatedEyeMetrics } from '@/lib/mediapipe/types'

export function EyeTrackingTest() {
  const { state: cameraState, videoRef, startStream, stopStream } = useCameraStream()
  const [isTracking, setIsTracking] = useState(false)
  const [latestMetrics, setLatestMetrics] = useState<AggregatedEyeMetrics | null>(null)

  const handleMetrics = useCallback((metrics: AggregatedEyeMetrics) => {
    setLatestMetrics(metrics)
  }, [])

  const { state: trackingState, start: startTracking, stop: stopTracking } = useEyeTracking({
    videoElement: videoRef.current,
    enabled: isTracking,
    onMetrics: handleMetrics,
  })

  const handleStart = async () => {
    const streamStarted = await startStream()
    if (streamStarted) {
      // Small delay to ensure video is ready
      setTimeout(async () => {
        const trackingStarted = await startTracking()
        if (trackingStarted) {
          setIsTracking(true)
        }
      }, 500)
    }
  }

  const handleStop = () => {
    stopTracking()
    stopStream()
    setIsTracking(false)
    setLatestMetrics(null)
  }

  const getFlowStateLabel = (indicator: number): { label: string; color: string } => {
    if (indicator >= 0.8) return { label: 'Deep Flow', color: '#22c55e' }
    if (indicator >= 0.6) return { label: 'Light Flow', color: '#84cc16' }
    if (indicator >= 0.4) return { label: 'Focused', color: '#eab308' }
    if (indicator >= 0.2) return { label: 'Distracted', color: '#f97316' }
    return { label: 'Unfocused', color: '#ef4444' }
  }

  const flowState = latestMetrics ? getFlowStateLabel(latestMetrics.eyeFlowIndicator) : null

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: '20px' }}>
      {/* Video Preview */}
      <div style={{
        backgroundColor: '#111',
        borderRadius: '12px',
        overflow: 'hidden',
        position: 'relative',
        aspectRatio: '16/9',
      }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: 'scaleX(-1)', // Mirror for selfie view
          }}
        />

        {/* Overlay status */}
        {!cameraState.stream && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.8)',
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>📷</div>
              <p style={{ color: '#888' }}>
                {cameraState.isLoading ? 'Starting camera...' : 'Camera not active'}
              </p>
            </div>
          </div>
        )}

        {/* Flow indicator overlay */}
        {flowState && (
          <div style={{
            position: 'absolute',
            top: '16px',
            left: '16px',
            backgroundColor: 'rgba(0,0,0,0.7)',
            padding: '8px 16px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <div style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              backgroundColor: flowState.color,
            }} />
            <span style={{ fontWeight: '600' }}>{flowState.label}</span>
          </div>
        )}
      </div>

      {/* Metrics Panel */}
      <div style={{
        backgroundColor: '#111',
        borderRadius: '12px',
        padding: '20px',
      }}>
        <h2 style={{ fontSize: '16px', marginBottom: '20px', color: '#888' }}>
          Eye Metrics
        </h2>

        {/* Control buttons */}
        <div style={{ marginBottom: '24px' }}>
          {!isTracking ? (
            <button
              onClick={handleStart}
              disabled={cameraState.isLoading}
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
                opacity: cameraState.isLoading ? 0.5 : 1,
              }}
            >
              {cameraState.isLoading ? 'Starting...' : 'Start Eye Tracking'}
            </button>
          ) : (
            <button
              onClick={handleStop}
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: '#ef4444',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              Stop Tracking
            </button>
          )}
        </div>

        {/* Status */}
        <div style={{ marginBottom: '24px' }}>
          <StatusItem
            label="Camera"
            value={cameraState.permissionStatus === 'granted' ? 'Connected' : cameraState.permissionStatus}
            isActive={cameraState.permissionStatus === 'granted'}
          />
          <StatusItem
            label="MediaPipe"
            value={trackingState.isInitialized ? 'Ready' : 'Not loaded'}
            isActive={trackingState.isInitialized}
          />
          <StatusItem
            label="Tracking"
            value={trackingState.isRunning ? 'Active' : 'Inactive'}
            isActive={trackingState.isRunning}
          />
        </div>

        {/* Metrics display */}
        {latestMetrics ? (
          <div>
            <MetricBar
              label="Eye Flow Indicator"
              value={latestMetrics.eyeFlowIndicator}
              color={flowState?.color || '#888'}
            />
            <MetricBar
              label="Gaze Stability"
              value={latestMetrics.gazeStability}
              color="#8b5cf6"
            />
            <MetricItem
              label="Blink Rate"
              value={`${latestMetrics.blinkRate.toFixed(1)} /min`}
            />
            <MetricItem
              label="Average EAR"
              value={latestMetrics.averageEAR.toFixed(3)}
            />
            <MetricItem
              label="Frames Processed"
              value={latestMetrics.frameCount.toString()}
            />
          </div>
        ) : (
          <p style={{ color: '#555', fontSize: '14px', textAlign: 'center' }}>
            {isTracking ? 'Collecting data...' : 'Start tracking to see metrics'}
          </p>
        )}

        {/* Error display */}
        {(cameraState.error || trackingState.error) && (
          <div style={{
            marginTop: '20px',
            padding: '12px',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            borderRadius: '8px',
            border: '1px solid rgba(239, 68, 68, 0.3)',
          }}>
            <p style={{ color: '#ef4444', fontSize: '13px' }}>
              {cameraState.error || trackingState.error}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function StatusItem({ label, value, isActive }: { label: string; value: string; isActive: boolean }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '8px 0',
      borderBottom: '1px solid #222',
    }}>
      <span style={{ color: '#888', fontSize: '13px' }}>{label}</span>
      <span style={{
        fontSize: '13px',
        color: isActive ? '#22c55e' : '#888',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
      }}>
        <span style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          backgroundColor: isActive ? '#22c55e' : '#555',
        }} />
        {value}
      </span>
    </div>
  )
}

function MetricBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span style={{ color: '#888', fontSize: '13px' }}>{label}</span>
        <span style={{ fontSize: '13px', fontWeight: '600' }}>{(value * 100).toFixed(0)}%</span>
      </div>
      <div style={{
        height: '8px',
        backgroundColor: '#222',
        borderRadius: '4px',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${value * 100}%`,
          backgroundColor: color,
          borderRadius: '4px',
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  )
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      padding: '8px 0',
      borderBottom: '1px solid #222',
    }}>
      <span style={{ color: '#888', fontSize: '13px' }}>{label}</span>
      <span style={{ fontSize: '13px', fontWeight: '500' }}>{value}</span>
    </div>
  )
}

export default EyeTrackingTest
