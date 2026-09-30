'use client'
import {
  LiveKitRoom,
  RoomAudioRenderer,
} from '@livekit/components-react'
import '@livekit/components-styles'
import { Room } from 'livekit-client'
import { useEffect, useState, useMemo, useCallback, createContext, useContext } from 'react'
import { authFetch } from '@/lib/progressApi'

interface StaadVideoProps {
  sessionId: string
  children: React.ReactNode
}

interface RoomContextValue {
  disconnect: () => void
  room: Room | null
}

const RoomCtx = createContext<RoomContextValue>({ disconnect: () => {}, room: null })

export const useSessionRoom = () => useContext(RoomCtx)

export default function StaadVideo({ sessionId, children }: StaadVideoProps) {
  const [token, setToken] = useState<string>('')
  const [error, setError] = useState('')

  const room = useMemo(() => new Room(), [])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!sessionId) return
    // Only the session id is sent. The server works out who we are from the ID
    // token and our role/name from the database — neither is ours to claim.
    authFetch(`/api/livekit-token?room=${encodeURIComponent(sessionId)}`)
      .then(r => r.json())
      .then(d => {
        if (d.token) setToken(d.token)
        else setError('Could not get video token')
      })
      .catch(() => setError('Video connection failed'))
  }, [sessionId])

  const disconnect = useCallback(() => {
    room.disconnect()
  }, [room])

  const handleConnected = useCallback(() => setConnected(true), [])
  const handleDisconnected = useCallback(() => setConnected(false), [])

  if (error) return (
    <div className="h-full flex items-center justify-center" style={{ color: 'var(--ink-muted)', fontSize: 13 }}>
      {error}
    </div>
  )

  if (!token) return (
    <div className="h-full flex items-center justify-center" style={{ color: 'var(--ink-muted)', fontSize: 13 }}>
      Connecting video...
    </div>
  )

  return (
    <RoomCtx.Provider value={{ disconnect, room }}>
      <LiveKitRoom
        room={room}
        serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL}
        token={token}
        connect={true}
        video={true}
        audio={true}
        onConnected={handleConnected}
        onDisconnected={handleDisconnected}
        style={{ width: '100%', height: '100%' }}
      >
        <RoomAudioRenderer />
        {children}
      </LiveKitRoom>
    </RoomCtx.Provider>
  )
}
