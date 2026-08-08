/**
 * Service for capturing and mixing audio streams (Mic-only, Dual-Device, and System Audio).
 */

/**
 * Capture microphone audio stream only.
 * @param {string|null} deviceId - Specific audio input device ID or null for default
 * @returns {Promise<{ stream: MediaStream, cleanup: Function }>}
 */
export async function captureMicOnly(deviceId = null) {
  const constraints = {
    audio: deviceId ? { deviceId: { ideal: deviceId } } : true
  }

  const stream = await navigator.mediaDevices.getUserMedia(constraints)

  return {
    stream,
    cleanup: () => {
      stream.getTracks().forEach(track => track.stop())
    }
  }
}

/**
 * Capture primary mic AND secondary audio input device (e.g. VB-Cable, BlackHole)
 * and mix them together into a single MediaStream using Web Audio API.
 * Works across ALL browsers.
 *
 * @param {string|null} primaryMicId - Primary microphone device ID
 * @param {string} secondaryDeviceId - Secondary input device ID (virtual audio cable)
 * @returns {Promise<{ combinedStream: MediaStream, cleanup: Function }>}
 */
export async function captureDualDevice(primaryMicId, secondaryDeviceId) {
  let primaryStream = null
  let secondaryStream = null
  let audioContext = null

  try {
    // 1. Get primary mic stream
    const primaryConstraints = {
      audio: primaryMicId ? { deviceId: { ideal: primaryMicId } } : true
    }
    primaryStream = await navigator.mediaDevices.getUserMedia(primaryConstraints)

    // 2. Get secondary audio stream (VB-Cable/BlackHole/Stereo Mix)
    if (secondaryDeviceId) {
      try {
        secondaryStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { ideal: secondaryDeviceId },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        })
      } catch (secError) {
        console.warn('[AUDIO MIX] Secondary device with ideal constraints failed, trying direct deviceId:', secError)
        try {
          secondaryStream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: secondaryDeviceId }
          })
        } catch (e2) {
          console.error('[AUDIO MIX] Secondary device stream failed:', e2)
          throw new Error('Failed to access secondary virtual audio device: ' + e2.message)
        }
      }
    }

    if (!secondaryStream) {
      return {
        combinedStream: primaryStream,
        cleanup: () => primaryStream.getTracks().forEach(t => t.stop())
      }
    }

    // 3. Mix primary and secondary streams using Web Audio API
    audioContext = new (window.AudioContext || window.webkitAudioContext)()
    if (audioContext.state === 'suspended') {
      await audioContext.resume()
    }

    const destination = audioContext.createMediaStreamDestination()

    const primarySource = audioContext.createMediaStreamSource(primaryStream)
    const secondarySource = audioContext.createMediaStreamSource(secondaryStream)

    const primaryGain = audioContext.createGain()
    const secondaryGain = audioContext.createGain()
    primaryGain.gain.value = 1.0
    secondaryGain.gain.value = 1.0

    primarySource.connect(primaryGain)
    secondarySource.connect(secondaryGain)

    primaryGain.connect(destination)
    secondaryGain.connect(destination)

    const combinedStream = destination.stream

    const cleanup = () => {
      if (primaryStream) primaryStream.getTracks().forEach(t => t.stop())
      if (secondaryStream) secondaryStream.getTracks().forEach(t => t.stop())
      if (audioContext && audioContext.state !== 'closed') {
        audioContext.close().catch(() => {})
      }
    }

    return { combinedStream, cleanup }

  } catch (error) {
    if (primaryStream) primaryStream.getTracks().forEach(t => t.stop())
    if (secondaryStream) secondaryStream.getTracks().forEach(t => t.stop())
    if (audioContext && audioContext.state !== 'closed') audioContext.close().catch(() => {})
    throw error
  }
}

/**
 * Capture mic stream AND system audio stream using getDisplayMedia,
 * mixing them together via Web Audio API.
 * Native one-click solution on Chrome/Edge.
 *
 * @param {string|null} micDeviceId - Primary microphone device ID
 * @returns {Promise<{ combinedStream: MediaStream, cleanup: Function, onSystemAudioEnded: Function }>}
 */
export async function captureWithSystemAudio(micDeviceId = null) {
  let micStream = null
  let displayStream = null
  let audioContext = null
  let endedCallback = null

  try {
    // 1. Get mic stream
    const micConstraints = {
      audio: micDeviceId ? { deviceId: { ideal: micDeviceId } } : true
    }
    micStream = await navigator.mediaDevices.getUserMedia(micConstraints)

    // 2. Get system audio stream via getDisplayMedia
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true, // video: true is required by spec, but we stop the track immediately
      audio: {
        systemAudio: 'include',
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false
      }
    })

    // Disable video track (instead of track.stop() which terminates the display stream in Chrome)
    const videoTracks = displayStream.getVideoTracks()
    videoTracks.forEach(track => {
      track.enabled = false
      track.onended = () => {
        console.log('[AUDIO MIX] Video track ended by user')
        if (typeof endedCallback === 'function') {
          endedCallback()
        }
      }
    })

    const systemAudioTracks = displayStream.getAudioTracks()
    if (systemAudioTracks.length === 0) {
      console.warn('[AUDIO MIX] No system audio track provided by user in screen share dialog')
      if (typeof window !== 'undefined' && window.alert) {
        window.alert('⚠️ System audio was not captured!\n\nWhen the Chrome screen picker appears, you MUST check the "Share system audio" (or "Share tab audio") checkbox at the bottom left.\n\nRecording will continue with microphone only.')
      }
      // Cleanup displayStream and return mic-only
      displayStream.getTracks().forEach(t => t.stop())
      return {
        combinedStream: micStream,
        cleanup: () => micStream.getTracks().forEach(t => t.stop()),
        onSystemAudioEnded: () => {}
      }
    }

    // Handle user clicking "Stop sharing" in browser chrome
    const audioTrack = systemAudioTracks[0]
    audioTrack.onended = () => {
      console.log('[AUDIO MIX] System audio stream ended by user')
      if (typeof endedCallback === 'function') {
        endedCallback()
      }
    }

    // 3. Mix mic stream and system audio stream
    audioContext = new (window.AudioContext || window.webkitAudioContext)()
    if (audioContext.state === 'suspended') {
      await audioContext.resume()
    }

    const destination = audioContext.createMediaStreamDestination()

    const micSource = audioContext.createMediaStreamSource(micStream)
    const systemAudioStream = new MediaStream([audioTrack])
    const systemSource = audioContext.createMediaStreamSource(systemAudioStream)

    const micGain = audioContext.createGain()
    const systemGain = audioContext.createGain()
    micGain.gain.value = 1.0
    systemGain.gain.value = 1.0

    micSource.connect(micGain)
    systemSource.connect(systemGain)

    const silentGain = audioContext.createGain()
    silentGain.gain.value = 0.0
    micGain.connect(silentGain)
    systemGain.connect(silentGain)
    silentGain.connect(audioContext.destination)

    audioContext._retainedNodes = [micSource, systemSource, micGain, systemGain, destination, silentGain]

    const combinedStream = destination.stream

    const cleanup = () => {
      if (micStream) micStream.getTracks().forEach(t => t.stop())
      if (displayStream) displayStream.getTracks().forEach(t => t.stop())
      if (audioContext && audioContext.state !== 'closed') {
        audioContext.close().catch(() => {})
      }
    }

    return {
      combinedStream,
      cleanup,
      onSystemAudioEnded: (cb) => {
        endedCallback = cb
      }
    }

  } catch (error) {
    if (micStream) micStream.getTracks().forEach(t => t.stop())
    if (displayStream) displayStream.getTracks().forEach(t => t.stop())
    if (audioContext && audioContext.state !== 'closed') audioContext.close().catch(() => {})
    throw error
  }
}

/**
 * Capture Tab/System Audio via getDisplayMedia AND (optionally) Microphone stream via getUserMedia,
 * mixing them together via Web Audio API for YouTube Video session mode.
 *
 * @param {Object} options
 * @param {string|null} [options.micDeviceId] - Primary microphone device ID
 * @param {boolean} [options.includeMic=true] - Whether to capture microphone alongside tab audio
 * @returns {Promise<{ combinedStream: MediaStream, cleanup: Function, setMicEnabled: Function, enableMicLive: Function, isMicActive: boolean, micWarning: string|null, displayStream: MediaStream }>}
 */
export async function captureTabAndMicAudio({ micDeviceId = null, includeMic = true } = {}) {
  let displayStream = null
  let micStream = null
  let audioContext = null
  let micGainNode = null

  try {
    console.log('[AUDIO MIX] captureTabAndMicAudio called with options:', { micDeviceId, includeMic })
    // 1. Get Tab / Display Audio stream
    console.log('[AUDIO MIX] Calling getDisplayMedia...')
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    })
    console.log('[AUDIO MIX] getDisplayMedia resolved:', displayStream)

    // Disable video track so it doesn't render video (DO NOT call track.stop() which terminates the display stream in Chrome)
    const videoTracks = displayStream.getVideoTracks()
    videoTracks.forEach(track => {
      track.enabled = false
    })

    const systemAudioTracks = displayStream.getAudioTracks()
    if (systemAudioTracks.length === 0) {
      displayStream.getTracks().forEach(t => t.stop())
      throw new Error('NO_TAB_AUDIO')
    }

    // 2. If includeMic is true, attempt to capture microphone stream
    if (includeMic) {
      try {
        const micConstraints = {
          audio: micDeviceId ? { deviceId: { ideal: micDeviceId } } : true
        }
        micStream = await navigator.mediaDevices.getUserMedia(micConstraints)
      } catch (micErr) {
        console.warn('[AUDIO MIX] Initial mic capture failed:', micErr)
        micStream = null
      }
    }

    // 3. Mix tab audio and mic audio using Web Audio API
    audioContext = new (window.AudioContext || window.webkitAudioContext)()
    if (audioContext.state === 'suspended') {
      await audioContext.resume()
    }

    const destination = audioContext.createMediaStreamDestination()

    const systemAudioStream = new MediaStream([systemAudioTracks[0]])
    const systemSource = audioContext.createMediaStreamSource(systemAudioStream)
    const systemGain = audioContext.createGain()
    systemGain.gain.value = 1.0
    systemSource.connect(systemGain)
    systemGain.connect(destination)

    const silentGain = audioContext.createGain()
    silentGain.gain.value = 0.0
    systemGain.connect(silentGain)
    silentGain.connect(audioContext.destination)

    let currentMicSource = null
    const attachMicStream = (stream) => {
      if (!stream || !audioContext || audioContext.state === 'closed') return
      if (currentMicSource) {
        try { currentMicSource.disconnect() } catch (e) {}
      }
      micStream = stream
      const micAudioStream = new MediaStream([stream.getAudioTracks()[0]])
      currentMicSource = audioContext.createMediaStreamSource(micAudioStream)
      if (!micGainNode) {
        micGainNode = audioContext.createGain()
      }
      micGainNode.gain.value = 1.0
      currentMicSource.connect(micGainNode)
      micGainNode.connect(destination)
      micGainNode.connect(silentGain)
      audioContext._retainedNodes.push(currentMicSource, micAudioStream, micStream)
    }

    // Retain stream and node references to prevent V8 garbage collection drops in Chromium
    audioContext._retainedNodes = [displayStream, systemAudioStream, systemSource, systemGain, destination, silentGain]

    if (micStream) {
      attachMicStream(micStream)
    }

    const combinedStream = destination.stream

    const setMicEnabled = (enabled) => {
      if (micGainNode && audioContext && audioContext.state !== 'closed') {
        micGainNode.gain.setValueAtTime(enabled ? 1.0 : 0.0, audioContext.currentTime)
      }
      if (micStream) {
        micStream.getAudioTracks().forEach(t => { t.enabled = enabled })
      }
    }

    const enableMicLive = async (deviceId = null) => {
      try {
        const constraints = { audio: deviceId ? { deviceId: { ideal: deviceId } } : true }
        const newMicStream = await navigator.mediaDevices.getUserMedia(constraints)
        attachMicStream(newMicStream)
        setMicEnabled(true)
        return { success: true, stream: newMicStream }
      } catch (err) {
        console.error('[AUDIO MIX] enableMicLive failed:', err)
        return { success: false, error: err.message }
      }
    }

    const cleanup = () => {
      if (micStream) micStream.getTracks().forEach(t => t.stop())
      if (displayStream) displayStream.getTracks().forEach(t => t.stop())
      if (audioContext && audioContext.state !== 'closed') {
        audioContext.close().catch(() => {})
      }
    }

    return {
      combinedStream,
      cleanup,
      setMicEnabled,
      enableMicLive,
      isMicActive: !!micStream,
      micWarning: includeMic && !micStream ? 'Microphone capture failed — using tab audio.' : null,
      displayStream
    }
  } catch (error) {
    if (micStream) micStream.getTracks().forEach(t => t.stop())
    if (displayStream) displayStream.getTracks().forEach(t => t.stop())
    if (audioContext && audioContext.state !== 'closed') audioContext.close().catch(() => {})
    throw error
  }
}

