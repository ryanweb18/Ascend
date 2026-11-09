// Where the multiplayer server lives.
// When the page is served by the Node server itself (local play, or the Render URL directly),
// it connects back to that same server. Anywhere else (e.g. Netlify) it uses the Render server.
(function () {
  const RENDER_SERVER = 'wss://ascend-game.onrender.com';
  const host = location.hostname;
  const servedByGameServer = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.onrender.com');
  window.ASCEND_SERVER = servedByGameServer ? '' : RENDER_SERVER;
})();
