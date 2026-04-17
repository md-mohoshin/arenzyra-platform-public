# Arenzyra Desktop

## Widget Server LAN Access

The desktop widget server now binds to `0.0.0.0:5510`, which allows OBS to load widgets from another machine on the same local network.

Example startup output:

```text
[widget-server] listening on http://localhost:5510
[widget-server] network access http://192.168.1.25:5510
```

If OBS is running on another computer:

1. Start the Arenzyra desktop app on the machine hosting the widget server.
2. Copy the `network access` URL from the startup logs or from the Widgets screen.
3. Use that LAN URL in the OBS Browser Source on the other machine.

Examples:

```text
http://192.168.1.25:5510/obs/map
http://192.168.1.25:5510/w/:widgetInstanceKey
```

Notes:

- Local previews inside the desktop app still use `http://localhost:5510`.
- Both machines need to be on the same LAN.
- If the remote machine cannot connect, allow the app through the OS firewall for private networks.
