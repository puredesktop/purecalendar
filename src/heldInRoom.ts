// Held inside an entry of the Executive room (the page holding this app is not the shell): it lies flat on that page, with
// no header of its own, as the entry names it. Nothing here applies anywhere else.
if (window.parent !== window.top) {
  document.documentElement.setAttribute('data-held-in-room', '')
  const style = document.createElement('style')
  style.textContent = `
    html[data-held-in-room], html[data-held-in-room] body, html[data-held-in-room] #root > * { background: #ffffff; border-radius: 0; box-shadow: none; }
    html[data-held-in-room] #root > * > header { display: none; }
  `
  document.head.appendChild(style)
  // grown to the whole app over the room: its own header and chrome come back
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.type !== 'pure:adjacent-app') return
    document.documentElement.toggleAttribute('data-held-in-room', !!event.data.app)
  })
}
export {}
