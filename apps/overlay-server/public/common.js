(() => {
  const socket = io(`ws://${location.hostname}:${location.port}/`, {
    path: "/ws/overlay",
    transports: ["websocket", "polling"],
  });

  const handlers = [];

  socket.on("overlay", (payload) => {
    handlers.forEach((h) => h(payload));
  });
  socket.on("overlay:show", (payload) => {
    handlers.forEach((h) => h(payload));
  });
  socket.on("overlay:update", (payload) => {
    handlers.forEach((h) => h(payload));
  });
  socket.on("overlay:hide", (payload) => {
    handlers.forEach((h) => h(payload));
  });

  window.overlayBus = {
    on(handler) {
      handlers.push(handler);
    },
  };
})();
