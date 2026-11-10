/**
 * Pluggable notification channels. Only `log` is real in the MVP; sms/whatsapp are
 * slots for a partner integration (or the Mystery Card) without touching callers.
 */
export type Channel = 'log' | 'sms' | 'whatsapp'
export type NotifyPayload = { to?: string; template: string; vars?: Record<string, string | number> }
type Sender = (payload: NotifyPayload) => Promise<{ delivered: boolean; simulated: boolean }>

const channels: Record<Channel, Sender> = {
  log: async (p) => {
    console.info('[notify:log]', p.template, p.vars ?? {})
    return { delivered: true, simulated: true }
  },
  sms: async (p) => {
    console.info('[notify:sms] simulated', p.to ? maskPhone(p.to) : '(no recipient)', p.template)
    return { delivered: false, simulated: true }
  },
  whatsapp: async (p) => {
    console.info('[notify:whatsapp] simulated', p.to ? maskPhone(p.to) : '(no recipient)', p.template)
    return { delivered: false, simulated: true }
  },
}

export function registerChannel(channel: Channel, sender: Sender) {
  channels[channel] = sender
}

export function notify(channel: Channel, payload: NotifyPayload) {
  return channels[channel](payload)
}

/** R8: phone numbers are only ever shown masked, e.g. 03xx-xxxx-x12. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '').replace(/^92/, '0')
  return digits.length < 4 ? '****' : `03xx-xxxx-x${digits.slice(-2)}`
}
