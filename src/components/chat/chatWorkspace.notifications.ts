type NotifyArgs = {
  title: string
  body: string
}

export function tryPlayMessageSound(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const start = () => {
      try {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        gain.gain.value = 0.05
        osc.type = 'sine'
        osc.frequency.value = 880
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start()
        window.setTimeout(() => {
          try {
            osc.stop()
            osc.disconnect()
            gain.disconnect()
            void ctx.close()
          } catch {
            // ignore
          }
        }, 140)
      } catch {
        // ignore
      }
    }
    if (ctx.state === 'suspended') {
      void ctx.resume().then(start).catch(() => {})
      return
    }
    start()
  } catch {
    // Autoplay restrictions or missing audio support.
  }
}

export function tryShowDesktopNotification(args: NotifyArgs): void {
  try {
    if (typeof window.Notification === 'undefined') return
    if (Notification.permission === 'default') {
      void Notification.requestPermission().then((permission) => {
        if (permission !== 'granted') return
        try {
          const n = new Notification(args.title, { body: args.body })
          n.onclick = () => {
            try {
              window.focus()
            } catch {
              // ignore
            }
          }
        } catch {
          // ignore
        }
      })
      return
    }
    if (Notification.permission !== 'granted') return
    const n = new Notification(args.title, { body: args.body })
    n.onclick = () => {
      try {
        window.focus()
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}
