import { useState, useEffect, useRef } from 'react'
import { API_URL } from '../config.js'

const Leaderboard = ({ roomId, token, socket, userId, myRank }) => {
  const [leaderboard, setLeaderboard] = useState([])
  const [userRank, setUserRank] = useState(null)
  const [totalParticipants, setTotalParticipants] = useState(0)
  const [isTeacher, setIsTeacher] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Keep the latest isTeacher available inside the socket listener without rebinding it.
  const isTeacherRef = useRef(false)
  useEffect(() => { isTeacherRef.current = isTeacher }, [isTeacher])

  const fetchLeaderboard = async () => {
    try {
      const response = await fetch(`${API_URL}/responses/leaderboard/${roomId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      const data = await response.json()
      if (data.success) {
        setLeaderboard(data.leaderboard)
        setUserRank(data.userRank)
        setTotalParticipants(data.totalParticipants)
        setIsTeacher(data.isTeacher)
      } else {
        setError('Failed to load leaderboard')
      }
    } catch (err) {
      console.error('Failed to fetch leaderboard:', err)
      setError('Failed to load leaderboard')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!roomId) return
    fetchLeaderboard()

    // Phase 1: consume the server's throttled, pushed leaderboard payload instead of
    // re-fetching on every points event (which caused the ~N^2 storm). Students apply the
    // top-N payload directly; the teacher is a single client, so it just re-fetches the
    // full board on each tick.
    if (socket) {
      const handleLiveUpdate = (payload) => {
        if (isTeacherRef.current) {
          fetchLeaderboard()
          return
        }
        if (payload?.leaderboard) {
          if (typeof payload.totalParticipants === 'number') setTotalParticipants(payload.totalParticipants)
          
          setLeaderboard(prev => {
            let newBoard = [...payload.leaderboard]
            if (userId) {
              const meInNew = newBoard.find(e => e.studentId === userId)
              if (meInNew) {
                setUserRank(meInNew.rank)
              } else {
                // User is not in the new top-N. Find them in our current state to preserve them
                const meInOld = prev.find(e => e.studentId === userId || e.isCurrentUser)
                if (meInOld) {
                  newBoard.push({ ...meInOld, isCurrentUser: true })
                }
              }
            }
            return newBoard
          })
        }
      }
      socket.on('leaderboard:updated', handleLiveUpdate)
      return () => socket.off('leaderboard:updated', handleLiveUpdate)
    }
  }, [roomId, socket, userId])

  // "Rank on submit": when the student answers, the POST returns their current rank; apply it.
  useEffect(() => {
    if (myRank != null) setUserRank(myRank)
  }, [myRank])

  if (loading) {
    return (
      <div style={{
        padding: '20px',
        textAlign: 'center',
        color: 'var(--text-secondary)',
        fontSize: '13px'
      }}>
        Loading leaderboard...
      </div>
    )
  }

  if (error) {
    return (
      <div style={{
        padding: '20px',
        textAlign: 'center',
        color: '#ef4444',
        fontSize: '13px'
      }}>
        {error}
      </div>
    )
  }

  if (leaderboard.length === 0) {
    return (
      <div style={{
        padding: '20px',
        textAlign: 'center',
        color: 'var(--text-secondary)',
        fontSize: '13px'
      }}>
        No responses yet. Leaderboard will appear once students start answering.
      </div>
    )
  }

  const getRenderItems = () => {
    if (isTeacher) {
      return leaderboard
    }

    // Students only see the top 10, plus their own row at the bottom (with ellipsis) if they are outside top 10
    const top10 = leaderboard.slice(0, 10).map(entry => ({
      ...entry,
      isCurrentUser: entry.isCurrentUser || (userId && entry.studentId === userId)
    }))

    const me = leaderboard.find(e => e.isCurrentUser || (userId && e.studentId === userId))
    const isMeInTop10 = top10.some(e => e.studentId === userId)

    if (me && !isMeInTop10) {
      return [
        ...top10,
        {
          ...me,
          isCurrentUser: true,
          showEllipsisBefore: true
        }
      ]
    }

    return top10
  }

  const renderRank = (entry, index) => {
    const rank = entry.rank
    const isCurrentUser = entry.isCurrentUser

    // Top-3 and the current-user row always render on a LIGHT gradient background in BOTH
    // themes (gold/silver/bronze/blue). var(--text-primary) flips to near-white in dark mode,
    // which made these rows unreadable. Pin their text to the light-mode dark values so light
    // mode is unchanged and dark mode stays legible.
    const isHighlighted = rank <= 3 || isCurrentUser
    const nameColor = isHighlighted ? '#1f2937' : 'var(--text-primary)'
    const subColor = isHighlighted ? '#6b7280' : 'var(--text-secondary)'
    const pointsColor = rank === 1 ? '#f59e0b' : isHighlighted ? '#1f2937' : 'var(--text-primary)'

    const renderedRow = (
      <div key={entry.studentId} style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 10px',
        minWidth: 0,
        width: '100%',
        maxWidth: '100%',
        overflow: 'hidden',
        boxSizing: 'border-box',
        flexShrink: 0,
        background: rank === 1 ? 'linear-gradient(135deg, #fef3c7, #fde68a)' :
                     rank === 2 ? 'linear-gradient(135deg, #f3f4f6, #e5e7eb)' :
                     rank === 3 ? 'linear-gradient(135deg, #fef3c7, #fde68a)' : 
                     isCurrentUser ? 'linear-gradient(135deg, #dbeafe, #bfdbfe)' : 'var(--bg-primary)',
        borderRadius: '10px',
        border: rank <= 3 ? `2px solid ${rank === 1 ? '#f59e0b' : rank === 2 ? '#9ca3af' : '#d97706'}` : 
               isCurrentUser ? '2px solid #3b82f6' : '1px solid var(--border-color)'
      }}>
        <span style={{
          width: '28px',
          height: '28px',
          borderRadius: '50%',
          background: rank === 1 ? '#f59e0b' : rank === 2 ? '#6b7280' : rank === 3 ? '#d97706' : 'var(--border-color)',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '12px',
          fontWeight: '700',
          flexShrink: 0
        }}>
          {rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank}
        </span>

        <div style={{ flex: '1 1 auto', minWidth: 0, maxWidth: '100%', overflow: 'hidden' }}>
          <div style={{
            fontSize: '14px',
            fontWeight: '600',
            color: nameColor,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%'
          }}>
            {entry.studentName}{isCurrentUser ? ' (You)' : ''}
          </div>
          <div style={{
            fontSize: '11px',
            color: subColor,
            marginTop: '2px'
          }}>
            {entry.correctCount}/{entry.totalAnswered} correct
          </div>
        </div>

        <div style={{
          fontSize: '16px',
          fontWeight: '700',
          color: pointsColor,
          textAlign: 'right',
          flexShrink: 0,
          minWidth: '45px',
          maxWidth: '45px',
          overflow: 'hidden'
        }}>
          {entry.totalPoints}
          <span style={{ fontSize: '10px', fontWeight: '500', marginLeft: '2px' }}>pts</span>
        </div>
      </div>
    )

    if (entry.showEllipsisBefore) {
      return (
        <div key={`ellipsis-group-${entry.studentId}`} style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px 0',
            color: 'var(--text-secondary)',
            fontSize: '12px',
            flexShrink: 0
          }}>
            •••
          </div>
          {renderedRow}
        </div>
      )
    }

    return renderedRow
  }

  const visibleItems = getRenderItems()

  return (
    <div style={{ position: 'relative', width: '100%', minWidth: 0, maxWidth: '100%' }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        width: '100%',
        minWidth: 0,
        maxWidth: '100%',
        overflowX: 'hidden',
        overflowY: 'auto',
        maxHeight: '60vh',
        boxSizing: 'border-box'
      }}>
        {visibleItems.map((entry, index) => renderRank(entry, index))}

        {/* Show total participants count */}
        {!isTeacher && totalParticipants > 10 && (
          <div style={{
            textAlign: 'center',
            padding: '8px',
            color: 'var(--text-secondary)',
            fontSize: '11px'
          }}>
            {totalParticipants} students in session
          </div>
        )}
      </div>
      {/* Fade hint when the board overflows */}
      {leaderboard.length > 8 && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '32px', background: 'linear-gradient(to bottom, rgba(var(--bg-card-rgb), 0), rgba(var(--bg-card-rgb), 1))', pointerEvents: 'none' }} />
      )}
    </div>
  )
}

export default Leaderboard