import { describe, expect, it } from 'vitest'

// Send, merge and publish are release actions (ps-suite #1017): no agent can run them at any trust level; only a
// person's own button, or a CEO approval in the Executive team, carries them out.
describe('release tools', () => {
  it.each(['activateCalendarEvent'])('%s is a release action', async name => {
    const manifest = (await import('../../plugin.json', { with: { type: 'json' } })).default as {
      app: { agents: { tools: Array<{ name: string; risk?: string }> } }
    }
    expect(manifest.app.agents.tools.find(tool => tool.name === name)?.risk).toBe('release')
  })
})

describe('telling guests', () => {
  it.each(['updateCalendarEvent', 'rescheduleCalendarEvent', 'deleteCalendarEvent'])('%s is a release when it notifies invitees', async name => {
    const manifest = (await import('../../plugin.json', { with: { type: 'json' } })).default as {
      app: { agents: { tools: Array<{ name: string; riskWhen?: Record<string, string> }> } }
    }
    expect(manifest.app.agents.tools.find(tool => tool.name === name)?.riskWhen).toEqual({ notifyInvitees: 'release' })
  })
})
